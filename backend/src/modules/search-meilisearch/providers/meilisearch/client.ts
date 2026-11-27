/**
 * Минимальный fetch-клиент Meilisearch для поискового провайдера.
 *
 * Без внешних зависимостей (npm-клиент не подключается осознанно):
 * весь используемый Meilisearch API (v1.58, проверен техническим
 * прототипом — infrastructure/scripts/search-prototype.mjs) тривиально
 * покрывается fetch + JSON, а фиксация версии клиента избыточна.
 *
 * Возможности:
 *  - Повторные попытки при временных ошибках (сеть, 502/503/504) —
 *    до 3 попыток с экспоненциальной паузой; идемпотентность операций
 *    Meilisearch (детерминированные id документов и задач) делает
 *    повтор безопасным.
 *  - Таймаут на каждый запрос.
 *  - Автоматическое создание пары API-ключей с минимальными правами
 *    (индексация и поиск) из master key; master key используется только
 *    для провижининга и никогда не покидает backend.
 */

export type MeilisearchClientOptions = {
  host: string
  /** Master key: только провижининг дочерних ключей и фолбэк. */
  masterKey?: string
  /** Явный ключ индексации (профессиональная замена автоматическому). */
  indexerApiKey?: string
  /** Явный ключ поиска. */
  searchApiKey?: string
  requestTimeoutMs?: number
  retries?: number
}

export class MeilisearchNetworkError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = "MeilisearchNetworkError"
  }
}

export class MeilisearchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = "MeilisearchApiError"
  }
}

// Meilisearch требует UUID-формат для uid API-ключей. Значения фиксированы
// (не генерируются): повторные запуски провижининга идемпотентны — существующие
// ключи находятся по uid и переиспользуются.
const INDEXER_KEY_UID = "8f1e6f7a-2b3c-4d5e-9f0a-1b2c3d4e5f60"
const SEARCH_KEY_UID = "3c9a8b7d-6e5f-4a1b-8c2d-9e0f1a2b3c4d"

const INDEXER_KEY_ACTIONS = [
  "documents.add",
  "documents.delete",
  "indexes.create",
  "indexes.delete",
  "indexes.get",
  "indexes.update",
  "settings.get",
  "settings.update",
  "stats.get",
  "tasks.get",
] as const

type KeyPayload = {
  key?: string
  uid?: string
  actions?: string[]
  indexes?: string[]
  expiresAt?: string | null
  code?: string
}

type TaskPayload = {
  taskUid?: number
  uid?: number
  status?: string
  error?: { message?: string; code?: string }
}

const TRANSIENT_STATUSES = new Set([502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MeilisearchClient {
  private readonly host: string
  private readonly masterKey?: string
  private readonly indexerApiKey?: string
  private readonly searchApiKey?: string
  private readonly timeoutMs: number
  private readonly retries: number

  private indexerKeyPromise: Promise<string> | null = null
  private searchKeyPromise: Promise<string> | null = null

  constructor(options: MeilisearchClientOptions) {
    this.host = options.host.replace(/\/+$/, "")
    this.masterKey = options.masterKey
    this.indexerApiKey = options.indexerApiKey
    this.searchApiKey = options.searchApiKey
    this.timeoutMs = options.requestTimeoutMs ?? 15_000
    this.retries = options.retries ?? 3
  }

  /**
   * Ключ с правами индексации. Провижинится один раз (идемпотентно, по
   * фиксированному uid) из master key; повторные вызовы используют кэш.
   */
  async getIndexerKey(): Promise<string> {
    if (this.indexerApiKey) {
      return this.indexerApiKey
    }
    this.indexerKeyPromise ??= this.ensureKey(INDEXER_KEY_UID, [
      ...INDEXER_KEY_ACTIONS,
    ])
    return this.indexerKeyPromise
  }

  /** Ключ с правами только на поиск (используется store-маршрутами). */
  async getSearchKey(): Promise<string> {
    if (this.searchApiKey) {
      return this.searchApiKey
    }
    this.searchKeyPromise ??= this.ensureKey(SEARCH_KEY_UID, ["search"])
    return this.searchKeyPromise
  }

  private async ensureKey(uid: string, actions: string[]): Promise<string> {
    if (!this.masterKey) {
      throw new MeilisearchNetworkError(
        `Невозможно провижинить API-ключ ${uid}: MEILISEARCH_MASTER_KEY не задан`
      )
    }

    // GET /keys/:uid возвращает существующий ключ (включая значение).
    const existing = await this.request<KeyPayload>(
      "GET",
      `/keys/${uid}`,
      undefined,
      this.masterKey
    ).catch((error) => {
      if (error instanceof MeilisearchApiError && error.status === 404) {
        return null
      }
      throw error
    })

    if (existing?.key) {
      return existing.key
    }

    const created = await this.request<KeyPayload>(
      "POST",
      "/keys",
      {
        uid,
        description: `eCommerce Starter Kit: ${uid}`,
        actions,
        indexes: ["*"],
        expiresAt: null,
      },
      this.masterKey
    )

    if (!created?.key) {
      throw new MeilisearchNetworkError(`Создание ключа ${uid} не вернуло значение`)
    }
    return created.key
  }

  /** Проверка доступности поискового сервиса (без авторизации). */
  async health(): Promise<boolean> {
    const body = await this.request<{ status?: string }>("GET", "/health")
    return body?.status === "available"
  }

  async createIndex(uid: string, primaryKey: string): Promise<number | null> {
    const task = await this.request<TaskPayload>("POST", "/indexes", { uid, primaryKey }, await this.getIndexerKey())
    return task.taskUid ?? task.uid ?? null
  }

  async indexExists(uid: string): Promise<boolean> {
    return await this.request<{ uid?: string }>("GET", `/indexes/${uid}`, undefined, await this.getIndexerKey())
      .then(() => true)
      .catch((error) => {
        if (error instanceof MeilisearchApiError && error.status === 404) {
          return false
        }
        throw error
      })
  }

  async updateSettings(
    uid: string,
    settings: Record<string, unknown>
  ): Promise<number | null> {
    const task = await this.request<TaskPayload>(
      "PATCH",
      `/indexes/${uid}/settings`,
      settings,
      await this.getIndexerKey()
    )
    return task.taskUid ?? task.uid ?? null
  }

  async deleteIndex(uid: string): Promise<number | null> {
    const task = await this.request<TaskPayload>(
      "DELETE",
      `/indexes/${uid}`,
      undefined,
      await this.getIndexerKey()
    )
    return task.taskUid ?? task.uid ?? null
  }

  async listIndexes(): Promise<Array<{ uid: string; primaryKey?: string }>> {
    const body = await this.request<{
      results?: Array<{ uid: string; primaryKey?: string }>
    }>("GET", "/indexes?limit=1000", undefined, await this.getIndexerKey())
    return body?.results ?? []
  }

  async indexStats(uid: string): Promise<{ numberOfDocuments?: number }> {
    return this.request<{ numberOfDocuments?: number }>(
      "GET",
      `/indexes/${uid}/stats`,
      undefined,
      await this.getIndexerKey()
    )
  }

  async addDocuments(
    uid: string,
    documents: Array<Record<string, unknown>>
  ): Promise<number | null> {
    const task = await this.request<TaskPayload>(
      "POST",
      `/indexes/${uid}/documents`,
      documents,
      await this.getIndexerKey()
    )
    return task.taskUid ?? task.uid ?? null
  }

  async deleteDocumentsByIds(uid: string, ids: string[]): Promise<number | null> {
    const task = await this.request<TaskPayload>(
      "POST",
      `/indexes/${uid}/documents/delete-batch`,
      ids,
      await this.getIndexerKey()
    )
    return task.taskUid ?? task.uid ?? null
  }

  async deleteDocumentsByFilter(
    uid: string,
    filter: string | Array<string | string[]>
  ): Promise<number | null> {
    const task = await this.request<TaskPayload>(
      "POST",
      `/indexes/${uid}/documents/delete`,
      { filter },
      await this.getIndexerKey()
    )
    return task.taskUid ?? task.uid ?? null
  }

  async deleteAllDocuments(uid: string): Promise<number | null> {
    const task = await this.request<TaskPayload>(
      "DELETE",
      `/indexes/${uid}/documents`,
      undefined,
      await this.getIndexerKey()
    )
    return task.taskUid ?? task.uid ?? null
  }

  /**
   * Читает сырые документы индекса (POST /documents/fetch): то, что реально
   * хранится в Meilisearch, — используется сверкой индекса
   * (job search-index-reconcile). В отличие от search, чтение документов
   * не применяет distinct-дедупликацию. Право documents.get не входит в
   * провижинируемые ключи (actions иммутабельны в Meilisearch), поэтому
   * запрос идет master key-ом — операция внутренняя, серверная, значение
   * не покидает backend-контейнер.
   */
  async fetchDocuments(
    uid: string,
    options: {
      filter?: string | Array<string | string[]>
      fields?: string[]
      limit?: number
      offset?: number
    }
  ): Promise<{ results: Array<Record<string, unknown>>; total: number }> {
    if (!this.masterKey) {
      throw new MeilisearchNetworkError(
        "Чтение сырых документов требует MEILISEARCH_MASTER_KEY"
      )
    }

    const body: Record<string, unknown> = {
      limit: Math.max(options.limit ?? 1000, 1),
      offset: Math.max(options.offset ?? 0, 0),
    }
    if (options.filter !== undefined) {
      body.filter = options.filter
    }
    if (options.fields?.length) {
      body.fields = options.fields
    }

    const payload = await this.request<{
      results?: Array<Record<string, unknown>>
      total?: number
    }>(
      "POST",
      `/indexes/${uid}/documents/fetch`,
      body,
      this.masterKey
    )

    return {
      results: payload.results ?? [],
      total: payload.total ?? payload.results?.length ?? 0,
    }
  }

  async getTask(taskUid: number): Promise<TaskPayload> {
    return this.request<TaskPayload>(
      "GET",
      `/tasks/${taskUid}`,
      undefined,
      await this.getIndexerKey()
    )
  }

  /** Контролируемое ожидание задачи (poll с deadline, без фиксированных пауз). */
  async waitForTask(taskUid: number, timeoutMs = 60_000): Promise<TaskPayload> {
    const deadline = Date.now() + timeoutMs
    let last: TaskPayload = {}

    while (Date.now() < deadline) {
      last = await this.getTask(taskUid)
      if (last.status && last.status !== "enqueued" && last.status !== "processing") {
        return last
      }
      await sleep(200)
    }

    throw new MeilisearchNetworkError(
      `Задача Meilisearch ${taskUid} не завершилась за ${timeoutMs} мс (последний статус: ${last.status ?? "unknown"})`
    )
  }

  async search(
    uid: string,
    params: Record<string, unknown>
  ): Promise<MeiliSearchResponse> {
    return this.request<MeiliSearchResponse>(
      "POST",
      `/indexes/${uid}/search`,
      params,
      await this.getSearchKey()
    )
  }

  async multiSearch(
    queries: Array<Record<string, unknown>>
  ): Promise<MeiliSearchResponse[]> {
    const body = await this.request<{ results?: MeiliSearchResponse[] }>(
      "POST",
      "/multi-search",
      { queries },
      await this.getSearchKey()
    )
    return body?.results ?? []
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    apiKey?: string
  ): Promise<T> {
    let lastError: unknown = null

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, body, apiKey)
      } catch (error) {
        lastError = error
        const transient =
          error instanceof MeilisearchNetworkError ||
          (error instanceof MeilisearchApiError &&
            TRANSIENT_STATUSES.has(error.status))

        if (!transient || attempt === this.retries) {
          break
        }
        await sleep(250 * 2 ** attempt)
      }
    }

    throw lastError
  }

  private async requestOnce<T>(
    method: string,
    path: string,
    body: unknown,
    apiKey?: string
  ): Promise<T> {
    let response: Response

    try {
      response = await fetch(`${this.host}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new MeilisearchNetworkError(
        `Meilisearch недоступен (${this.host}${path}): ${(error as Error).message}`,
        error
      )
    }

    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (!response.ok) {
      const payload = parsed as { message?: string; code?: string } | null
      throw new MeilisearchApiError(
        payload?.message ?? `Meilisearch ${path}: HTTP ${response.status}`,
        response.status,
        payload?.code
      )
    }

    return (parsed ?? null) as T
  }
}

/** Форма ответа Meilisearch, используемая провайдером. */
export type MeiliSearchResponse = {
  hits?: Array<Record<string, unknown> & { _formatted?: Record<string, unknown> }>
  query?: string
  processingTimeMs?: number
  page?: number
  hitsPerPage?: number
  totalPages?: number
  totalHits?: number
  estimatedTotalHits?: number
  facetDistribution?: Record<string, Record<string, number>>
  facetStats?: Record<string, { min?: number; max?: number }>
}

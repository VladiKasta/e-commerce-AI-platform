import { beforeAll, afterAll, describe, expect, it } from "vitest"

/**
 * Интеграционные тесты событийной синхронизации значений характеристик с
 * Meilisearch (этапы 3.6.1/3.6.3) на РЕАЛЬНОЙ Medusa: назначение,
 * изменение, удаление значения и каскадное удаление характеристики —
 * каждый шаг проверяется ограниченным polling-ом документов индекса
 * (интервал 500 мс, лимит 15 с) и Store API. Идемпотентность повторных
 * операций проверяется на уровне живых строк и документов.
 *
 * Через `make test` одноразовому тест-контейнеру передаются
 * ADMIN_EMAIL/ADMIN_PASSWORD и MEILISEARCH_HOST/MEILISEARCH_MASTER_KEY
 * (Makefile); активный физический индекс тест берет из ответа сверки
 * (подтверждение из БД приложения, а не эвристика номера версии).
 */

const baseUrl =
  process.env.NUXT_MEDUSA_URL ??
  process.env.MEDUSA_PUBLIC_URL ??
  "http://localhost:9000"

const meiliHost = process.env.MEILISEARCH_HOST ?? "http://meilisearch:7700"
const meiliKey = process.env.MEILISEARCH_MASTER_KEY

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const publishableKey =
  process.env.NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  process.env.MEDUSA_PUBLISHABLE_KEY

const HOODIE_ID = "prod_01M87JXH5R6WX9T1HH0G6DG3EA"

// ── HTTP-хелперы ──────────────────────────────────────────────────────────

type ApiResult<T> = { status: number; body: T | null }

async function adminFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; token?: string }
): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as T | null }
}

async function storeFetch<T>(path: string): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "x-publishable-api-key": publishableKey ?? "" },
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as T | null }
}

type MeiliDoc = Record<string, unknown>

async function fetchProductDocs(index: string, productId: string): Promise<MeiliDoc[]> {
  const res = await fetch(`${meiliHost}/indexes/${index}/documents/fetch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${meiliKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 100, filter: `product_id = "${productId}"` }),
  })
  if (!res.ok) {
    throw new Error(`documents/fetch → ${res.status}`)
  }
  const body = (await res.json()) as { results?: MeiliDoc[] }
  return body.results ?? []
}

/** Ограниченный polling: ждет, пока предикат по документам товара станет истинным. */
async function pollProductAttributes(
  index: string,
  productId: string,
  code: string,
  predicate: (value: unknown) => boolean,
  timeoutMs = 15_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const docs = await fetchProductDocs(index, productId)
    const values = docs.map((doc) => (doc.attributes as Record<string, unknown>)?.[code])
    if (docs.length > 0 && values.every((value) => predicate(value))) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

// ── Состояние сквозного сценария ──────────────────────────────────────────

let token = ""
let indexName = ""
const createdAttributeIds: string[] = []

interface ReconcileSummary {
  physicalName: string | null
  checkedProducts: number
  missing: number
  stale: number
  extra: number
  orphanProducts: number
  reindexedProducts: number
  deletedDocs: number
  errors: number
}

type ReconcileResponse =
  | { status: "completed"; summary: ReconcileSummary }
  | { status: "skipped" }

async function reconcile(): Promise<ReconcileSummary> {
  const res = await adminFetch<ReconcileResponse>("/admin/search/reconcile", {
    method: "POST",
    token,
  })
  if (res.status !== 200 || !res.body || res.body.status !== "completed") {
    throw new Error(`Сверка недоступна: HTTP ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.summary
}

beforeAll(async () => {
  if (!adminEmail || !adminPassword || !meiliKey) {
    throw new Error(
      "Тесты требуют ADMIN_EMAIL/ADMIN_PASSWORD и MEILISEARCH_MASTER_KEY (передаются через `make test`)."
    )
  }
  const auth = await adminFetch<{ token?: string }>("/auth/user/emailpass", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  })
  if (!auth.body?.token) {
    throw new Error(`Не удалось аутентифицировать администратора: HTTP ${auth.status}`)
  }
  token = auth.body.token

  // Активный физический индекс — из подтверждения сверкой (БД приложения).
  const summary = await reconcile()
  if (!summary.physicalName) {
    throw new Error("Сверка не вернула активный физический индекс")
  }
  indexName = summary.physicalName
})

afterAll(async () => {
  // Очистка: каскадное удаление тестовых характеристик (значения товаров
  // удаляются каскадом — маршрут отвечает за целостность).
  for (const attributeId of createdAttributeIds) {
    await adminFetch(`/admin/catalog-attributes/${attributeId}`, {
      method: "DELETE",
      token,
    }).catch(() => undefined)
  }
})

// ── События назначения/изменения/удаления значения ───────────────────────

describe("Событийная синхронизация значений характеристик", () => {
  const code = `test-sync-${Date.now()}`
  let attributeId = ""
  const product = HOODIE_ID

  it("назначение: значение появляется в документах по событию created", async () => {
    const created = await adminFetch<{ attribute?: { id?: string } }>(
      "/admin/catalog-attributes",
      {
        method: "POST",
        token,
        body: {
          name: "sync-test",
          code,
          data_type: "select",
          filterable: true,
          options: [{ value: "v1", label: "V1" }, { value: "v2", label: "V2" }],
        },
      }
    )
    expect(created.status).toBe(201)
    attributeId = created.body?.attribute?.id ?? ""
    expect(attributeId).toBeTruthy()
    createdAttributeIds.push(attributeId)

    const set = await adminFetch(`/admin/products/${product}/attribute-values`, {
      method: "POST",
      token,
      body: { values: [{ attribute_id: attributeId, value: "v1" }] },
    })
    expect(set.status).toBe(201)

    const synced = await pollProductAttributes(
      indexName,
      product,
      code,
      (value) => value === "v1"
    )
    expect(synced).toBe(true)
  })

  it("изменение: новое значение заменяет старое во всех документах товара", async () => {
    const set = await adminFetch(`/admin/products/${product}/attribute-values`, {
      method: "POST",
      token,
      body: { values: [{ attribute_id: attributeId, value: "v2" }] },
    })
    expect(set.status).toBe(201)

    const synced = await pollProductAttributes(
      indexName,
      product,
      code,
      (value) => value === "v2"
    )
    expect(synced).toBe(true)

    // Сквозно через Store API: товар находится по новому значению.
    const found = await storeFetch<{ pagination?: { total: number } }>(
      `/store/catalog?filter[${code}]=v2`
    )
    expect(found.status).toBe(200)
    expect(found.body?.pagination?.total).toBeGreaterThanOrEqual(1)
  })

  it("удаление: значение исчезает из документов по событию deleted", async () => {
    const removed = await adminFetch(
      `/admin/products/${product}/attribute-values?attribute_id=${attributeId}`,
      { method: "DELETE", token }
    )
    expect(removed.status).toBe(200)

    const synced = await pollProductAttributes(
      indexName,
      product,
      code,
      (value) => value === undefined
    )
    expect(synced).toBe(true)

    const none = await storeFetch<{ pagination?: { total: number } }>(
      `/store/catalog?filter[${code}]=v2`
    )
    expect(none.body?.pagination?.total).toBe(0)
  })

  it("идемпотентность: повторная перезапись не дублирует значение и событие", async () => {
    for (const _ of [1, 2]) {
      const set = await adminFetch(`/admin/products/${product}/attribute-values`, {
        method: "POST",
        token,
        body: { values: [{ attribute_id: attributeId, value: "v1" }] },
      })
      expect(set.status).toBe(201)
    }

    // Живая строка одна (идемпотентная перезапись scope).
    const values = await adminFetch<{
      product_attribute_values?: Array<{ text_value: string | null }>
    }>(`/admin/products/${product}/attribute-values`, { token })
    const rows = (values.body?.product_attribute_values ?? []).filter(
      (row) => row.text_value === "v1"
    )
    expect(rows).toHaveLength(1)

    // Документ — скаляр (не массив дублей).
    const synced = await pollProductAttributes(
      indexName,
      product,
      code,
      (value) => value === "v1"
    )
    expect(synced).toBe(true)
    const docs = await fetchProductDocs(indexName, product)
    const attributeValues = docs.map(
      (doc) => (doc.attributes as Record<string, unknown>)?.[code]
    )
    expect(attributeValues.every((value) => value === "v1")).toBe(true)

    // Повторное удаление безвредно: вторая команда не находит строк.
    const first = await adminFetch<{ ids?: string[] }>(
      `/admin/products/${product}/attribute-values?attribute_id=${attributeId}`,
      { method: "DELETE", token }
    )
    expect(first.status).toBe(200)
    expect(first.body?.ids?.length).toBe(1)
    const second = await adminFetch<{ ids?: string[] }>(
      `/admin/products/${product}/attribute-values?attribute_id=${attributeId}`,
      { method: "DELETE", token }
    )
    expect(second.status).toBe(200)
    expect(second.body?.ids).toEqual([])

    const gone = await pollProductAttributes(
      indexName,
      product,
      code,
      (value) => value === undefined
    )
    expect(gone).toBe(true)
  })

  it("каскадное удаление характеристики убирает значения из индекса", async () => {
    const set = await adminFetch(`/admin/products/${product}/attribute-values`, {
      method: "POST",
      token,
      body: { values: [{ attribute_id: attributeId, value: "v1" }] },
    })
    expect(set.status).toBe(201)
    expect(
      await pollProductAttributes(indexName, product, code, (v) => v === "v1")
    ).toBe(true)

    const removed = await adminFetch<{ deleted?: boolean }>(
      `/admin/catalog-attributes/${attributeId}`,
      { method: "DELETE", token }
    )
    expect(removed.status).toBe(200)
    expect(removed.body?.deleted).toBe(true)
    createdAttributeIds.splice(createdAttributeIds.indexOf(attributeId), 1)

    const gone = await pollProductAttributes(
      indexName,
      product,
      code,
      (value) => value === undefined
    )
    expect(gone).toBe(true)
  })
})

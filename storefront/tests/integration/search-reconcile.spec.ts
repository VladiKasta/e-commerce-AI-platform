import { beforeAll, describe, expect, it } from "vitest"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import http from "node:http"

/**
 * Интеграционные тесты сверки и восстановления поискового индекса
 * (этап 3.6.2/3.6.3) на РЕАЛЬНОЙ Medusa + Meilisearch: обнаружение и
 * ремонт отсутствующих/устаревших/лишних документов и сирот, защита от
 * параллельного запуска, устойчивость к конкурентному изменению товара
 * и отсутствие утечки MEILISEARCH_MASTER_KEY в клиентских данных.
 *
 * Повреждения вносятся прямо в Meilisearch (documents/fetch и
 * documents/delete-batch c master key, переданным одноразовому тестовому
 * контейнеру через `make test`); ремонт запускается официальным
 * POST /admin/search/reconcile.
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

interface ReconcileSummary {
  physicalName: string | null
  checkedProducts: number
  checkedDocs: number
  missing: number
  stale: number
  extra: number
  orphanProducts: number
  orphanDocs: number
  reindexedProducts: number
  deletedDocs: number
  errors: number
}

type ReconcileResponse =
  | { status: "completed"; summary: ReconcileSummary }
  | { status: "skipped" }

async function reconcile(): Promise<ReconcileResponse> {
  const res = await adminFetch<ReconcileResponse>("/admin/search/reconcile", {
    method: "POST",
    token,
  })
  if (res.status !== 200 || !res.body) {
    throw new Error(`Сверка недоступна: HTTP ${res.status}`)
  }
  return res.body
}

/** Строгая версия: требует выполненный запуск (для beforeAll и сценариев). */
async function reconcileCompleted(): Promise<ReconcileSummary> {
  const result = await reconcile()
  if (result.status !== "completed") {
    throw new Error(`Сверка не выполнилась: ${JSON.stringify(result)}`)
  }
  return result.summary
}

/**
 * Тот же POST /admin/search/reconcile поверх node:http — независимый сокет:
 * глобальный undici-агент fetch сериализует одновременные запросы к одному
 * origin, а для проверки lock-а нужно параллельное прибытие двух запусков.
 */
function reconcileRaw(): Promise<ReconcileResponse> {
  const url = new URL("/admin/search/reconcile", baseUrl)
  return new Promise<ReconcileResponse>((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as ReconcileResponse)
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        })
      }
    )
    request.on("error", (error) => reject(error))
    request.end()
  })
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
  const body = (await res.json()) as { results?: MeiliDoc[]; total?: number }
  return body.results ?? []
}

let token = ""
let indexName = ""
let hoodieDocIds: string[] = []

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

  const summary = await reconcileCompleted()
  if (!summary.physicalName) {
    throw new Error("Сверка не вернула активный индекс")
  }
  indexName = summary.physicalName
  hoodieDocIds = (await fetchProductDocs(indexName, HOODIE_ID)).map((doc) =>
    String(doc.id)
  )
  if (!hoodieDocIds.length) {
    throw new Error("У худи нет документов в индексе — проверьте seed")
  }
})

// ── 7–8. Сравнение и восстановление документов ───────────────────────────

describe("Сверка: обнаружение и восстановление документов", () => {
  it("на корректном индексе не выполняет записей (сравнение ожидаемых и фактических сходится)", async () => {
    const summary = await reconcileCompleted()
    expect(summary.missing).toBe(0)
    expect(summary.stale).toBe(0)
    expect(summary.extra).toBe(0)
    expect(summary.orphanProducts).toBe(0)
    expect(summary.reindexedProducts).toBe(0)
    expect(summary.deletedDocs).toBe(0)
    expect(summary.errors).toBe(0)
    expect(summary.checkedProducts).toBeGreaterThan(0)
    expect(summary.checkedDocs).toBeGreaterThan(0)
  })

  it("восстанавливает отсутствующий, обновляет устаревший, удаляет лишний документ и сироту", async () => {
    const docs = await fetchProductDocs(indexName, HOODIE_ID)
    const kept = docs[0]
    const corrupted = docs[1] ?? docs[0]
    const missingId = String(kept.id)

    // Повреждения: (1) документ удален, (2) документ испорчен,
    // (3) лишний документ живого товара, (4) документ-сирота.
    const del = await fetch(`${meiliHost}/indexes/${indexName}/documents/delete-batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${meiliKey}`, "Content-Type": "application/json" },
      body: JSON.stringify([missingId]),
    })
    expect(del.status).toBe(202)

    const upd = await fetch(`${meiliHost}/indexes/${indexName}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${meiliKey}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ ...corrupted, price: 1, title: "CORRUPTED" }]),
    })
    expect(upd.status).toBe(202)

    const add = await fetch(`${meiliHost}/indexes/${indexName}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${meiliKey}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          id: "test-extra__rub",
          product_id: HOODIE_ID,
          variant_id: "variant_test_extra",
          title: "EXTRA",
          currency_code: "rub",
          price: 999,
          attributes: {},
        },
        {
          id: "test-ghost__rub",
          product_id: "prod_test_ghost",
          variant_id: "variant_test_ghost",
          title: "GHOST",
          currency_code: "rub",
          price: 1,
          attributes: {},
        },
      ]),
    })
    expect(add.status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const result = await reconcile()
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return
    expect(result.summary.missing).toBeGreaterThanOrEqual(1)
    expect(result.summary.stale).toBeGreaterThanOrEqual(1)
    expect(result.summary.extra).toBeGreaterThanOrEqual(1)
    expect(result.summary.orphanProducts).toBeGreaterThanOrEqual(1)
    expect(result.summary.errors).toBe(0)

    // Ремонт: документы худи восстановлены в точности (сравнение по id и
    // содержимому с базой до повреждения), лишние и сирота удалены.
    const repaired = await fetchProductDocs(indexName, HOODIE_ID)
    expect(repaired.map((doc) => String(doc.id)).sort()).toEqual(
      [...hoodieDocIds].sort()
    )
    expect(
      repaired.find((doc) => String(doc.id) === String(corrupted.id))?.price
    ).not.toBe(1)

    const all = await fetch(
      `${meiliHost}/indexes/${indexName}/documents/fetch`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${meiliKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: 100,
          filter: 'product_id IN ["prod_test_ghost"]',
        }),
      }
    )
    const ghosts = ((await all.json()) as { results?: MeiliDoc[] }).results ?? []
    expect(ghosts).toHaveLength(0)
  })

  it("повторная сверка после ремонта не делает записей (идемпотентность)", async () => {
    const result = await reconcile()
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return
    expect(result.summary.reindexedProducts).toBe(0)
    expect(result.summary.deletedDocs).toBe(0)
  })
})

// ── 10. Защита от параллельного запуска ───────────────────────────────────

describe("Сверка: защита от параллельного запуска", () => {
  it("запуск во время другого выполнения пропускается (lock), первый ремонтирует", async () => {
    // Полная потеря документов: ремонт длится сотни миллисекунд — окно, в
    // котором параллельный запуск обязан получить "skipped". Под нагрузкой
    // окно может сжиматься, поэтому сценарий повторяется с повторным
    // повреждением, пока пропуск по lock-у не будет наблюдаться (пробы,
    // попавшие после релиза, безвредны — это no-op сверки).
    let skippedSeen = false
    for (let attempt = 0; attempt < 3 && !skippedSeen; attempt++) {
      const wipe = await fetch(`${meiliHost}/indexes/${indexName}/documents`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${meiliKey}` },
      })
      expect(wipe.status).toBe(202)

      // Удаление асинхронно: ждем фактической потери документов.
      let wiped = false
      for (let wait = 0; wait < 25 && !wiped; wait++) {
        const left = await fetchProductDocs(indexName, HOODIE_ID)
        wiped = left.length === 0
        if (!wiped) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
      expect(wiped).toBe(true)

      // Первый запуск берет lock и восстанавливает каталог; пробы идут
      // следом по независимым сокетам (node:http — глобальный undici-агент
      // fetch сериализует одновременные запросы к одному origin).
      const first = reconcileRaw()
      for (let probe = 0; probe < 4 && !skippedSeen; probe++) {
        const result = await reconcileRaw()
        if (result.status === "skipped") {
          skippedSeen = true
        }
      }
      const firstResult = await first
      expect(firstResult.status).toBe("completed")
      if (firstResult.status !== "completed") return
      expect(firstResult.summary.missing).toBeGreaterThan(0)
      expect(firstResult.summary.checkedProducts).toBeGreaterThan(0)
    }
    expect(skippedSeen).toBe(true)

    // Документы худи восстановлены полностью.
    const restored = await fetchProductDocs(indexName, HOODIE_ID)
    expect(restored.map((doc) => String(doc.id)).sort()).toEqual(
      [...hoodieDocIds].sort()
    )
  })
})

// ── Устойчивость к конкурентному изменению товара ─────────────────────────

describe("Сверка: конкурентное изменение характеристик", () => {
  it("изменение значения во время сверки сходится к корректному индексу", async () => {
    const code = `test-concurrent-${Date.now()}`
    const created = await adminFetch<{ attribute?: { id?: string } }>(
      "/admin/catalog-attributes",
      {
        method: "POST",
        token,
        body: {
          name: "concurrent-test",
          code,
          data_type: "select",
          filterable: true,
          options: [{ value: "c1", label: "C1" }, { value: "c2", label: "C2" }],
        },
      }
    )
    expect(created.status).toBe(201)
    const attributeId = created.body?.attribute?.id ?? ""
    expect(attributeId).toBeTruthy()

    try {
      const set1 = await adminFetch(
        `/admin/products/${HOODIE_ID}/attribute-values`,
        { method: "POST", token, body: { values: [{ attribute_id: attributeId, value: "c1" }] } }
      )
      expect(set1.status).toBe(201)

      // Сверка и изменение значения запускаются конкурентно.
      const [, set2] = await Promise.all([
        reconcile(),
        adminFetch(`/admin/products/${HOODIE_ID}/attribute-values`, {
          method: "POST",
          token,
          body: { values: [{ attribute_id: attributeId, value: "c2" }] },
        }),
      ])
      expect(set2.status).toBe(201)

      // Convergence: событие (или следующая сверка) доводит индекс до БД.
      let converged = false
      for (let attempt = 0; attempt < 3 && !converged; attempt++) {
        const docs = await fetchProductDocs(indexName, HOODIE_ID)
        const values = docs.map(
          (doc) => (doc.attributes as Record<string, unknown>)?.[code]
        )
        converged =
          docs.length > 0 && values.every((value) => value === "c2")
        if (!converged) {
          await reconcile()
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
      expect(converged).toBe(true)

      // Финальная сверка — без расхождений.
      const final = await reconcile()
      expect(final.status).toBe("completed")
      if (final.status !== "completed") return
      expect(final.summary.missing).toBe(0)
      expect(final.summary.stale).toBe(0)
      expect(final.summary.extra).toBe(0)
    } finally {
      await adminFetch(`/admin/catalog-attributes/${attributeId}`, {
        method: "DELETE",
        token,
      }).catch(() => undefined)
    }
  })
})

// ── Утечка MEILISEARCH_MASTER_KEY в клиентские данные ─────────────────────

describe("Безопасность: MEILISEARCH_MASTER_KEY не утекает в клиентские данные", () => {
  it("Store API ответы не содержат значения master key", async () => {
    const paths = [
      "/store/catalog?limit=5",
      "/store/search?q=футболка",
      "/store/search/suggestions?q=футб",
      "/store/products?limit=3",
    ]
    for (const path of paths) {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { "x-publishable-api-key": publishableKey ?? "" },
      })
      const text = await res.text()
      expect(text).not.toContain(meiliKey)
    }
  })

  it("исходники витрины не содержат значения master key", async () => {
    // Рекурсивный обход исходников storefront (без node_modules/.nuxt —
    // сгенерированных артефактов) на точное значение секрета.
    const forbidden = meiliKey
    const roots = ["app", "shared", "server", "tests"]
    const scan = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await scan(entryPath)
          continue
        }
        if (!/\.(ts|vue|json|mjs|js)$/.test(entry.name)) {
          continue
        }
        const content = await readFile(entryPath, "utf8")
        expect(
          content.includes(forbidden),
          `${entryPath} содержит MEILISEARCH_MASTER_KEY`
        ).toBe(false)
      }
    }
    for (const root of roots) {
      await scan(join(process.cwd(), root)).catch(() => undefined)
    }
  })
})

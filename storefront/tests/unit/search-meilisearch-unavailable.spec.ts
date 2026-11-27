import { beforeAll, describe, expect, it } from "vitest"

/**
 * Unit-тесты обработки недоступности Meilisearch (этап 3.6.3): реальный
 * клиент провайдера (backend/src/modules/search-meilisearch/.../client.ts)
 * против закрытого порта. Интеграция запуска job при полностью лежащем
 * Meilisearch проверена вручную на живом окружении (27.11.2026, PROGRESS
 * №35) — из теста контейнерами управлять нельзя.
 */

type Client = {
  health: () => Promise<boolean>
  fetchDocuments: (
    uid: string,
    options: { limit?: number }
  ) => Promise<{ results: Array<Record<string, unknown>>; total: number }>
}

let MeilisearchClientCtor: new (options: {
  host: string
  masterKey: string
  requestTimeoutMs?: number
  retries?: number
}) => Client

beforeAll(async () => {
  const backendRoot =
    process.env.BACKEND_SRC_DIR ?? "/server/repo/backend/src"
  const module = (await import(
    `${backendRoot}/modules/search-meilisearch/providers/meilisearch/client`
  )) as unknown as { MeilisearchClient: typeof MeilisearchClientCtor }
  MeilisearchClientCtor = module.MeilisearchClient
})

/** Порт без слушателя — соединение отвергается мгновенно. */
const DEAD_HOST = "http://127.0.0.1:9"

function deadClient(): Client {
  return new MeilisearchClientCtor({
    host: DEAD_HOST,
    masterKey: "test-key",
    requestTimeoutMs: 250,
    retries: 0,
  })
}

describe("Клиент Meilisearch при недоступном сервисе", () => {
  it("health() детерминированно отвергается сетевой ошибкой (job обрабатывает .catch)", async () => {
    // Контракт клиента: недоступность — исключение MeilisearchNetworkError;
    // job сверки оборачивает вызов health() в .catch(() => false) и
    // пропускает запуск без записей (проверено на живом окружении).
    await expect(deadClient().health()).rejects.toThrow()
  })

  it("fetchDocuments отвергается ошибкой сети (сверка фиксирует и пропускает)", async () => {
    await expect(
      deadClient().fetchDocuments("store_products_v3", { limit: 10 })
    ).rejects.toThrow()
  })

  it("повторные вызовы дают тот же контролируемый отказ (нет зависания/мусора)", async () => {
    const client = deadClient()
    await expect(client.health()).rejects.toThrow()
    await expect(client.health()).rejects.toThrow()
  })
})

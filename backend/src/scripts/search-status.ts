import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { MeilisearchClient } from "../modules/search-meilisearch/providers/meilisearch/client"

/**
 * Статус поисковой подсистемы (make search-status).
 *
 * Показывает: здоровье Meilisearch, логические индексы официального Search
 * Module (статус жизненного цикла) и физические индексы Meilisearch
 * (количество документов).
 */
export default async function searchStatus({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const searchService = container.resolve(Modules.SEARCH)

  const client = new MeilisearchClient({
    host: process.env.MEILISEARCH_HOST || "http://meilisearch:7700",
    masterKey: process.env.MEILISEARCH_MASTER_KEY,
  })

  const healthy = await client.health().catch(() => false)
  if (!healthy) {
    logger.error("Meilisearch недоступен — проверьте сервис (docker compose logs meilisearch)")
    process.exitCode = 1
    return
  }
  logger.info("Meilisearch: OK (доступен)")

  const indexes = await searchService.listIndexes()
  if (!indexes.length) {
    logger.warn("Логические индексы не зарегистрированы — выполните make search-init")
    return
  }

  for (const index of indexes) {
    logger.info(
      `Индекс «${index.name}»: provider=${index.provider}, status=${index.status}, ` +
        `полей=${index.fields.length}`
    )
  }

  const physical = await client.listIndexes()
  if (!physical.length) {
    logger.warn("Физические индексы Meilisearch не найдены — выполните make search-init")
    return
  }

  for (const entry of physical) {
    const stats = await client.indexStats(entry.uid)
    logger.info(
      `Физический индекс «${entry.uid}»: документов=${stats.numberOfDocuments ?? 0}`
    )
  }

  // Проверка поискового API: тестовый запрос через официальный сервис.
  const result = await searchService.search({
    entity: "products",
    filters: {},
    pagination: { take: 1, skip: 0 },
    search_options: { count: "exact" },
  })
  logger.info(
    `Проверка поиска: count=${result.metadata.count ?? "n/a"}, hits=${result.hits.length}`
  )

  if ((result.metadata.count ?? 0) === 0) {
    logger.warn("Индекс пуст — выполните make search-reindex")
  }
}

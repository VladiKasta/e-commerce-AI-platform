import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { MeilisearchClient } from "../modules/search-meilisearch/providers/meilisearch/client"

/**
 * Полная переиндексация каталога (make search-reindex).
 *
 * Стратегия swap (по умолчанию официального Search Module): строится НОВАЯ
 * версия физического индекса, заполняется, и только затем атомарно становится
 * активной; читатели все это время обслуживаются старой версией. Операция
 * синхронная — выполнение ожидает применения всех задач Meilisearch
 * (провайдер реализует waitForTask), так что выход из скрипта означает
 * завершенную замену.
 *
 * Идемпотентна: повторный запуск строит следующую версию поверх актуальной.
 */
export default async function searchReindex({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const searchService = container.resolve(Modules.SEARCH)

  logger.info("Полная переиндексация (стратегия swap: новая версия + атомарное переключение)...")
  const result = await searchService.reindex({
    index: "products",
    strategy: "swap",
  })
  logger.info(`Переиндексация завершена: job=${result.job_id}, индексы=[${result.indexes.join(", ")}]`)

  const client = new MeilisearchClient({
    host: process.env.MEILISEARCH_HOST || "http://meilisearch:7700",
    masterKey: process.env.MEILISEARCH_MASTER_KEY,
  })

  for (const entry of await client.listIndexes()) {
    const stats = await client.indexStats(entry.uid)
    logger.info(`Физический индекс «${entry.uid}»: документов=${stats.numberOfDocuments ?? 0}`)
  }
}

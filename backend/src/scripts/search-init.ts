import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { MeilisearchClient } from "../modules/search-meilisearch/providers/meilisearch/client"

/**
 * Инициализация поиска (make search-init, вызывается также при make init).
 *
 * Идемпотентно:
 *  1. Применяет план миграций поисковых индексов (создает отсутствующие
 *     физические индексы и применяет настройки; на актуальном состоянии —
 *     пустой план без действий).
 *  2. Заполняет пустые индексы (первоначальная индексация).
 *  3. Проверяет, что поисковый API отвечает.
 *
 * Повторный запуск не создает дубликатов и не трогает заполненные индексы.
 */
export default async function searchInit({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const searchService = container.resolve(Modules.SEARCH)

  logger.info("Применение плана миграций поисковых индексов...")
  const plan = await searchService.createIndexMigrationPlan()
  if (plan.length) {
    for (const action of plan) {
      logger.info(
        `План: ${action.action} → ${action.index}` +
          ("physical_name" in action ? ` (${String(action.physical_name)})` : "")
      )
    }
    await searchService.executeIndexMigrationPlan(plan)
    logger.info("Миграции поисковых индексов применены")
  } else {
    logger.info("Поисковые индексы актуальны — миграции не требуются")
  }

  const indexes = await searchService.listIndexes()
  const client = new MeilisearchClient({
    host: process.env.MEILISEARCH_HOST || "http://meilisearch:7700",
    masterKey: process.env.MEILISEARCH_MASTER_KEY,
  })

  const healthy = await client.health().catch(() => false)
  if (!healthy) {
    logger.error("Meilisearch недоступен")
    process.exitCode = 1
    return
  }

  // Первоначальная индексация: только для пустых индексов (идемпотентность).
  for (const index of indexes) {
    const physical = await client.listIndexes()
    const counts = await Promise.all(
      physical.map(async (entry) => ({
        uid: entry.uid,
        count: (await client.indexStats(entry.uid)).numberOfDocuments ?? 0,
      }))
    )
    const related = counts.filter((entry) => entry.uid.startsWith(index.name))
    const total = related.reduce((sum, entry) => sum + entry.count, 0)

    if (total > 0) {
      logger.info(`Индекс «${index.name}» уже заполнен (${total} документов) — пропускаю`)
      continue
    }

    logger.info(`Первоначальная индексация «${index.name}»...`)
    const result = await searchService.reindex({
      index: index.name,
      strategy: "in_place",
    })
    logger.info(
      `Индексация завершена: job=${result.job_id}, индексы=[${result.indexes.join(", ")}]`
    )
  }

  // Проверка поискового API.
  const probe = await searchService.search({
    entity: "products",
    filters: {},
    pagination: { take: 1, skip: 0 },
    search_options: { count: "exact" },
  })
  logger.info(
    `Проверка поиска: count=${probe.metadata.count ?? "n/a"} — ` +
      (probe.metadata.count ? "OK" : "ИНДЕКС ПУСТ, выполните make seed + make search-reindex")
  )
  logger.info("Инициализация поиска завершена")
}

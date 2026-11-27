import type { ScheduledJobHandler } from "@medusajs/framework/jobs"
import type {
  ILockingModule,
  Logger,
  MedusaContainer,
  RemoteQueryFunction,
  SearchTypes,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"
import { MeilisearchClient } from "../modules/search-meilisearch/providers/meilisearch/client"
import {
  compileFilters,
  isMeilisearchNetworkError,
} from "../modules/search-meilisearch/providers/meilisearch/filters"
import { resolveActivePhysicalNameFromModule } from "../services/catalog-search"
import {
  INDEX_NAME,
  buildProductDocuments,
  loadProductAttributeData,
  loadProductRows,
} from "../search/products"

/**
 * Scheduled job: периодическая сверка поискового индекса с PostgreSQL (этап 3.6.2).
 *
 * PostgreSQL — источник достоверных данных. Сверка проходит товары батчами
 * (без загрузки каталога в память), для каждого товара собирает ОЖИДАЕМЫЕ
 * документы теми же загрузчиками и трансформацией, что использует индексатор
 * (`backend/src/search/products.ts` — второго индексатора нет), и сравнивает их
 * с ФАКТИЧЕСКИМИ сырыми документами активного физического индекса Meilisearch.
 *
 * Обнаруживает и исправляет:
 *  - отсутствующие документы (есть в PG, нет в индексе);
 *  - устаревшие документы (содержимое отличается от пересобранного из PG);
 *  - лишние документы (вариант/валюта/товар исчезли, документ остался);
 *  - сироты (документы товаров, которых больше нет в PG, включая неопубликованные
 *    без документов — весь товарный след).
 *
 * Ремонт — только затронутых товаров, штатными механизмами Search Module:
 *  - отсутствующие/устаревшие — `reindex({ filters: { product_ids } })`:
 *    официальная частичная переиндексация «in place» в активную версию
 *    (без swap и без полной переиндексации), под внутренним lock'ом
 *    `search:seed:<index>` — конфликт с полной переиндексацией/wait приводит
 *    к ожиданию и отказу, повтор на следующем запуске;
 *  - лишние/сироты — `deleteDocuments` официального сервиса.
 *
 * Параллельные запуски сверки исключаются штатным Locking Module
 * (`search:reconcile:<index>`); запуск при занятом lock-е пропускается.
 * Идемпотентность: ремонт — upsert/удаление, производные от PG; повторный
 * запуск на корректном индексе не выполняет ни одной записи.
 *
 * Недоступность Meilisearch: job фиксирует ошибку и завершается без записей;
 * следующий запуск по расписанию восстанавливает данные.
 *
 * Расписание — SEARCH_RECONCILE_CRON из корневого .env (по умолчанию раз в час).
 */

/** Товаров в батче сверки — как batchSize seed'а определения индекса. */
const PRODUCT_BATCH_SIZE = 50
/** Документов на один запрос чтения (предел Meilisearch documents/fetch). */
const FETCH_PAGE_SIZE = 1000
/** Значений id в одном вызове deleteDocuments. */
const DELETE_CHUNK_SIZE = 500
/** Ключ блокировки параллельных запусков сверки. */
const RECONCILE_LOCK_KEY = `search:reconcile:${INDEX_NAME}`
/** Срок жизни lock-а (сек) — страховка от зависшего запуска. */
const LOCK_EXPIRE_SECONDS = 30 * 60

export const config = {
  name: "search-index-reconcile",
  schedule: process.env.SEARCH_RECONCILE_CRON || "0 * * * *",
}

/** Сводка сверки — для логирования, Admin API и тестов. */
type ReconcileSummary = {
  /** Подтвержденный (ready) физический индекс активной версии, с которым сверялись. */
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

function emptySummary(): ReconcileSummary {
  return {
    physicalName: null,
    checkedProducts: 0,
    checkedDocs: 0,
    missing: 0,
    stale: 0,
    extra: 0,
    orphanProducts: 0,
    orphanDocs: 0,
    reindexedProducts: 0,
    deletedDocs: 0,
    errors: 0,
  }
}

/**
 * Каноническая форма документа для сравнения: ключи объектов и ЭЛЕМЕНТЫ
 * массивов сортируются. Массивы документа (category_ids, значения
 * характеристик) Meilisearch использует как множества для фильтрации и
 * фасетов, порядок элементов не входит в контракт документа и может
 * отличаться между сборками — сравнение множеств исключает ложные
 * «устаревшие» документы и холостые переиндексации.
 *
 * Экспортирована для unit-тестов сверки (storefront/tests/unit).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).sort().join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(
      ([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`
    )
    .sort()
  return `{${entries.join(",")}}`
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size))
  }
  return result
}

/** Все страницы documents/fetch по одному фильтру (batches, не весь каталог). */
async function fetchAllDocuments(
  client: MeilisearchClient,
  physicalName: string,
  filter: string | Array<string | string[]>
): Promise<Array<Record<string, unknown>>> {
  const documents: Array<Record<string, unknown>> = []
  let offset = 0
  for (;;) {
    const page = await client.fetchDocuments(physicalName, {
      filter,
      limit: FETCH_PAGE_SIZE,
      offset,
    })
    documents.push(...page.results)
    offset += page.results.length
    if (!page.results.length || offset >= page.total) {
      return documents
    }
  }
}

/**
 * Один запуск сверки: сравнение PG ↔ активный индекс, точечный ремонт.
 * Возвращает сводку (пишет ход в лог).
 */
export async function runSearchReconcile(
  container: MedusaContainer,
  logger: Logger
): Promise<ReconcileSummary> {
  const query = container.resolve<RemoteQueryFunction>(
    ContainerRegistrationKeys.QUERY
  )
  const searchService =
    container.resolve<SearchTypes.ISearchModuleService>(Modules.SEARCH)
  const client = new MeilisearchClient({
    host: process.env.MEILISEARCH_HOST || "http://meilisearch:7700",
    masterKey: process.env.MEILISEARCH_MASTER_KEY,
  })

  const summary = emptySummary()

  // Недоступность Meilisearch — штатная ситуация: без записей, без падения.
  const healthy = await client.health().catch(() => false)
  if (!healthy) {
    summary.errors++
    logger.warn(
      "[Search reconcile] Meilisearch недоступен — сверка пропущена, данные не изменялись; повторится по расписанию"
    )
    return summary
  }

  // Активная ready-версия — подтверждение из БД модуля (как у каталог-сервиса).
  const physicalName = await resolveActivePhysicalNameFromModule(
    container,
    INDEX_NAME
  )
  if (!physicalName) {
    summary.errors++
    logger.warn(
      "[Search reconcile] Активная ready-версия индекса не определена — сверка пропущена"
    )
    return summary
  }
  summary.physicalName = physicalName

  const affected = new Set<string>()
  const extraDocIds: string[] = []
  const pgProductIds = new Set<string>()
  let lastId: string | null = null

  // ── Проход 1: PostgreSQL — источник истина, батчи товаров по id ──────────
  for (;;) {
    let batchIds: string[] = []
    try {
      const page = await query.graph({
        entity: "product",
        fields: ["id"],
        filters: lastId ? { id: { $gt: lastId } } : {},
        pagination: {
          order: { id: "ASC" } as Record<string, string>,
          skip: 0,
          take: PRODUCT_BATCH_SIZE,
        },
      } as Parameters<RemoteQueryFunction["graph"]>[0])
      batchIds = (page.data as unknown as Array<{ id: string }>).map(
        (row) => row.id
      )
      if (!batchIds.length) {
        break
      }

      const [productRows, attributeData] = await Promise.all([
        loadProductRows(query, batchIds),
        loadProductAttributeData(query, batchIds),
      ])
      const expected = buildProductDocuments(
        productRows,
        attributeData.attributesById,
        attributeData.valuesByProduct
      )
      const batchFilter = compileFilters({ product_id: batchIds })
      if (batchFilter === undefined) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Не удалось скомпилировать фильтр чтения документов батча (пустой список товаров)"
        )
      }
      const actual = await fetchAllDocuments(client, physicalName, batchFilter)

      const expectedByProduct = new Map<string, SearchTypes.SearchDocument[]>()
      for (const document of expected) {
        const key = String(document.product_id)
        const bucket = expectedByProduct.get(key) ?? []
        bucket.push(document)
        expectedByProduct.set(key, bucket)
      }
      const actualByProduct = new Map<string, Array<Record<string, unknown>>>()
      for (const document of actual) {
        const key = String(document.product_id ?? "")
        if (!key) {
          continue
        }
        const bucket = actualByProduct.get(key) ?? []
        bucket.push(document)
        actualByProduct.set(key, bucket)
      }

      for (const productId of batchIds) {
        pgProductIds.add(productId)
        const expectedDocs = expectedByProduct.get(productId) ?? []
        const actualDocs = actualByProduct.get(productId) ?? []
        summary.checkedDocs += actualDocs.length

        const expectedById = new Map(
          expectedDocs.map((document) => [String(document.id), document])
        )
        let productAffected = false

        for (const document of expectedDocs) {
          if (!actualDocs.some((entry) => String(entry.id) === String(document.id))) {
            summary.missing++
            productAffected = true
          }
        }
        for (const entry of actualDocs) {
          const docId = String(entry.id)
          const expectedDoc = expectedById.get(docId)
          if (!expectedDoc) {
            summary.extra++
            extraDocIds.push(docId)
            productAffected = true
            continue
          }
          if (canonicalJson(entry) !== canonicalJson(expectedDoc)) {
            summary.stale++
            productAffected = true
          }
        }
        if (productAffected) {
          affected.add(productId)
        }
      }

      summary.checkedProducts += batchIds.length
      lastId = batchIds[batchIds.length - 1] ?? null
      if (!lastId) {
        break
      }
    } catch (error) {
      summary.errors++
      if (isMeilisearchNetworkError(error)) {
        logger.error(
          `[Search reconcile] Meilisearch недоступен во время сверки (батч после ${lastId ?? "начала"}): ${error.message}. Проход прерван, записи не выполнялись`
        )
        return summary
      }
      logger.error(
        `[Search reconcile] Ошибка сверки батча (после ${lastId ?? "начала"}): ${error instanceof Error ? error.message : String(error)}`
      )
      if (!batchIds.length) {
        break
      }
      lastId = batchIds[batchIds.length - 1]
    }
  }

  // ── Проход 2: сироты — product_id в индексе, отсутствующие в PG ─────────
  try {
    const indexDocCounts = new Map<string, number>()
    let offset = 0
    for (;;) {
      const page = await client.fetchDocuments(physicalName, {
        fields: ["product_id"],
        limit: FETCH_PAGE_SIZE,
        offset,
      })
      for (const document of page.results) {
        const productId = String(document.product_id ?? "")
        if (!productId) {
          continue
        }
        indexDocCounts.set(productId, (indexDocCounts.get(productId) ?? 0) + 1)
      }
      offset += page.results.length
      if (!page.results.length || offset >= page.total) {
        break
      }
    }

    const orphans = [...indexDocCounts.keys()].filter(
      (productId) => !pgProductIds.has(productId)
    )
    for (const productId of orphans) {
      summary.orphanDocs += indexDocCounts.get(productId) ?? 0
    }
    summary.orphanProducts = orphans.length

    // ── Ремонт (только затронутые товары, штатные механизмы модуля) ──────
    if (extraDocIds.length) {
      for (const part of chunk(extraDocIds, DELETE_CHUNK_SIZE)) {
        await searchService.deleteDocuments({
          index: INDEX_NAME,
          filters: { id: part },
        })
        summary.deletedDocs += part.length
      }
    }
    if (orphans.length) {
      for (const part of chunk(orphans, DELETE_CHUNK_SIZE)) {
        await searchService.deleteDocuments({
          index: INDEX_NAME,
          filters: { product_id: part },
        })
      }
      summary.deletedDocs += summary.orphanDocs
    }
    if (affected.size) {
      await searchService.reindex({
        index: INDEX_NAME,
        filters: { product_ids: [...affected] },
      })
      summary.reindexedProducts = affected.size
    }
  } catch (error) {
    summary.errors++
    if (isMeilisearchNetworkError(error)) {
      logger.error(
        `[Search reconcile] Meilisearch недоступен на этапе ремонта: ${error.message}. Частичный ремонт применен, продолжит следующий запуск`
      )
    } else {
      logger.error(
        `[Search reconcile] Ошибка ремонта: ${error instanceof Error ? error.message : String(error)}. Продолжит следующий запуск`
      )
    }
  }

  logger.info(
    `[Search reconcile] Проверено из PostgreSQL: товаров ${summary.checkedProducts}, документов ${summary.checkedDocs}. ` +
      `Расхождения: отсутствующих ${summary.missing}, устаревших ${summary.stale}, лишних ${summary.extra}, ` +
      `сирот ${summary.orphanProducts} (${summary.orphanDocs} документов). ` +
      `Исправлено: переиндексировано товаров ${summary.reindexedProducts}, удалено документов ${summary.deletedDocs}. ` +
      `Ошибок: ${summary.errors}`
  )

  return summary
}

/**
 * Сводка сверки (см. маршрут POST /admin/search/reconcile и job).
 */
export type { ReconcileSummary }

/**
 * Сверка под блокировкой: параллельные запуски (наложение расписания,
 * ручной запуск, Admin API) пропускаются. Используется штатный Locking
 * Module — тот же, которым Search Module защищает seeding. Возвращает
 * статус и сводку выполненного запуска (для маршрута Admin API).
 */
/**
 * Сверка под блокировкой: параллельные запуски (наложение расписания,
 * ручной запуск, Admin API) пропускаются. Используется штатный Locking
 * Module — тот же, которым Search Module защищает seeding. Возвращает
 * статус и сводку выполненного запуска (для маршрута Admin API).
 *
 * ownerId уникален на каждый запуск (рекомендация Locking Module): один
 * и тот же владелец для Locking-провайдеров реентерабелен, константа
 * пускала бы параллельные запуски одного владельца мимо lock-а.
 */
export async function executeSearchReconcile(
  container: MedusaContainer,
  logger: Logger
): Promise<
  | { status: "completed"; summary: ReconcileSummary }
  | { status: "skipped" }
> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const ownerId = `search-reconcile-${randomUUID()}`

  try {
    await locking.acquire(RECONCILE_LOCK_KEY, {
      ownerId,
      expire: LOCK_EXPIRE_SECONDS,
    })
  } catch {
    logger.info(
      `[Search reconcile] Пропущен: предыдущий запуск еще выполняется (lock ${RECONCILE_LOCK_KEY})`
    )
    return { status: "skipped" }
  }

  try {
    const summary = await runSearchReconcile(container, logger)
    return { status: "completed", summary }
  } finally {
    await locking
      .release(RECONCILE_LOCK_KEY, { ownerId })
      .catch(() => undefined)
  }
}

const searchIndexReconcile: ScheduledJobHandler = async (container) => {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  await executeSearchReconcile(container, logger)
}

export default searchIndexReconcile

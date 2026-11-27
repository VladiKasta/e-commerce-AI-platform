import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework/subscribers"
import type { Event, SearchTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  CATALOG_ATTRIBUTES_MODULE,
  type CatalogAttributeModuleService,
} from "../modules/catalog-attributes"

/**
 * Мост тонких событий удаления значений характеристик → Search Module.
 *
 * Medusa 2.23 эмитит для модели product_attribute_value события с
 * data = {id} строки значения (имя — catalog_attributes.product-attribute-value.deleted,
 * kebab-case от имени модели). К моменту доставки события строка уже
 * soft-deleted, а consume определения индекса имеет доступ только к remote
 * query (context.container модуля поиска ограничен query и logger), который
 * не возвращает soft-deleted записи — товар из такого события не резолвится.
 *
 * Подписчик резолвит затронутые товары через сервис модуля
 * (listProductAttributeValues c withDeleted) и повторно подает событие
 * (уже с product_id в payload) в официальный ingestion-конвейер —
 * searchModule.ingest, тот же вход, которым пользуется встроенный
 * search-ingestion подписчик Medusa. Второго индексатора нет: документы
 * собирает то же самое определение индекса products.
 */

/** Имя события, под которым обогащенное событие маршрутизируется в consume. */
const VALUE_DELETED_EVENT = "catalog_attributes.product-attribute-value.deleted"

export default async function catalogAttributeValueDeleted({
  event,
  container,
}: SubscriberArgs<{ id?: string | string[] }>): Promise<void> {
  const rawId = event.data?.id
  const valueIds = Array.isArray(rawId) ? rawId : rawId ? [String(rawId)] : []
  if (!valueIds.length) {
    return
  }

  const attributeService = container.resolve<CatalogAttributeModuleService>(
    CATALOG_ATTRIBUTES_MODULE
  )

  // Строки к этому моменту soft-deleted — читаем их с withDeleted.
  const rows = await attributeService.listProductAttributeValues(
    { id: valueIds } as Parameters<
      CatalogAttributeModuleService["listProductAttributeValues"]
    >[0],
    { withDeleted: true }
  )

  const productIds = [...new Set(rows.map((row) => row.product_id))]
  if (!productIds.length) {
    return
  }

  const searchService = container.resolve<SearchTypes.ISearchModuleService>(
    Modules.SEARCH
  )

  await searchService.ingest({
    name: VALUE_DELETED_EVENT,
    data: { id: valueIds, product_id: productIds },
    metadata: event.metadata,
  } satisfies Event<Record<string, unknown>>)
}

export const config: SubscriberConfig = {
  event: [VALUE_DELETED_EVENT],
  context: { subscriberId: "catalog-attribute-values-search-sync" },
}

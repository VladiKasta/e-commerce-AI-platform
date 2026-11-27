import type { Event, SearchTypes } from "@medusajs/framework/types"
import { defineSearchIndex, search } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/framework/types"

/**
 * Поисковый индекс каталога «products».
 *
 * Модель: один документ на (вариант товара × валюта) — единственная модель,
 * корректно решающая сценарии этапа 3 (проверено техническим прототипом
 * infrastructure/scripts/search-prototype.mjs):
 *
 *  - Фильтрация вариант-ориентированная: цвет+размер+наличие относятся к
 *    одному варианту, поэтому комбинация, существующая только у отсутствующего
 *    варианта, не находит товар.
 *  - distinctAttribute: product_id — выдача сгруппирована по товарам,
 *    один документ на товар; page-пагинация возвращает ТОЧНЫЙ totalHits.
 *  - Динамические характеристики лежат в объекте attributes: Meilisearch
 *    фильтрует и фасетирует их через родительский объект в
 *    filterableAttributes, поэтому новые характеристики не требуют
 *    изменения индекса.
 *  - Региональные цены: валюта — атрибут документа; маршруты каталога
 *    всегда фильтруют по currency_code региона (регион проверяется на
 *    backend), цены хранятся в основных единицах Medusa (1490 = 1490 ₽).
 *
 * Синхронизация: официальный Search Module Medusa запускает seed при
 * отсутствии данных и consume по событиям (список ниже); полная
 * переиндексация — версионированная (новый физический индекс + атомарное
 * переключение версии), see docs/indexing.md.
 */

const INDEX_NAME = "products"

type AttributeRow = {
  id: string
  code: string
  data_type: string
  option_title?: string | null
}

type ProductAttributeValueRow = {
  product_id: string
  variant_id?: string | null
  attribute_id: string
  text_value?: string | null
  numeric_value?: number | null
  boolean_value?: boolean | null
}

type ProductRow = {
  id: string
  handle: string
  title: string
  description?: string | null
  status?: string
  thumbnail?: string | null
  created_at?: string
  updated_at?: string
  categories?: Array<{ id: string; handle: string }>
  collection?: { id: string; handle: string } | null
  sales_channels?: Array<{ id: string }>
  variants?: Array<{
    id: string
    sku?: string | null
    title?: string | null
    manage_inventory?: boolean
    allow_backorder?: boolean
    options?: Array<{ value: string; option?: { title?: string } | null }>
    prices?: Array<{
      currency_code: string
      amount?: number | string | null
      price_list_id?: string | null
      price_list?: { id?: string } | null
    }>
    inventory?: Array<{
      stocked_quantity?: number
      reserved_quantity?: number
    }>
  }>
}

/** Поля графа, из которых собирается поисковый документ. */
const PRODUCT_FIELDS = [
  "id",
  "handle",
  "title",
  "description",
  "status",
  "thumbnail",
  "created_at",
  "updated_at",
  "categories.id",
  "categories.handle",
  "collection.id",
  "collection.handle",
  "sales_channels.id",
  "variants.id",
  "variants.sku",
  "variants.title",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "variants.options.value",
  "variants.options.option.title",
  "variants.prices.currency_code",
  "variants.prices.amount",
  "variants.prices.price_list_id",
  "variants.inventory.stocked_quantity",
  "variants.inventory.reserved_quantity",
]

const ATTRIBUTE_FIELDS = [
  "id",
  "code",
  "data_type",
  "option_title",
]

const VALUE_FIELDS = [
  "attribute_id",
  "product_id",
  "variant_id",
  "text_value",
  "numeric_value",
  "boolean_value",
]

function toTimestamp(value?: string | null): number {
  if (!value) {
    return 0
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000)
}

function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const amount = typeof value === "string" ? Number.parseFloat(value) : value
  return Number.isFinite(amount) ? amount : null
}

/**
 * Значения характеристик товара, разделенные по области действия:
 *
 *  - productLevel — значения, назначенные товару (variant_id = null);
 *  - perVariant — значения конкретных вариантов: назначенные вручную
 *    (variant_id задан) и выведенные из штатных опций Medusa через
 *    Attribute.option_title (цвет/размер покупаемого варианта).
 *
 * Разделение критично для вариант-ориентированной фильтрации: цвет и размер
 * варианта попадают только в его документы, а не во все документы товара.
 */
function collectAttributes(
  product: ProductRow,
  attributesById: Map<string, AttributeRow>,
  values: ProductAttributeValueRow[]
): {
  productLevel: Map<string, Array<string | number | boolean>>
  perVariant: Map<string, Map<string, string | number | boolean>>
} {
  const productLevel = new Map<string, Array<string | number | boolean>>()
  const perVariant = new Map<string, Map<string, string | number | boolean>>()

  for (const row of values) {
    const attribute = attributesById.get(row.attribute_id)
    if (!attribute) {
      continue
    }
    const value = row.text_value ?? row.numeric_value ?? row.boolean_value ?? null
    if (value === null) {
      continue
    }

    if (row.variant_id) {
      const scoped = perVariant.get(row.variant_id) ?? new Map()
      scoped.set(attribute.code, value)
      perVariant.set(row.variant_id, scoped)
    } else {
      const bucket = productLevel.get(attribute.code) ?? []
      if (!bucket.includes(value)) {
        bucket.push(value)
      }
      productLevel.set(attribute.code, bucket)
    }
  }

  // Значения, выведенные из штатных опций варианта (цвет/размер).
  const optionAttributes = [...attributesById.values()].filter(
    (attribute): attribute is AttributeRow & { option_title: string } =>
      typeof attribute.option_title === "string" && attribute.option_title.length > 0
  )

  for (const variant of product.variants ?? []) {
    for (const attribute of optionAttributes) {
      const option = (variant.options ?? []).find(
        (entry) => entry.option?.title === attribute.option_title
      )
      if (!option) {
        continue
      }
      const scoped = perVariant.get(variant.id) ?? new Map()
      // Назначенное вручную значение варианта имеет приоритет над опцией.
      if (!scoped.has(attribute.code)) {
        scoped.set(attribute.code, option.value)
      }
      perVariant.set(variant.id, scoped)
    }
  }

  return { productLevel, perVariant }
}

function buildDocuments(
  products: ProductRow[],
  attributesById: Map<string, AttributeRow>,
  valuesByProduct: Map<string, ProductAttributeValueRow[]>
): SearchTypes.SearchDocument[] {
  const documents: SearchTypes.SearchDocument[] = []

  for (const product of products) {
    // В индекс попадают только опубликованные товары.
    if (product.status !== "published") {
      continue
    }

    const values = valuesByProduct.get(product.id) ?? []
    const { productLevel, perVariant } = collectAttributes(
      product,
      attributesById,
      values
    )

    const productAttributes: Record<string, unknown> = {}
    for (const [code, bucket] of productLevel) {
      if (bucket.length === 1) {
        productAttributes[code] = bucket[0]
      } else if (bucket.length > 1) {
        productAttributes[code] = bucket
      }
    }

    for (const variant of product.variants ?? []) {
      // Наличие: физический остаток (stocked - reserved) с учетом настроек
      // управления запасами и бэкордера.
      const stocked = (variant.inventory ?? []).reduce(
        (sum, level) => sum + (level.stocked_quantity ?? 0),
        0
      )
      const reserved = (variant.inventory ?? []).reduce(
        (sum, level) => sum + (level.reserved_quantity ?? 0),
        0
      )
      const inStock =
        variant.manage_inventory === false ||
        variant.allow_backorder === true ||
        stocked - reserved > 0

      // Цены: одна запись на валюту; прайс-листы (приватные цены) исключаются.
      const pricesByCurrency = new Map<string, number>()
      for (const price of variant.prices ?? []) {
        const isPriceList = Boolean(price.price_list_id ?? price.price_list?.id)
        if (isPriceList) {
          continue
        }
        const amount = toAmount(price.amount)
        if (amount === null) {
          continue
        }
        const currency = price.currency_code.toLowerCase()
        const current = pricesByCurrency.get(currency)
        if (current === undefined || amount < current) {
          pricesByCurrency.set(currency, amount)
        }
      }

      if (!pricesByCurrency.size) {
        continue
      }

      const attributes: Record<string, unknown> = { ...productAttributes }
      const scoped = perVariant.get(variant.id)
      if (scoped) {
        for (const [code, value] of scoped) {
          attributes[code] = value
        }
      }

      for (const [currency, amount] of pricesByCurrency) {
        documents.push({
          id: `${variant.id}__${currency}`,
          product_id: product.id,
          variant_id: variant.id,
          status: product.status,
          title: product.title,
          description: product.description ?? "",
          sku: variant.sku ?? "",
          handle: product.handle,
          thumbnail: product.thumbnail ?? null,
          currency_code: currency,
          price: amount,
          in_stock: inStock,
          category_ids: (product.categories ?? []).map((entry) => entry.id),
          category_handles: (product.categories ?? []).map((entry) => entry.handle),
          collection_ids: product.collection ? [product.collection.id] : [],
          collection_handles: product.collection ? [product.collection.handle] : [],
          sales_channel_ids: (product.sales_channels ?? []).map((entry) => entry.id),
          attributes,
          created_at: toTimestamp(product.created_at),
          updated_at: toTimestamp(product.updated_at),
        })
      }
    }
  }

  return documents
}

/** Загружает характеристики и их значения для набора товаров. */
async function loadAttributeData(
  query: RemoteQueryFunction,
  productIds: string[]
): Promise<{
  attributesById: Map<string, AttributeRow>
  valuesByProduct: Map<string, ProductAttributeValueRow[]>
}> {
  if (!productIds.length) {
    return { attributesById: new Map(), valuesByProduct: new Map() }
  }

  const [attributeResult, valueResult] = await Promise.all([
    query.graph({
      entity: "attribute",
      fields: ATTRIBUTE_FIELDS,
      pagination: { order: { position: "ASC" } as Record<string, string> },
    } as Parameters<RemoteQueryFunction["graph"]>[0]),
    query.graph({
      entity: "product_attribute_value",
      fields: VALUE_FIELDS,
      filters: { product_id: productIds },
    } as Parameters<RemoteQueryFunction["graph"]>[0]),
  ])

  const attributesById = new Map<string, AttributeRow>(
    (attributeResult.data as unknown as AttributeRow[]).map((row) => [row.id, row])
  )

  const valuesByProduct = new Map<string, ProductAttributeValueRow[]>()
  for (const row of valueResult.data as unknown as ProductAttributeValueRow[]) {
    const bucket = valuesByProduct.get(row.product_id) ?? []
    bucket.push(row)
    valuesByProduct.set(row.product_id, bucket)
  }

  return { attributesById, valuesByProduct }
}

async function loadProductsByIds(
  query: RemoteQueryFunction,
  productIds: string[]
): Promise<ProductRow[]> {
  if (!productIds.length) {
    return []
  }

  const { data } = await query.graph({
    entity: "product",
    fields: PRODUCT_FIELDS,
    filters: { id: productIds },
    pagination: { order: { id: "ASC" } as Record<string, string> },
  } as Parameters<RemoteQueryFunction["graph"]>[0])

  return data as unknown as ProductRow[]
}

/** Собирает upsert-мутации; товары, которых больше нет, удаляет из индекса. */
async function upsertProducts(
  query: RemoteQueryFunction,
  productIds: string[]
): Promise<SearchTypes.SearchMutation[]> {
  const [products, { attributesById, valuesByProduct }] = await Promise.all([
    loadProductsByIds(query, productIds),
    loadAttributeData(query, productIds),
  ])

  const foundIds = new Set(products.map((product) => product.id))
  const missingIds = productIds.filter((id) => !foundIds.has(id))

  const mutations: SearchTypes.SearchMutation[] = []

  if (missingIds.length) {
    mutations.push({
      action: "delete",
      filters: { product_id: missingIds },
    })
  }

  // Удаленные/снятые с публикации товары могли быть прочитаны как есть:
  // buildDocuments их отбрасывает, но документы нужно снять с индекса.
  const publishedIds = products
    .filter((product) => product.status === "published")
    .map((product) => product.id)
  const unpublishedIds = productIds.filter(
    (id) => !publishedIds.includes(id)
  )
  if (unpublishedIds.length) {
    mutations.push({
      action: "delete",
      filters: { product_id: unpublishedIds },
    })
  }

  const documents = buildDocuments(products, attributesById, valuesByProduct)
  if (documents.length) {
    mutations.push({ action: "upsert", documents })
  }

  return mutations
}

/**
 * Резолвит затронутые товары по событию. Возвращает id товаров.
 */
async function resolveAffectedProducts(
  event: Event,
  query: RemoteQueryFunction
): Promise<string[]> {
  const name = event.name
  const data = (event.data ?? {}) as Record<string, unknown>
  const ids = Array.isArray(data.id) ? (data.id as string[]) : data.id ? [String(data.id)] : []

  const startsWith = (prefix: string): boolean =>
    ids.length > 0 && ids.every((id) => id.startsWith(prefix))

  // События товара.
  if (name.startsWith("product.product.")) {
    if (startsWith("prod_")) {
      return ids
    }
    // attached/detached от внутренних связей модуля: продукт передан метаданными.
    const related = (data.product_id ?? data.product_ids ?? null) as string | string[] | null
    if (related) {
      return Array.isArray(related) ? related : [String(related)]
    }
    return []
  }

  // События варианта → товар.
  if (name.startsWith("product.product-variant.")) {
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "product_id"],
      filters: { id: ids },
    } as Parameters<RemoteQueryFunction["graph"]>[0])
    return (variants as unknown as Array<{ product_id: string }>).map((row) => row.product_id)
  }

  // События категорий/коллекций → товары, которым они принадлежат.
  if (name === "product.product-category.updated" || name === "product.product-collection.updated") {
    const filterKey =
      name === "product.product-category.updated" ? "category_id" : "collection_id"
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: { [filterKey]: ids } as Record<string, string[]>,
      pagination: { order: { id: "ASC" } as Record<string, string> },
    } as Parameters<RemoteQueryFunction["graph"]>[0])
    return (products as unknown as Array<{ id: string }>).map((row) => row.id)
  }

  // События цен: цена → набор цен → вариант → товар.
  if (name.startsWith("pricing.price.")) {
    const { data: prices } = await query.graph({
      entity: "price",
      fields: ["id", "price_set_id"],
      filters: { id: ids },
    } as Parameters<RemoteQueryFunction["graph"]>[0])

    const priceSetIds = [
      ...new Set(
        (prices as unknown as Array<{ price_set_id: string }>).map((row) => row.price_set_id)
      ),
    ]
    if (!priceSetIds.length) {
      return []
    }

    const { data: links } = await query.graph({
      entity: "product_variant_price_set",
      fields: ["variant_id", "price_set_id"],
      filters: { price_set_id: priceSetIds },
    } as Parameters<RemoteQueryFunction["graph"]>[0])

    const variantIds = [
      ...new Set(
        (links as unknown as Array<{ variant_id: string }>).map((row) => row.variant_id)
      ),
    ]
    if (!variantIds.length) {
      return []
    }

    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "product_id"],
      filters: { id: variantIds },
    } as Parameters<RemoteQueryFunction["graph"]>[0])
    return (variants as unknown as Array<{ product_id: string }>).map((row) => row.product_id)
  }

  // События инвентаря: item → вариант → товар.
  if (name.startsWith("inventory.inventory-item.")) {
    const { data: items } = await query.graph({
      entity: "inventory_item",
      fields: ["id", "variants.id", "variants.product_id"],
      filters: { id: ids },
    } as Parameters<RemoteQueryFunction["graph"]>[0])

    const products = new Set<string>()
    for (const item of items as unknown as Array<{
      variants?: Array<{ product_id: string }>
    }>) {
      for (const variant of item.variants ?? []) {
        products.add(variant.product_id)
      }
    }
    return [...products]
  }

  // События остатков и резервов: уровень → item → вариант → товар.
  if (name.startsWith("inventory.inventory-level.")) {
    const { data: levels } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "inventory_item_id", "inventory_item.variants.product_id"],
      filters: { id: ids },
    } as Parameters<RemoteQueryFunction["graph"]>[0])

    const products = new Set<string>()
    for (const level of levels as unknown as Array<{
      inventory_item?: { variants?: Array<{ product_id: string }> }
    }>) {
      for (const variant of level.inventory_item?.variants ?? []) {
        products.add(variant.product_id)
      }
    }
    return [...products]
  }

  if (name.startsWith("inventory.reservation-item.")) {
    const { data: reservations } = await query.graph({
      entity: "reservation_item",
      fields: ["id", "inventory_item_id", "inventory_item.variants.product_id"],
      filters: { id: ids },
    } as Parameters<RemoteQueryFunction["graph"]>[0])

    const products = new Set<string>()
    for (const reservation of reservations as unknown as Array<{
      inventory_item?: { variants?: Array<{ product_id: string }> }
    }>) {
      for (const variant of reservation.inventory_item?.variants ?? []) {
        products.add(variant.product_id)
      }
    }
    return [...products]
  }

  // События значений характеристик: значение → товар.
  //
  // Medusa 2.23 строит имена событий моделей модуля через
  // buildModuleResourceEventName: kebabCase от имени модели — многословная
  // модель product_attribute_value эмитится как «product-attribute-value»
  // (проверено на живом окружении). Штатное событие несет только
  // data = {id} строк значений.
  if (name.startsWith("catalog_attributes.product-attribute-value.")) {
    // Обогащенное событие (subscriber catalog-attribute-values-search):
    // id товаров уже в payload — строки-значения к этому моменту
    // soft-deleted и недоступны remote query.
    const related = (data.product_id ?? data.product_ids ?? null) as
      | string
      | string[]
      | null
    if (related) {
      return Array.isArray(related) ? related : [String(related)]
    }
    const { data: values } = await query.graph({
      entity: "product_attribute_value",
      fields: ["id", "product_id"],
      filters: { id: ids },
    } as Parameters<RemoteQueryFunction["graph"]>[0])
    return (values as unknown as Array<{ product_id: string }>).map((row) => row.product_id)
  }

  // События характеристик: товары, у которых есть значения этой характеристики.
  if (name.startsWith("catalog_attributes.attribute.")) {
    const { data: values } = await query.graph({
      entity: "product_attribute_value",
      fields: ["id", "product_id"],
      filters: { attribute_id: ids },
    } as Parameters<RemoteQueryFunction["graph"]>[0])
    return [
      ...new Set((values as unknown as Array<{ product_id: string }>).map((row) => row.product_id)),
    ]
  }

  return []
}

function parseJsonEnv<T>(name: string, fallback: T): T {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    // Ошибку конфигурации нельзя уронить на этапе загрузки определений:
    // используем значения по умолчанию и предупреждаем через консоль.
    console.warn(
      `[search] ${name} содержит некорректный JSON — использованы значения по умолчанию`
    )
    return fallback
  }
}

const DEFAULT_STOP_WORDS = ["и", "в", "с", "для", "на"]

const productFields = search.define({
  id: search.keyword(),
  product_id: search.keyword().filterable(),
  variant_id: search.keyword(),
  status: search.keyword().filterable(),
  title: search.text().searchable(),
  description: search.text().searchable(),
  sku: search.text().searchable().filterable(),
  handle: search.keyword(),
  thumbnail: search.keyword(),
  currency_code: search.keyword().filterable(),
  price: search.float().filterable().sortable().facetable({ types: ["range", "stats"] }),
  in_stock: search.boolean().filterable().facetable(),
  category_ids: search.keyword().array().filterable(),
  category_handles: search.keyword().array().filterable(),
  collection_ids: search.keyword().array().filterable(),
  collection_handles: search.keyword().array().filterable(),
  sales_channel_ids: search.keyword().array().filterable(),
  /**
   * Динамические характеристики: бренды, материалы, цвета, размеры,
   * технические параметры. Подполя создаются администратором на лету,
   * поэтому схема не перечисляет их: Meilisearch фильтрует и фасетирует
   * весь вложенный объект через родительский "attributes" в
   * filterableAttributes (проверено прототипом), поиск идет по всем
   * вложенным значениям через searchable_parents.
   */
  attributes: search.object({}).filterable(),
  created_at: search.integer().sortable(),
  updated_at: search.integer().sortable(),
})

export default defineSearchIndex({
  name: INDEX_NAME,
  entity: "product",
  provider: "meilisearch",
  primary_key: "id",
  fields: productFields,
  settings: {
    distinct_attribute: "product_id",
    typo_tolerance: {
      enabled: true,
      min_word_size_for_one_typo: 4,
      min_word_size_for_two_typos: 8,
      disabled_on_attributes: ["sku"],
    },
    provider_options: {
      meilisearch: {
        searchable_parents: ["attributes"],
        faceting: { maxValuesPerFacet: 100 },
        pagination: { maxTotalHits: 5000 },
        stopWords: parseJsonEnv<string[]>("MEILISEARCH_STOP_WORDS", DEFAULT_STOP_WORDS),
        synonyms: parseJsonEnv<Record<string, string[]>>("MEILISEARCH_SYNONYMS", {}),
      },
    },
  },
  events: [
    "product.product.created",
    "product.product.updated",
    "product.product.deleted",
    "product.product.attached",
    "product.product.detached",
    "product.product-variant.created",
    "product.product-variant.updated",
    "product.product-variant.deleted",
    "product.product-category.updated",
    "product.product-collection.updated",
    "pricing.price.created",
    "pricing.price.updated",
    "pricing.price.deleted",
    "inventory.inventory-item.created",
    "inventory.inventory-item.updated",
    "inventory.inventory-item.deleted",
    "inventory.inventory-level.created",
    "inventory.inventory-level.updated",
    "inventory.inventory-level.deleted",
    "inventory.reservation-item.created",
    "inventory.reservation-item.updated",
    "inventory.reservation-item.deleted",
    // Medusa 2.23 эмитит события моделей модуля с kebab-case именем объекта
    // (buildModuleResourceEventName → kebabCase от имени модели): однословная
    // модель attribute совпадает с snake-формой, многословная
    // product_attribute_value — нет (проверено на живом окружении).
    "catalog_attributes.attribute.created",
    "catalog_attributes.attribute.updated",
    "catalog_attributes.attribute.deleted",
    "catalog_attributes.product-attribute-value.created",
    "catalog_attributes.product-attribute-value.updated",
    "catalog_attributes.product-attribute-value.deleted",
  ],
  async consume(event, context) {
    const query = context.container.query
    const productIds = [...new Set(await resolveAffectedProducts(event, query))]

    if (!productIds.length) {
      return []
    }

    return await upsertProducts(query, productIds)
  },
  async *seed(context) {
    const query = context.container.query
    const batchSize = 50

    // Частичная переиндексация (административная операция): только товары по id.
    if (context.filters && Array.isArray(context.filters.product_ids)) {
      const ids = context.filters.product_ids as string[]
      for (let offset = 0; offset < ids.length; offset += batchSize) {
        yield await upsertProducts(query, ids.slice(offset, offset + batchSize))
      }
      return
    }

    // Catch-up проход после полной загрузки: поднимаем изменения с момента
    // старта seed (обновленные товары перезаписываются, удаленные снимаются
    // событием product.deleted).
    if (context.catchup?.since) {
      const since = new Date(context.catchup.since).toISOString()
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "updated_at"],
        filters: { updated_at: { $gte: since } } as Record<string, unknown>,
        pagination: { order: { id: "ASC" } as Record<string, string> },
      } as Parameters<RemoteQueryFunction["graph"]>[0])

      const ids = (data as unknown as Array<{ id: string }>).map((row) => row.id)
      for (let offset = 0; offset < ids.length; offset += batchSize) {
        yield await upsertProducts(query, ids.slice(offset, offset + batchSize))
      }
      return
    }

    // Полная индексация: страницы товаров в порядке id. Прерванная загрузка
    // возобновляется по last_key; модуль записывает в него id последнего
    // ДОКУМЕНТА (variant__currency), поэтому чужой формат отрезаем и проходим
    // полный проход заново — upsert-ы идемпотентны, корректность важнее.
    let lastKey: string | null = null
    if (context.last_key && context.last_key.startsWith("prod_")) {
      lastKey = context.last_key
    }

    for (;;) {
      const filters: Record<string, unknown> = {}
      if (lastKey) {
        filters.id = { $gt: lastKey }
      }

      const { data } = await query.graph({
        entity: "product",
        fields: PRODUCT_FIELDS,
        filters: filters as never,
        pagination: {
          order: { id: "ASC" } as Record<string, string>,
          skip: 0,
          take: batchSize,
        },
      } as Parameters<RemoteQueryFunction["graph"]>[0])

      const products = data as unknown as ProductRow[]
      if (!products.length) {
        return
      }

      lastKey = products[products.length - 1].id

      const { attributesById, valuesByProduct } = await loadAttributeData(
        query,
        products.map((product) => product.id)
      )

      const documents = buildDocuments(products, attributesById, valuesByProduct)
      if (documents.length) {
        yield [{ action: "upsert", documents }]
      }

      if (products.length < batchSize) {
        return
      }
    }
  },
})

// Экспорт для unit-тестов трансформации документов и job'а сверки индекса
// (backend/src/jobs/search-index-reconcile.ts): сверка собирает ожидаемые
// документы теми же загрузчиками и трансформацией, что и индексатор, —
// без второго индексатора.
export {
  buildDocuments as buildProductDocuments,
  loadProductsByIds as loadProductRows,
  loadAttributeData as loadProductAttributeData,
  PRODUCT_FIELDS as PRODUCT_INDEX_FIELDS,
  INDEX_NAME,
}

import type {
  MedusaContainer,
  Logger,
  SearchTypes,
} from "@medusajs/framework/types"
import type { MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { CatalogAttributeModuleService } from "../modules/catalog-attributes"
import { isMeilisearchNetworkError } from "../modules/search-meilisearch/providers/meilisearch/filters"
import MeilisearchProviderService from "../modules/search-meilisearch/providers/meilisearch/service"
import type {
  CatalogFacet,
  CatalogProduct,
  CatalogQuery,
  CatalogResponse,
  CatalogSort,
  FacetOption,
  SearchSuggestion,
} from "../types/catalog"
import {
  CATALOG_LIMITS,
  CATALOG_SORT_OPTIONS,
} from "../types/catalog"

/**
 * Общий поисковый сервис каталога (этап 3).
 *
 * Единственная точка бизнес-логики для /store/catalog, /store/search и
 * /store/search/suggestions (требование этапа: один сервис, без дублирования).
 * Регистрируется Medusa в контейнере как "catalogSearchService".
 *
 * Архитектура запроса (проверена техническим прототипом, см.
 * docs/ARCHITECTURE.md):
 *
 *  1. Основной запрос: distinct=product_id + page-пагинация → ТОЧНЫЙ totalHits
 *     (число уникальных товаров) и сгруппированная выдача. В этом же запросе
 *     запрашиваются facetDistribution/facetStats всех фасетов БЕЗ активного
 *     собственного фильтра (для них disjunctive-режим совпадает с базовым).
 *  2. Disjunctive faceting: отдельные подзапросы — только для фасетов С
 *     активным собственным фильтром (исключаем его, чтобы пересчитать фасет).
 *     facetDistribution Meilisearch считает ПРЕДСТАВИТЕЛЕЙ distinct
 *     (проверено на живом индексе), поэтому точные счетчики уникальных
 *     товаров считаются отдельными count-запросами на каждое значение
 *     (hitsPerPage=0, точный totalHits) в ОДНОМ multi-search вызове.
 *     Count-запросы НЕ выполняются, когда distribution фасета пуста —
 *     это подтвержденный ноль (ни один подходящий документ не имеет
 *     значений фасета); отсутствие значения в НЕПУСТОЙ distribution нулем
 *     не считается (выдача может быть ограничена maxValuesPerFacet).
 *  3. Диапазоны: facetStats (min/max) с фильтрами «без собственного фильтра».
 *
 * Регион, валюта и канал продаж определяются и проверяются на backend:
 * регион — по модулю Region, канал — из контекста publishable API key,
 * статус — всегда published. Пользовательские значения в фильтры Meilisearch
 * не попадают: выражения строятся из типизированных параметров.
 */

type AttributeMeta = {
  id: string
  code: string
  name: string
  data_type: "text" | "number" | "boolean" | "select" | "multi_select"
  filter_type: "checkbox" | "select" | "radio" | "range" | "color" | "boolean"
  unit: string | null
  position: number
  options: Map<string, string>
}

type ProviderQuery = Parameters<
  NonNullable<SearchTypes.ISearchProvider["searchMany"]>
>[0][number]

const INDEX_NAME = "products"

/**
 * Единый экземпляр Meilisearch-провайдера для запросов каталога.
 *
 * Провайдер — наш собственный класс с публичным конструктором; обращение
 * идет напрямую, без доступа к private/protected полям официального Search
 * Module (у него нет публичного API для получения провайдера, а
 * module.search() отклоняет динамические атрибуты attributes.<code>,
 * не объявленные в статической схеме индекса, — см. docs/filters.md).
 *
 * Активную версию индекса (physical_name) сервис получает через ПУБЛИЧНЫЙ
 * getIndex() модуля — она меняется при атомарной переиндексации.
 */
let sharedProvider: MeilisearchProviderService | null = null

function getMeilisearchProvider(
  container: MedusaContainer
): MeilisearchProviderService {
  if (!sharedProvider) {
    const logger = container.resolve(
      ContainerRegistrationKeys.LOGGER
    ) as Logger
    sharedProvider = new MeilisearchProviderService(
      { logger },
      {
        host: process.env.MEILISEARCH_HOST || "http://meilisearch:7700",
        master_key: process.env.MEILISEARCH_MASTER_KEY,
        request_timeout_ms: 15_000,
      }
    )
  }
  return sharedProvider
}

/**
 * Резолвит физический индекс АКТИВНОЙ версии по корневому имени.
 *
 * Основной путь — штатная активная версия официального Search Module:
 * модуль хранит её в собственной таблице (search_index.active_version,
 * search_index_version.physical_name, status='ready'; joiner-конфиг модуля
 * объявляет модели внутренней бухгалтерией, публичного API активной версии
 * не существует). Читаем через публичный PG_CONNECTION Medusa — та же база
 * приложения, источник истины, которым пользуется сам модуль.
 *
 * При ошибке определения активной версии:
 *  - используется ПОСЛЕДНЯЯ ПОДТВЕРЖДЕННАЯ ready-версия (кэш), если она
 *    существует — это всегда ранее атомарно активированная полная версия;
 *  - если подтвержденной версии нет — HTTP 503. Индекс выбирается ТОЛЬКО
 *    по подтверждению из БД модуля, никогда по максимальному номеру
 *    физической версии (строящаяся версия существует до активации).
 *
 * Свежий кэш (TTL 30 с) ускоряет запросы без обращения к БД.
 */
const ACTIVE_INDEX_CACHE_TTL_MS = 30_000
let activeIndexCache: { physicalName: string; expiresAt: number } | null = null

type PgConnection = {
  raw: (sql: string, bindings?: unknown[]) => Promise<unknown>
}

/** Код ошибки «активная версия индекса не определена» → HTTP 503. */
export const SEARCH_INDEX_UNAVAILABLE = "search_index_unavailable"

class SearchIndexUnavailableError extends Error {
  readonly code = SEARCH_INDEX_UNAVAILABLE

  constructor() {
    super(
      "Поисковый индекс временно недоступен: активная ready-версия не определена. Повторите запрос позже."
    )
    this.name = "SearchIndexUnavailableError"
  }
}

async function resolveActivePhysicalIndex(
  container: MedusaContainer,
  indexName: string
): Promise<string> {
  if (activeIndexCache && Date.now() < activeIndexCache.expiresAt) {
    return activeIndexCache.physicalName
  }

  const fresh = await resolveActivePhysicalNameFromModule(container, indexName)
  if (fresh) {
    activeIndexCache = {
      physicalName: fresh,
      expiresAt: Date.now() + ACTIVE_INDEX_CACHE_TTL_MS,
    }
    return fresh
  }

  // Ошибка определения активной версии: деградация к последней
  // подтвержденной ready-версии (она была атомарно активирована модулем).
  if (activeIndexCache) {
    return activeIndexCache.physicalName
  }

  // Подтвержденной версии нет — честный отказ вместо угадывания индекса.
  throw new SearchIndexUnavailableError()
}

/** Активная версия из таблиц Search Module (транзакционное переключение). */
async function resolveActivePhysicalNameFromModule(
  container: MedusaContainer,
  indexName: string
): Promise<string | null> {
  let connection: PgConnection | null = null
  try {
    connection = container.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as unknown as PgConnection
  } catch {
    return null
  }

  try {
    const result = (await connection.raw(
      `SELECT siv.physical_name AS physical_name
         FROM search_index si
         JOIN search_index_version siv
           ON siv.search_index_id = si.id AND siv.version = si.active_version
        WHERE si.name = ?
          AND si.deleted_at IS NULL
          AND siv.deleted_at IS NULL
          AND siv.status = 'ready'
        LIMIT 1`,
      [indexName]
    )) as { rows?: Array<{ physical_name: string }> }

    const rows = Array.isArray(result)
      ? (result[0] as Array<{ physical_name: string }>)
      : (result?.rows ?? [])

    return rows[0]?.physical_name ?? null
  } catch {
    // Недоступность служебного запроса не должна ломать поиск:
    // деградация к последней подтвержденной ready-версии.
    return null
  }
}

/** Встроенные фасеты каталога (не зависят от реестра характеристик). */
const BUILT_IN_FACETS: Array<{
  code: string
  label: string
  field: string
  kind: "range" | "boolean"
}> = [
  { code: "price", label: "Цена", field: "price", kind: "range" },
  { code: "in_stock", label: "Наличие", field: "in_stock", kind: "boolean" },
]

function toNumber(value: string, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Параметр ${field} должен быть числом`
    )
  }
  return parsed
}

export class CatalogSearchService {
  private readonly container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }  /** Провайдер и активная версия индекса: оба — через публичные API. */
  private async resolveProvider(): Promise<{
    provider: SearchTypes.ISearchProvider
    index: SearchTypes.ResolvedSearchIndexDefinition
  }> {
    const searchService = this.container.resolve(Modules.SEARCH)
    // Публичный getIndex() возвращает определение с КОРНЕВЫМ physical_name
    // ("store_products"); физический индекс активной версии ("store_products_v2")
    // резолвим через публичный listIndexes() провайдера. Кэш на 30 секунд:
    // при атомарной переиндексации старая версия какое-то время продолжает
    // обслуживать корректные данные, брошенные версии вычищает сам модуль.
    const definition = searchService.getIndex(INDEX_NAME)
    const provider = getMeilisearchProvider(this.container)
    const physicalName = await resolveActivePhysicalIndex(
      this.container,
      INDEX_NAME
    )

    return { provider, index: { ...definition, physical_name: physicalName } }
  }

  private async listAttributeMeta(): Promise<AttributeMeta[]> {
    const attributeService = this.container.resolve<CatalogAttributeModuleService>(
      "catalog_attributes"
    )
    const [attributes, options] = await Promise.all([
      attributeService.listAttributes(),
      attributeService.listAttributeOptions(),
    ])

    const optionsByAttribute = new Map<string, Map<string, string>>()
    for (const option of options) {
      const bucket = optionsByAttribute.get(option.attribute_id) ?? new Map()
      bucket.set(option.value, option.label)
      optionsByAttribute.set(option.attribute_id, bucket)
    }

    return attributes
      .filter((attribute) => attribute.filterable)
      .map((attribute) => ({
        id: attribute.id,
        code: attribute.code,
        name: attribute.name,
        data_type: attribute.data_type as AttributeMeta["data_type"],
        filter_type: attribute.filter_type as AttributeMeta["filter_type"],
        unit: attribute.unit,
        position: attribute.position,
        options: optionsByAttribute.get(attribute.id) ?? new Map<string, string>(),
      }))
      .sort((a, b) => a.position - b.position)
  }

  /** Характеристики, привязанные к категории запроса (если указана). */
  private async loadCategoryScope(
    categoryHandle: string | undefined,
    attributes: AttributeMeta[]
  ): Promise<AttributeMeta[]> {
    if (!categoryHandle) {
      return attributes
    }

    const query = this.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_category",
      fields: ["id", "handle"],
      filters: { handle: categoryHandle },
    } as Parameters<typeof query.graph>[0])
    const category = (data as Array<{ id: string; handle: string }>)[0]
    if (!category) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Категория «${categoryHandle}» не найдена`
      )
    }

    const attributeService = this.container.resolve<CatalogAttributeModuleService>(
      "catalog_attributes"
    )
    const bindings = await attributeService.listCategoryAttributes({
      category_id: category.id,
    } as Parameters<typeof attributeService.listCategoryAttributes>[0])

    if (!bindings.length) {
      return attributes
    }

    const scopedIds = new Set(bindings.map((binding) => binding.attribute_id))
    return attributes
      .filter((attribute) => scopedIds.has(attribute.id))
      .sort((a, b) => {
        const positionA =
          bindings.find((binding) => binding.attribute_id === a.id)?.position ?? a.position
        const positionB =
          bindings.find((binding) => binding.attribute_id === b.id)?.position ?? b.position
        return positionA - positionB
      })
  }

  /** Разбирает и валидирует query-параметры запроса каталога. */
  parseQuery(raw: Record<string, unknown>, requireQuery: boolean): CatalogQuery {
    const errors: string[] = []

    const q = typeof raw.q === "string" ? raw.q.trim() : undefined
    if (requireQuery && !q) {
      errors.push("Параметр q обязателен")
    }
    if (q && q.length > CATALOG_LIMITS.maxQueryLength) {
      errors.push(`Параметр q длиннее ${CATALOG_LIMITS.maxQueryLength} символов`)
    }

    const sortRaw = typeof raw.sort === "string" ? raw.sort : "relevance"
    if (!CATALOG_SORT_OPTIONS.includes(sortRaw as CatalogSort)) {
      errors.push(`sort должен быть одним из: ${CATALOG_SORT_OPTIONS.join(", ")}`)
    }

    const limitRaw = raw.limit === undefined ? CATALOG_LIMITS.defaultLimit : Number(raw.limit)
    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > CATALOG_LIMITS.maxLimit) {
      errors.push(`limit должен быть целым числом от 1 до ${CATALOG_LIMITS.maxLimit}`)
    }

    const offsetRaw = raw.offset === undefined ? 0 : Number(raw.offset)
    if (!Number.isInteger(offsetRaw) || offsetRaw < 0 || offsetRaw > CATALOG_LIMITS.maxOffset) {
      errors.push(`offset должен быть целым числом от 0 до ${CATALOG_LIMITS.maxOffset}`)
    }

    const priceMin =
      raw.price_min === undefined ? undefined : toNumber(String(raw.price_min), "price_min")
    const priceMax =
      raw.price_max === undefined ? undefined : toNumber(String(raw.price_max), "price_max")
    if (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax) {
      errors.push("price_min не может быть больше price_max")
    }

    let inStock: boolean | undefined
    if (raw.in_stock !== undefined) {
      if (raw.in_stock === "true") {
        inStock = true
      } else if (raw.in_stock === "false") {
        inStock = false
      } else {
        errors.push("in_stock должен быть true или false")
      }
    }

    // Фильтры характеристик: формат filter[code]=v1,v2 (или filter.code=v1,v2).
    // Medusa (Express) передает вложенные ключи как плоские строки либо объектом —
    // поддерживаем обе формы; значения не интерпретируются как выражения
    // движка — они передаются только как типизированные строки.
    const filter: Record<string, string[]> = {}
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      if (rawKey === "filter" && rawValue && typeof rawValue === "object") {
        // Вложенная форма (если парсер query развернул filter[code])
        for (const [code, nested] of Object.entries(
          rawValue as Record<string, unknown>
        )) {
          const values = (Array.isArray(nested) ? nested : [nested])
            .flatMap((entry) => String(entry).split(","))
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
          if (values.length) {
            filter[code] = [...(filter[code] ?? []), ...values]
          }
        }
        continue
      }

      const match = /^(?:filter\[(.+)\]$|filter\.(.+))$/.exec(rawKey)
      if (!match) {
        continue
      }
      const entries = Array.isArray(rawValue) ? rawValue : [rawValue]
      const values = entries
        .flatMap((entry) => String(entry).split(","))
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      if (!values.length) {
        continue
      }
      const code = match[1] ?? match[2]
      filter[code] = values
    }

    if (errors.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, errors.join("; "))
    }

    return {
      ...(q ? { q } : {}),
      ...(typeof raw.category === "string" && raw.category ? { category: raw.category } : {}),
      ...(typeof raw.collection === "string" && raw.collection
        ? { collection: raw.collection }
        : {}),
      ...(typeof raw.region_id === "string" && raw.region_id
        ? { region_id: raw.region_id }
        : {}),
      ...(Object.keys(filter).length ? { filter } : {}),
      ...(priceMin !== undefined ? { price_min: priceMin } : {}),
      ...(priceMax !== undefined ? { price_max: priceMax } : {}),
      ...(inStock !== undefined ? { in_stock: inStock } : {}),
      sort: sortRaw as CatalogSort,
      limit: limitRaw,
      offset: offsetRaw,
    }
  }

  /**
   * Проверяет регион запроса и возвращает его валюту. Регион определяется на
   * backend; валюта индекса наследуется от региона (цены индексируются в
   * основных единицах Medusa).
   */
  private async resolveCurrency(regionId: string | undefined): Promise<string> {
    const regionService = this.container.resolve(Modules.REGION)
    const regions = (await regionService.listRegions()) as Array<{
      id: string
      currency_code: string
      name: string
    }>

    if (regionId) {
      const region = regions.find((candidate) => candidate.id === regionId)
      if (!region) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Регион ${regionId} не найден`
        )
      }
      return region.currency_code.toLowerCase()
    }

    // Регион по умолчанию — как в витрине: регион с валютой магазина.
    const storeCurrency = (process.env.STORE_CURRENCY || "rub").toLowerCase()
    const fallback =
      regions.find((region) => region.currency_code.toLowerCase() === storeCurrency) ??
      regions[0]
    if (!fallback) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "В магазине не настроен ни один регион"
      )
    }
    return fallback.currency_code.toLowerCase()
  }

  /** Базовые фильтры, применяемые всегда (backend-enforced scope). */
  private baseFilters(params: {
    currencyCode: string
    channelIds: string[]
    query: CatalogQuery
  }): SearchTypes.SearchFilters {
    const { currencyCode, channelIds, query } = params
    const filters: SearchTypes.SearchFilters = {
      status: "published",
      currency_code: currencyCode,
      sales_channel_ids: channelIds,
    }

    if (query.q) {
      filters.q = query.q
    }
    if (query.category) {
      filters.category_handles = { $contains: query.category }
    }
    if (query.collection) {
      filters.collection_handles = { $contains: query.collection }
    }

    return filters
  }

  /**
   * Фильтры одного фасета-характеристики. OR внутри значений одного
   * атрибута — через $or-ветви (дубликаты ключей в объекте недопустимы:
   * последний перезаписал бы предыдущие).
   */
  private attributeFilter(
    attribute: AttributeMeta,
    values: string[]
  ): SearchTypes.SearchFilters {
    if (attribute.data_type === "number" || attribute.data_type === "boolean") {
      const branches: SearchTypes.SearchFilters[] = values.map((value) => ({
        [`attributes.${attribute.code}`]: {
          $eq:
            attribute.data_type === "number"
              ? Number(value)
              : value === "true",
        },
      }))
      return branches.length === 1 ? branches[0] : { $or: branches }
    }
    return {
      [`attributes.${attribute.code}`]: { $in: values },
    }
  }

  /**
   * Собирает дерево фильтров: база + цена/наличие + атрибуты (OR внутри
   * значений, AND между характеристиками). `withoutField` исключает
   * собственный фильтр фасета (disjunctive подсчет).
   */
  private buildFilters(params: {
    currencyCode: string
    channelIds: string[]
    query: CatalogQuery
    attributes: Map<string, AttributeMeta>
    without?: string
  }): SearchTypes.SearchFilters {
    const base = this.baseFilters({
      currencyCode: params.currencyCode,
      channelIds: params.channelIds,
      query: params.query,
    })

    const branches: SearchTypes.SearchFilters[] = [base]

    const priceField = "price"
    if (params.query.price_min !== undefined && params.without !== priceField) {
      branches.push({ price: { $gte: params.query.price_min } })
    }
    if (params.query.price_max !== undefined && params.without !== priceField) {
      branches.push({ price: { $lte: params.query.price_max } })
    }
    if (params.query.in_stock !== undefined && params.without !== "in_stock") {
      branches.push({ in_stock: params.query.in_stock })
    }

    for (const [code, values] of Object.entries(params.query.filter ?? {})) {
      const attribute = params.attributes.get(code)
      if (!attribute) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Неизвестная характеристика в фильтре: ${code}`
        )
      }
      if (params.without === `attributes.${attribute.code}`) {
        continue
      }
      branches.push(this.attributeFilter(attribute, values))
    }

    return { $and: branches }
  }

  private buildSort(sort: CatalogSort): Record<string, "ASC" | "DESC"> | undefined {
    switch (sort) {
      case "price_asc":
        return { price: "ASC" }
      case "price_desc":
        return { price: "DESC" }
      case "newest":
        return { created_at: "DESC" }
      case "title_asc":
        return { title: "ASC" }
      default:
        return undefined
    }
  }

  /** Основной сценарий: каталог/поиск с товарами, пагинацией и фасетами. */
  async search(
    query: CatalogQuery,
    channelIds: string[]
  ): Promise<CatalogResponse> {
    if (!channelIds.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Publishable API key должен быть связан с каналом продаж"
      )
    }

    const currencyCode = await this.resolveCurrency(query.region_id)
    const attributes = await this.listAttributeMeta()
    const scopedAttributes = await this.loadCategoryScope(query.category, attributes)
    const attributesByCode = new Map(scopedAttributes.map((a) => [a.code, a]))
    // Валидация фильтров против реестра (в т.ч. вне категорийного scope).
    const attributeIndex = new Map(attributes.map((a) => [a.code, a]))
    for (const code of Object.keys(query.filter ?? {})) {
      if (!attributeIndex.has(code)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Неизвестная характеристика в фильтре: ${code}`
        )
      }
    }

    const { provider, index } = await this.resolveProvider()

    const providerQuery = (filters: SearchTypes.SearchFilters, extra: {
      pagination?: SearchTypes.SearchPagination
      facets?: (string | SearchTypes.SearchFacetRequest)[]
      distinct?: string
      count?: SearchTypes.SearchCountStrategy
    }): ProviderQuery => {
      // Все опции поиска собираются в ОДИН объект search_options:
      // раздельные спреды перезаписывали бы друг друга.
      const searchOptions: SearchTypes.SearchOptions = {
        ...(extra.facets ? { facets: extra.facets } : {}),
        ...(extra.distinct ? { distinct: extra.distinct } : {}),
        ...(extra.count ? { count: extra.count } : {}),
      }

      return {
        index,
        q: query.q,
        filters,
        ...(extra.pagination ? { pagination: extra.pagination } : {}),
        ...(Object.keys(searchOptions).length
          ? { search_options: searchOptions }
          : {}),
        attributes_to_retrieve: [
          "id",
          "product_id",
          "variant_id",
          "title",
          "description",
          "handle",
          "sku",
          "thumbnail",
          "price",
          "in_stock",
          "category_handles",
          "collection_handles",
          "attributes",
          "currency_code",
        ],
      }
    }

    // ── Раунд 1: основная выдача + перечисление значений фасетов ─────────
    const facetPlan: Array<{
      kind: "options" | "range" | "boolean"
      code: string
      label: string
      field: string
      unit?: string
      meta?: AttributeMeta
    }> = []

    for (const builtIn of BUILT_IN_FACETS) {
      facetPlan.push({
        kind: builtIn.kind === "range" ? "range" : "boolean",
        code: builtIn.code,
        label: builtIn.label,
        field: builtIn.field,
        unit: builtIn.field === "price" ? currencyCode.toUpperCase() : undefined,
      })
    }
    for (const attribute of scopedAttributes.slice(0, CATALOG_LIMITS.maxFacets)) {
      facetPlan.push({
        kind:
          attribute.data_type === "number"
            ? "range"
            : attribute.data_type === "boolean"
              ? "boolean"
              : "options",
        code: attribute.code,
        label: attribute.name,
        field: `attributes.${attribute.code}`,
        unit: attribute.unit ?? undefined,
        meta: attribute,
      })
    }

    // ── Раунд 1: основная выдача + перечисление значений фасетов ─────────
    // Оптимизация: у фасета БЕЗ активного собственного фильтра disjunctive-
    // режим совпадает с базовым, поэтому его distribution/stats запрашиваются
    // в основном запросе. Отдельный подзапрос остается только у фасетов
    // С активным собственным фильтром (его нужно исключить).
    const selectedValues = new Map(Object.entries(query.filter ?? {}))

    const facetHasActiveFilter = (facet: (typeof facetPlan)[number]): boolean => {
      if (facet.field === "price") {
        return (
          query.price_min !== undefined ||
          query.price_max !== undefined
        )
      }
      if (facet.field === "in_stock") {
        return query.in_stock !== undefined
      }
      return (selectedValues.get(facet.code)?.length ?? 0) > 0
    }

    const inactiveFacets = facetPlan.filter((facet) => !facetHasActiveFilter(facet))
    const activeFacets = facetPlan.filter((facet) => facetHasActiveFilter(facet))

    const baseFacetRequests: Array<string | SearchTypes.SearchFacetRequest> =
      inactiveFacets.map((facet) =>
        facet.kind === "range"
          ? ({ field: facet.field, type: "stats" } as SearchTypes.SearchFacetRequest)
          : facet.field
      )

    const round1: ProviderQuery[] = [
      providerQuery(
        this.buildFilters({
          currencyCode,
          channelIds,
          query,
          attributes: attributeIndex,
        }),
        {
          pagination: { skip: query.offset, take: query.limit },
          distinct: "product_id",
          count: "exact",
          ...(baseFacetRequests.length ? { facets: baseFacetRequests } : {}),
        }
      ),
    ]

    for (const facet of activeFacets) {
      round1.push(
        providerQuery(
          this.buildFilters({
            currencyCode,
            channelIds,
            query,
            attributes: attributeIndex,
            without: facet.field,
          }),
          {
            pagination: { skip: 0, take: 0 },
            count: "none",
            distinct: "product_id",
            facets:
              facet.kind === "range"
                ? [{ field: facet.field, type: "stats" }]
                : [facet.field],
          }
        )
      )
    }

    const order = this.buildSort(query.sort ?? "relevance")
    if (order) {
      round1[0].pagination = { ...(round1[0].pagination ?? {}), order }
    }

    if (!provider.searchMany) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Поисковый провайдер не поддерживает multi-search"
      )
    }

    const round1Results = await provider.searchMany(round1)
    const main = round1Results[0]

    // Источник distribution/stats каждого фасета: основной запрос для
    // фасетов без собственного фильтра, disjunctive-подзапрос — для активных.
    const facetSources = new Map<string, (typeof round1Results)[number]>()
    inactiveFacets.forEach((facet) => facetSources.set(facet.code, main))
    activeFacets.forEach((facet, position) =>
      facetSources.set(facet.code, round1Results[position + 1])
    )

    // ── Раунд 2: точные счетчики уникальных товаров на значение ─────────
    const countQueries: Array<{ facet: (typeof facetPlan)[number]; value: string }> = []
    const enumerated = new Map<string, Array<{ value: string; approximate: number }>>()

    for (const facet of facetPlan) {
      if (facet.kind === "range") {
        continue
      }
      const distribution = facetSources.get(facet.code)?.facets?.[facet.field]
      const distributionValues =
        distribution?.type === "value"
          ? distribution.values.map((entry) => ({
              value: entry.value,
              approximate: entry.count,
            }))
          : []

      // Дополнительно гарантированно показываем выбранные значения
      // (в т.ч. с нулевым количеством — требование этапа).
      const selected = selectedValues.get(facet.code) ?? []
      const values = [...distributionValues]
      for (const value of selected) {
        if (!values.some((entry) => entry.value === value)) {
          values.push({ value, approximate: 0 })
        }
      }

      const top = values
        .sort((a, b) => b.approximate - a.approximate)
        .slice(0, CATALOG_LIMITS.maxFacetValues)
      enumerated.set(facet.code, top)

      // Пустая distribution = подтвержденный ноль: ни один подходящий
      // документ не имеет значений фасета, count-запросы вернут 0.
      // Отсутствие значения в НЕПУСТОЙ distribution нулем не является
      // (лимит maxValuesPerFacet) — для таких значений count-запрос
      // остается (в т.ч. для выбранных значений с возможным нулем).
      if (!distributionValues.length) {
        continue
      }
      for (const entry of top) {
        countQueries.push({ facet, value: entry.value })
      }
    }

    const round2: ProviderQuery[] = countQueries.map(({ facet, value }) => {
      const meta = facet.meta
      const attributeFilter: SearchTypes.SearchFilters = meta
        ? this.attributeFilter(meta, [value])
        : facet.code === "in_stock"
          ? { in_stock: value === "true" }
          : {}
      return providerQuery(
        {
          $and: [
            this.buildFilters({
              currencyCode,
              channelIds,
              query,
              attributes: attributeIndex,
              without: facet.field,
            }),
            attributeFilter,
          ],
        },
        { pagination: { skip: 0, take: 0 }, distinct: "product_id", count: "exact" }
      )
    })

    const round2Results = round2.length ? await provider.searchMany(round2) : []
    const exactCounts = new Map<string, number>()
    countQueries.forEach(({ facet, value }, position) => {
      exactCounts.set(
        `${facet.code}__${value}`,
        round2Results[position]?.metadata.count ?? 0
      )
    })

    // ── Сборка ответа ─────────────────────────────────────────────────────
    const products: CatalogProduct[] = main.hits.map((hit) => {
      const document = hit.document as Record<string, unknown>
      return {
        id: String(document.product_id ?? hit.id),
        variant_id: typeof document.variant_id === "string" ? document.variant_id : null,
        title: String(document.title ?? ""),
        description: String(document.description ?? ""),
        handle: String(document.handle ?? ""),
        sku: String(document.sku ?? ""),
        thumbnail: typeof document.thumbnail === "string" ? document.thumbnail : null,
        price: {
          amount: Number(document.price ?? 0),
          currency_code: String(document.currency_code ?? currencyCode),
        },
        in_stock: Boolean(document.in_stock),
        category_handles: Array.isArray(document.category_handles)
          ? (document.category_handles as string[])
          : [],
        collection_handles: Array.isArray(document.collection_handles)
          ? (document.collection_handles as string[])
          : [],
        attributes: (document.attributes as Record<string, unknown>) ?? {},
      }
    })

    const facets: CatalogFacet[] = []
    for (const facet of facetPlan) {
      if (facet.kind === "range") {
        const stats = facetSources.get(facet.code)?.facets?.[facet.field]
        const range = stats?.type === "stats" ? stats : null
        facets.push({
          code: facet.code,
          label: facet.label,
          type: "range",
          unit: facet.unit ?? "",
          min: range ? range.min : 0,
          max: range ? range.max : 0,
        })
        continue
      }

      const values = enumerated.get(facet.code) ?? []
      const selected = selectedValues.get(facet.code) ?? []
      const options: FacetOption[] = values.map((entry) => ({
        value: entry.value,
        label:
          facet.meta?.options.get(entry.value) ??
          (facet.code === "in_stock"
            ? entry.value === "true"
              ? "В наличии"
              : "Нет в наличии"
            : entry.value),
        count: exactCounts.get(`${facet.code}__${entry.value}`) ?? 0,
        selected: selected.includes(entry.value),
      }))

      facets.push({
        code: facet.code,
        label: facet.label,
        type:
          facet.kind === "boolean"
            ? "boolean"
            : ((facet.meta?.filter_type ?? "checkbox") as "checkbox" | "select" | "radio" | "color"),
        ...(facet.unit ? { unit: facet.unit } : {}),
        options,
      })
    }

    const total = main.metadata.count ?? main.hits.length

    return {
      products,
      pagination: {
        total,
        limit: query.limit ?? CATALOG_LIMITS.defaultLimit,
        offset: query.offset ?? 0,
        hasMore: (query.offset ?? 0) + products.length < total,
      },
      facets,
      sortOptions: [...CATALOG_SORT_OPTIONS],
    }
  }

  /** Поисковые подсказки (typeahead). */
  async suggest(q: string, channelIds: string[]): Promise<SearchSuggestion[]> {
    if (!q.trim()) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Параметр q обязателен")
    }
    if (q.length > CATALOG_LIMITS.maxQueryLength) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Параметр q длиннее ${CATALOG_LIMITS.maxQueryLength} символов`
      )
    }
    if (!channelIds.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Publishable API key должен быть связан с каналом продаж"
      )
    }

    const currencyCode = await this.resolveCurrency(undefined)
    const { provider, index } = await this.resolveProvider()

    const result = await provider.search({
      index,
      q,
      filters: this.baseFilters({
        currencyCode,
        channelIds,
        query: { sort: "relevance", limit: 8, offset: 0 },
      }),
      pagination: { skip: 0, take: 8 },
      search_options: { distinct: "product_id" },
      attributes_to_retrieve: ["product_id", "title", "handle", "sku"],
    })

    return result.hits
      .map((hit) => {
        const document = hit.document as Record<string, unknown>
        return {
          text: String(document.title ?? ""),
          product_id: String(document.product_id ?? ""),
          handle: String(document.handle ?? ""),
          sku: String(document.sku ?? ""),
        }
      })
      .filter((suggestion) => suggestion.text.length > 0)
  }
}

export default CatalogSearchService

/** Форматирование ошибок поисковых маршрутов (единый контракт). */
export function catalogErrorResponse<T>(
  res: MedusaResponse<T>,
  error: unknown,
  logger?: Logger
): void {
  if (error instanceof MedusaError) {
    const invalidData = error.type === MedusaError.Types.INVALID_DATA
    if (!invalidData) {
      logger?.error(
        `[catalog] серверная ошибка запроса каталога: ${error.message}`
      )
    }
    res.status(invalidData ? 400 : 500).json({
      type: "invalid_query",
      message: error.message,
    } as unknown as T)
    return
  }

  const message = (error as Error)?.message ?? ""
  const unavailable =
    (error as { code?: string })?.code === SEARCH_INDEX_UNAVAILABLE ||
    isMeilisearchNetworkError(error)
  if (unavailable) {
    logger?.warn(`[catalog] Meilisearch недоступен: ${message}`)
    res.status(503).json({
      type: "search_unavailable",
      message:
        "Поисковый сервис временно недоступен. Повторите запрос позже. Каталог не может быть собран корректно.",
    } as unknown as T)
    return
  }

  logger?.error(
    `[catalog] неожиданная ошибка поискового запроса: ${message}\n${
      (error as Error)?.stack ?? ""
    }`
  )
  res.status(500).json({
    type: "unexpected_error",
    message: "Внутренняя ошибка поискового запроса",
  } as unknown as T)
}

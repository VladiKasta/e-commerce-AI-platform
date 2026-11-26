import type { Logger, SearchTypes } from "@medusajs/framework/types"
import {
  AbstractSearchProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import { MeilisearchApiError, MeilisearchClient } from "./client"
import { compileFilters } from "./filters"

type InjectedDependencies = { logger: Logger }

export type MeilisearchProviderOptions = {
  host: string
  master_key?: string
  indexer_api_key?: string
  search_api_key?: string
  request_timeout_ms?: number
}

type FlatField = { path: string; field: SearchTypes.SearchFieldDefinition }

/** Настройки, специфичные для Meilisearch, из definition.settings.provider_options. */
type MeilisearchIndexOptions = {
  searchable_parents?: string[]
  faceting?: Record<string, unknown>
  pagination?: Record<string, unknown>
  stopWords?: string[]
  synonyms?: Record<string, string[]>
}

const DEFAULT_HITS_PER_PAGE = 20

/**
 * Провайдер Meilisearch для официального Search Module Medusa.
 *
 * Реализует контракт SearchTypes.ISearchProvider: создание/миграция
 * физических индексов, запись и удаление документов (асинхронные задачи
 * с ожиданием), поиск и multi-search.
 *
 * Ключевые решения (проверены техническим прототипом, см.
 * docs/ARCHITECTURE.md):
 *  - Пагинация всегда в page-режиме: при distinct Meilisearch возвращает
 *    ТОЧНЫЙ totalHits (limit-режим дает лишь оценку estimatedTotalHits).
 *  distinctAttribute задается на уровне индекса и переопределяется
 *  параметром distinct на запрос.
 *  - Динамические вложенные характеристики фильтруются и фасетируются
 *    через РОДИТЕЛЬСКИЙ объект ("attributes") в filterableAttributes:
 *    родитель покрывает все вложенные поля без их перечисления, поэтому
 *    новые характеристики не требуют изменения настроек индекса.
 *  - Поисковые запросы выполняются ключом только с правами search,
 *    индексация — ключом только с правами записи (провижинятся из
 *    master key с фиксированными uid).
 */
class MeilisearchProviderService extends AbstractSearchProviderService {
  static identifier = "meilisearch"

  protected logger_: Logger
  protected options_: MeilisearchProviderOptions
  protected client: MeilisearchClient

  constructor({ logger }: InjectedDependencies, options: MeilisearchProviderOptions) {
    super()

    if (!options?.host) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Провайдер meilisearch требует опцию host (MEILISEARCH_HOST)"
      )
    }

    this.logger_ = logger
    this.options_ = options
    this.client = new MeilisearchClient({
      host: options.host,
      masterKey: options.master_key,
      indexerApiKey: options.indexer_api_key,
      searchApiKey: options.search_api_key,
      requestTimeoutMs: options.request_timeout_ms,
    })
  }

  // ── Индексы ────────────────────────────────────────────────────────────

  async upsertIndex({
    index,
  }: {
    index: SearchTypes.ResolvedSearchIndexDefinition
  }): Promise<SearchTypes.SearchTask> {
    const uid = index.physical_name

    if (!(await this.client.indexExists(uid))) {
      const task = await this.client.createIndex(uid, index.primary_key)
      if (task !== null) {
        await this.client.waitForTask(task)
      }
    }

    const settings = this.buildSettings(index)
    const settingsTask = await this.client.updateSettings(uid, settings)
    if (settingsTask !== null) {
      await this.client.waitForTask(settingsTask)
    }

    return { index: uid, status: "succeeded" }
  }

  async deleteIndex({
    index,
  }: {
    index: string
  }): Promise<SearchTypes.SearchTask> {
    const task = await this.client.deleteIndex(index)
    return {
      ...(task !== null ? { id: String(task) } : {}),
      index,
      status: "enqueued",
    }
  }

  async listIndexes(): Promise<SearchTypes.SearchIndexInfo[]> {
    const indexes = await this.client.listIndexes()
    const stats = await Promise.all(
      indexes.map(async (entry) => {
        try {
          return await this.client.indexStats(entry.uid)
        } catch (error) {
          this.logger_.warn(
            `Не удалось получить статистику индекса ${entry.uid}: ${(error as Error).message}`
          )
          return { numberOfDocuments: 0 }
        }
      })
    )

    return indexes.map((entry, position) => ({
      name: entry.uid,
      provider: MeilisearchProviderService.identifier,
      document_count: stats[position]?.numberOfDocuments ?? 0,
    }))
  }

  // ── Документы ──────────────────────────────────────────────────────────

  async upsertDocuments({
    index,
    documents,
  }: {
    index: string
    definition: SearchTypes.ResolvedSearchIndexDefinition
    documents: SearchTypes.SearchDocument[]
  }): Promise<SearchTypes.SearchTask> {
    if (!documents.length) {
      return { index, status: "succeeded" }
    }

    const task = await this.client.addDocuments(
      index,
      documents as Array<Record<string, unknown>>
    )

    if (task === null) {
      return { index, status: "succeeded" }
    }
    return { id: String(task), index, status: "enqueued" }
  }

  async deleteDocuments({
    index,
    filters,
  }: SearchTypes.SearchDeleteDocumentsInput): Promise<SearchTypes.SearchTask> {
    // Быстрый путь: удаление по id — распознаем фильтр по первичному ключу.
    const direct = this.matchIdFilter(filters)

    if (direct) {
      const task = await this.client.deleteDocumentsByIds(index, direct)
      if (task === null) {
        return { index, status: "succeeded" }
      }
      return { id: String(task), index, status: "enqueued" }
    }

    const compiled = compileFilters(filters)
    if (compiled === undefined) {
      return { index, status: "succeeded" }
    }

    const task = await this.client.deleteDocumentsByFilter(index, compiled)
    if (task === null) {
      return { index, status: "succeeded" }
    }
    return { id: String(task), index, status: "enqueued" }
  }

  async clearIndex({ index }: { index: string }): Promise<SearchTypes.SearchTask> {
    const task = await this.client.deleteAllDocuments(index)
    if (task === null) {
      return { index, status: "succeeded" }
    }
    return { id: String(task), index, status: "enqueued" }
  }

  async waitForTask(
    task: SearchTypes.SearchTask,
    options?: { timeout_ms?: number }
  ): Promise<SearchTypes.SearchTask> {
    if (!task.id) {
      return task
    }

    const result = await this.client.waitForTask(
      Number(task.id),
      options?.timeout_ms ?? 120_000
    )

    return {
      ...task,
      status:
        result.status === "succeeded"
          ? "succeeded"
          : result.status === "failed"
            ? "failed"
            : "processing",
      ...(result.status === "failed"
        ? {
            error: {
              message: result.error?.message ?? "Задача Meilisearch завершилась ошибкой",
              code: result.error?.code,
            },
          }
        : {}),
    }
  }

  // ── Поиск ──────────────────────────────────────────────────────────────

  async search(input: SearchTypes.ProviderSearchQuery): Promise<SearchTypes.SearchResult> {
    const [result] = await this.searchMany([input])
    return result
  }

  async searchMany(
    inputs: SearchTypes.ProviderSearchQuery[]
  ): Promise<SearchTypes.SearchResult[]> {
    if (!inputs.length) {
      return []
    }

    const compiled = inputs.map((input) => ({
      indexUid: input.index.physical_name,
      params: this.buildSearchParams(input),
      context: input,
    }))

    let responses
    try {
      responses = await this.client.multiSearch(
        compiled.map(({ indexUid, params }) => ({ indexUid, ...params }))
      )
    } catch (error) {
      throw this.mapSearchError(error)
    }

    return await Promise.all(
      responses.map((response, position) =>
        this.buildResult(response, compiled[position].context)
      )
    )
  }

  // ── Внутренние методы ───────────────────────────────────────────────────

  private buildSearchParams(
    input: SearchTypes.ProviderSearchQuery
  ): Record<string, unknown> {
    const options = input.search_options ?? {}
    const meiliOptions = this.meilisearchOptions(input)

    const pagination = input.pagination ?? {}
    const take = pagination.take ?? DEFAULT_HITS_PER_PAGE
    const skip = pagination.skip ?? 0

    // Page-режим: точный totalHits при distinct (проверено прототипом).
    const hitsPerPage = take
    const page = Math.floor(skip / Math.max(hitsPerPage, 1)) + 1

    const params: Record<string, unknown> = {
      q: input.q ?? "",
      page,
      hitsPerPage,
    }

    const filter = compileFilters(input.filters)
    if (filter !== undefined) {
      params.filter = filter
    }

    const sort = this.buildSort(pagination.order)
    if (sort.length) {
      params.sort = sort
    }

    if (options.distinct) {
      params.distinct = options.distinct
    }

    if (input.attributes_to_retrieve?.length) {
      params.attributesToRetrieve = input.attributes_to_retrieve
    }

    if (options.attributes_to_search_on?.length) {
      params.attributesToSearchOn = options.attributes_to_search_on
    }

    if (options.match_strategy) {
      if (options.match_strategy === "any") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Meilisearch не поддерживает match_strategy «any»"
        )
      }
      params.matchingStrategy = options.match_strategy === "last" ? "last" : "all"
    }

    if (options.typo_tolerance === false) {
      params.typoTolerance = { enabled: false }
    }

    if (options.highlight) {
      const highlight =
        options.highlight === true
          ? { fields: [] }
          : options.highlight
      params.attributesToHighlight = highlight.fields.length
        ? highlight.fields
        : options.attributes_to_search_on ?? []
      if (highlight.pre_tag) {
        params.preTag = highlight.pre_tag
      }
      if (highlight.post_tag) {
        params.postTag = highlight.post_tag
      }
      if (highlight.snippet) {
        params.cropLength = typeof highlight.snippet === "object" ? highlight.snippet.length : 15
      }
    }

    if (options.locales?.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Meilisearch не поддерживает query-time locales"
      )
    }

    if (options.vector) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Meilisearch-провайдер не поддерживает векторный поиск"
      )
    }

    if (options.min_score !== undefined) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Meilisearch не поддерживает min_score"
      )
    }

    // Фасеты: value → facetDistribution, stats → facetStats.
    // Диапазонные фасеты (type: "range") провайдер не поддерживает и
    // отклоняет: уровень сервиса каталога считает их через отдельные
    // count-запросы (см. CatalogSearchService) — контракт провайдера
    // требует отклонять непереводимые запросы, а не аппроксимировать.
    const facetFields: string[] = []

    for (const facet of options.facets ?? []) {
      const request = typeof facet === "string" ? { field: facet, type: "value" } : facet

      if (request.type === "value" || request.type === "stats") {
        facetFields.push(request.field)
        continue
      }

      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Meilisearch-провайдер не поддерживает range-фасеты: считайте диапазоны count-запросами на уровне сервиса каталога"
      )
    }

    if (facetFields.length) {
      params.facets = facetFields
    }

    return params
  }

  private buildSort(
    order: Record<string, SearchTypes.SearchOrderBy> | undefined
  ): string[] {
    if (!order) {
      return []
    }

    const sort: string[] = []
    for (const [field, direction] of Object.entries(order)) {
      if (field === "_score") {
        continue
      }
      sort.push(`${field}:${direction.toLowerCase() === "asc" ? "asc" : "desc"}`)
    }
    return sort
  }

  private meilisearchOptions(
    input: SearchTypes.ProviderSearchQuery
  ): MeilisearchIndexOptions | undefined {
    return input.index.settings.provider_options?.[
      MeilisearchProviderService.identifier
    ] as MeilisearchIndexOptions | undefined
  }

  async buildResult(
    response: Awaited<ReturnType<MeilisearchClient["search"]>>,
    input: SearchTypes.ProviderSearchQuery
  ): Promise<SearchTypes.SearchResult> {
    const options = input.search_options ?? {}
    const take = input.pagination?.take ?? DEFAULT_HITS_PER_PAGE
    const skip = input.pagination?.skip ?? 0

    // Page-режим: вырезаем запрошенное окно из страницы (для произвольного skip).
    const hits = (response.hits ?? []).slice(
      skip - (Math.max(take, 1) * ((response.page ?? 1) - 1)),
      skip - (Math.max(take, 1) * ((response.page ?? 1) - 1)) + take
    )

    const count =
      options.count === "none" ? null : (response.totalHits ?? null)

    const facets =
      this.buildFacets(response, options) ?? undefined

    const result: SearchTypes.SearchResult = {
      hits: hits.map((hit) => ({
        id: String(hit[input.index.primary_key] ?? hit.id ?? ""),
        document: hit as Record<string, unknown>,
        ...(this.extractHighlights(hit, options) ?? {}),
      })),
      ...(facets ? { facets } : {}),
      metadata: {
        skip,
        take,
        count,
        processing_time_ms: response.processingTimeMs,
        ...(input.q !== undefined ? { query: input.q } : {}),
      },
    }

    return result
  }

  private buildFacets(
    response: Awaited<ReturnType<MeilisearchClient["search"]>>,
    options: NonNullable<SearchTypes.ProviderSearchQuery["search_options"]>
  ): Record<string, SearchTypes.SearchFacetResult> | null {
    const facets: Record<string, SearchTypes.SearchFacetResult> = {}
    let hasAny = false

    for (const facet of options.facets ?? []) {
      const request = typeof facet === "string" ? { field: facet, type: "value" } : facet

      if (request.type === "value") {
        const distribution = response.facetDistribution?.[request.field]
        if (distribution) {
          const limit = "limit" in request && request.limit ? request.limit : undefined
          const values = Object.entries(distribution)
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count)
          facets[request.field] = {
            type: "value",
            values: limit ? values.slice(0, limit) : values,
          }
          hasAny = true
        }
        continue
      }

      if (request.type === "stats") {
        const stats = response.facetStats?.[request.field]
        if (stats && typeof stats.min === "number" && typeof stats.max === "number") {
          // count — приближение: Meilisearch не сообщает размер выборки
          // агрегатов; в качестве числа документов выборки берется точный
          // totalHits этого же запроса (см. docs/search.md — известные
          // ограничения). Само по себе значение в каталоге не используется.
          facets[request.field] = {
            type: "stats",
            min: stats.min,
            max: stats.max,
            count: response.totalHits ?? 0,
          }
          hasAny = true
        }
      }
    }

    return hasAny ? facets : null
  }

  private extractHighlights(
    hit: Record<string, unknown> & { _formatted?: Record<string, unknown> },
    options: NonNullable<SearchTypes.ProviderSearchQuery["search_options"]>
  ): { highlights: Record<string, string[]> } | null {
    if (!options.highlight || !hit._formatted) {
      return null
    }

    const fields =
      options.highlight === true
        ? Object.keys(hit._formatted)
        : options.highlight.fields

    const highlights: Record<string, string[]> = {}
    for (const field of fields) {
      const formatted = hit._formatted[field]
      if (typeof formatted === "string") {
        highlights[field] = [formatted]
      }
    }

    return Object.keys(highlights).length ? { highlights } : null
  }

  private matchIdFilter(
    filters: SearchTypes.SearchFilters | undefined
  ): string[] | null {
    if (!filters || typeof filters !== "object") {
      return null
    }

    const { id, ...rest } = filters as Record<string, unknown>

    if (id === undefined || Object.keys(rest).some((key) => key !== "id")) {
      return null
    }

    const values = Array.isArray(id) ? id : [id]
    if (!values.length || !values.every((value) => typeof value === "string")) {
      return null
    }

    return values as string[]
  }

  private buildSettings(
    index: SearchTypes.ResolvedSearchIndexDefinition
  ): Record<string, unknown> {
    const flat = this.flattenFields(index.fields)
    const meiliOptions = (index.settings.provider_options?.[
      MeilisearchProviderService.identifier
    ] ?? {}) as MeilisearchIndexOptions

    const filterable = flat
      .filter(({ field }) => field.filterable === true)
      .map(({ path }) => path)

    const sortable = flat
      .filter(({ field }) => field.sortable === true)
      .map(({ path }) => path)

    // Порядок searchable определяет релевантность Meilisearch: сначала
    // объявленные текстовые поля (title, description, sku), затем
    // родительские объекты динамических характеристик (attributes —
    // поиск по всем вложенным значениям).
    const searchable: string[] = []
    for (const { path, field } of flat) {
      if (field.searchable === true || typeof field.searchable === "object") {
        searchable.push(path)
      }
    }
    for (const parent of meiliOptions.searchable_parents ?? []) {
      if (!searchable.includes(parent)) {
        searchable.push(parent)
      }
    }

    const settings: Record<string, unknown> = {
      filterableAttributes: filterable,
      sortableAttributes: sortable,
      searchableAttributes: searchable.length ? searchable : ["*"],
    }

    if (index.settings.distinct_attribute) {
      settings.distinctAttribute = index.settings.distinct_attribute
    }

    if (index.settings.typo_tolerance) {
      const typo = index.settings.typo_tolerance
      settings.typoTolerance = {
        ...(typo.enabled === undefined ? {} : { enabled: typo.enabled }),
        ...(typo.min_word_size_for_one_typo
          ? { minWordSizeForTypos: {
              oneTypo: typo.min_word_size_for_one_typo,
              ...(typo.min_word_size_for_two_typos
                ? { twoTypos: typo.min_word_size_for_two_typos }
                : {}),
            } }
          : {}),
        ...(typo.disabled_on_attributes?.length
          ? { disableOnAttributes: typo.disabled_on_attributes }
          : {}),
      }
    }

    if (meiliOptions.faceting) {
      settings.faceting = meiliOptions.faceting
    }
    if (meiliOptions.pagination) {
      settings.pagination = meiliOptions.pagination
    }
    if (meiliOptions.stopWords) {
      settings.stopWords = meiliOptions.stopWords
    }
    if (meiliOptions.synonyms) {
      settings.synonyms = meiliOptions.synonyms
    }

    return settings
  }

  private flattenFields(
    fields: Record<string, SearchTypes.SearchFieldDefinition>,
    prefix = ""
  ): FlatField[] {
    const flat: FlatField[] = []
    for (const [name, field] of Object.entries(fields)) {
      const path = prefix ? `${prefix}.${name}` : name
      flat.push({ path, field })
      if (field.type === "object" && field.fields) {
        flat.push(...this.flattenFields(field.fields, path))
      }
    }
    return flat
  }

  private mapSearchError(error: unknown): unknown {
    if (error instanceof MeilisearchApiError) {
      return new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Meilisearch отклонил запрос: ${error.message}`,
        undefined,
        undefined,
        error
      )
    }
    return error
  }
}

export default MeilisearchProviderService

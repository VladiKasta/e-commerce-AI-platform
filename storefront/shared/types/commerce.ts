import type { FindParams, HttpTypes, SelectParams } from "@medusajs/types"

/**
 * Типы типизированного Commerce Client витрины.
 *
 * Ответы и параметры — официальные типы Medusa (`HttpTypes` из `@medusajs/types`),
 * собственные интерфейсы не дублируют контракт Medusa, а лишь добавляют
 * транспортные опции (отмена запроса, таймаут, заголовки).
 */

/**
 * Денежная сумма Medusa.
 *
 * Medusa хранит суммы в основных денежных единицах: 1490 = 1490 ₽
 * (не в копейках). Из-за поддержки BigNumber значение может прийти
 * как числом, так и строкой.
 */
export type CommerceMoneyAmount = number | string

/** Публичный (сериализуемый) снимок ошибки Commerce API. */
export interface CommerceErrorData {
  /** HTTP-код ответа; отсутствует у сетевых ошибок. */
  statusCode?: number
  /** Машинный код: `not_found`, `timeout`, `medusa_unreachable` и т.д. */
  code?: string
  /** Пользовательское сообщение (без stack trace и секретов). */
  message: string
}

/** Транспортные опции конкретного запроса. */
export interface CommerceRequestOptions {
  /** Сигнал отмены запроса (например, из AbortController вызывающего кода). */
  signal?: AbortSignal
  /** Таймаут запроса в мс; `0` отключает таймаут для этого запроса. */
  timeoutMs?: number
  /** Дополнительные заголовки запроса. */
  headers?: Record<string, string>
}

// ── Параметры методов (официальные query-параметры Store API + транспорт) ──

export type CommerceProductListParams = HttpTypes.StoreProductListParams &
  CommerceRequestOptions

export type CommerceProductParams = HttpTypes.StoreProductParams &
  CommerceRequestOptions

export type CommerceCategoryListParams = FindParams &
  HttpTypes.StoreProductCategoryListParams &
  CommerceRequestOptions

export type CommerceCategoryParams = HttpTypes.StoreProductCategoryParams &
  CommerceRequestOptions

export type CommerceCollectionListParams = FindParams &
  HttpTypes.StoreCollectionListParams &
  CommerceRequestOptions

export type CommerceCollectionParams = HttpTypes.StoreCollectionParams &
  CommerceRequestOptions

export type CommerceRegionListParams = FindParams &
  HttpTypes.StoreRegionFilters &
  CommerceRequestOptions

export type CommerceRegionParams = SelectParams & CommerceRequestOptions

// ── Группы API-клиента ─────────────────────────────────────────────────────

export interface CommerceProductsApi {
  /** Список товаров: `GET /store/products` (пагинация, фильтры, цены региона). */
  list(
    params?: CommerceProductListParams
  ): Promise<HttpTypes.StoreProductListResponse>

  /** Товар по ID: `GET /store/products/:id`. */
  getById(
    id: string,
    params?: CommerceProductParams
  ): Promise<HttpTypes.StoreProductResponse>

  /** Товар по handle (штатный фильтр `handle` в `GET /store/products`). null, если не найден. */
  getByHandle(
    handle: string,
    params?: CommerceProductParams
  ): Promise<HttpTypes.StoreProduct | null>
}

export interface CommerceCategoriesApi {
  /** Список категорий: `GET /store/product-categories`. */
  list(
    params?: CommerceCategoryListParams
  ): Promise<HttpTypes.StoreProductCategoryListResponse>

  /** Категория по ID: `GET /store/product-categories/:id`. */
  getById(
    id: string,
    params?: CommerceCategoryParams
  ): Promise<HttpTypes.StoreProductCategoryResponse>

  /** Категория по handle (штатный фильтр `handle` в `GET /store/product-categories`). null, если не найдена. */
  getByHandle(
    handle: string,
    params?: CommerceCategoryParams
  ): Promise<HttpTypes.StoreProductCategory | null>
}

export interface CommerceCollectionsApi {
  /** Список коллекций: `GET /store/collections`. */
  list(
    params?: CommerceCollectionListParams
  ): Promise<HttpTypes.StoreCollectionListResponse>

  /** Коллекция по ID: `GET /store/collections/:id`. */
  getById(
    id: string,
    params?: CommerceCollectionParams
  ): Promise<HttpTypes.StoreCollectionResponse>
}

export interface CommerceRegionsApi {
  /** Список регионов: `GET /store/regions`. */
  list(
    params?: CommerceRegionListParams
  ): Promise<HttpTypes.StoreRegionListResponse>

  /** Регион по ID: `GET /store/regions/:id`. */
  getById(
    id: string,
    params?: CommerceRegionParams
  ): Promise<HttpTypes.StoreRegionResponse>
}

/** Типизированный клиент Commerce API. Расширяется новыми группами (cart, auth, …) поэтапно. */
export interface CommerceClient {
  products: CommerceProductsApi
  categories: CommerceCategoriesApi
  collections: CommerceCollectionsApi
  regions: CommerceRegionsApi
}

// ── Опции создания клиента ──────────────────────────────────────────────────

export interface CommerceClientOptions {
  /** Базовый URL Medusa: внутренний (Docker-сеть) на сервере, публичный — в браузере. */
  baseUrl: string
  /** Publishable API key (публичен по определению Medusa). */
  publishableKey?: string
  /** Таймаут всех запросов в мс; `0` отключает. По умолчанию 15 000. */
  timeoutMs?: number
  /** Заголовки, добавляемые ко всем запросам. */
  defaultHeaders?: Record<string, string>
  /** Подробное логирование запросов SDK (только для отладки). */
  debug?: boolean
}

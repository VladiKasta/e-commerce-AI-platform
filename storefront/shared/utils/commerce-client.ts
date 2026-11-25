import Medusa from "@medusajs/js-sdk"
import type { FetchArgs } from "@medusajs/js-sdk"
import type { HttpTypes } from "@medusajs/types"
import { CommerceError, toCommerceError } from "../utils/commerce-error"
import type {
  CommerceCategoryListParams,
  CommerceCategoryParams,
  CommerceClient,
  CommerceClientOptions,
  CommerceCollectionListParams,
  CommerceCollectionParams,
  CommerceProductListParams,
  CommerceProductParams,
  CommerceRegionListParams,
  CommerceRegionParams,
  CommerceRequestOptions,
} from "../types/commerce"

/**
 * Фабрика типизированного Commerce Client.
 *
 * Транспорт — официальный Medusa JS SDK (`@medusajs/js-sdk`): он добавляет
 * publishable API key ко всем запросам, сериализует query-параметры и
 * бросает `FetchError` с HTTP-статусом. Фасад добавляет то, чего нет в SDK:
 *
 * - единообразная нормализация ошибок (`CommerceError`);
 * - настраиваемый таймаут каждого запроса (реальный AbortSignal.timeout);
 * - поддержка отмены запроса (AbortSignal вызывающего кода);
 * - автоматический запрос рассчитанных цен при передаче регионального контекста.
 *
 * Клиент не содержит пользовательского состояния и безопасен
 * для создания на каждый запрос (SSR).
 */

/** Поля, которые Medusa требует для рассчитанной цены варианта в контексте региона. */
const CALCULATED_PRICE_FIELDS = "+*variants.calculated_price"

const DEFAULT_TIMEOUT_MS = 15_000

/** Query с контекстом ценообразования (region_id / country_code / cart_id). */
type PricingQuery = {
  region_id?: string | string[]
  country_code?: string | string[]
  cart_id?: string | string[]
}

/** Добавляет `+*variants.calculated_price`, если передан региональный контекст. */
function withPriceFields<T extends PricingQuery & { fields?: string }>(query: T): T {
  const hasContext =
    query.region_id !== undefined ||
    query.country_code !== undefined ||
    query.cart_id !== undefined

  if (!hasContext || query.fields?.includes("calculated_price")) {
    return query
  }

  return {
    ...query,
    fields: query.fields
      ? `${query.fields},${CALCULATED_PRICE_FIELDS}`
      : CALCULATED_PRICE_FIELDS,
  }
}

/** Отделяет транспортные опции от query-параметров. */
function splitOptions<T extends CommerceRequestOptions>(
  params: T
): {
  init: Pick<FetchArgs, "signal"> & { headers?: Record<string, string> }
  timeoutMs: number | undefined
  query: Omit<T, keyof CommerceRequestOptions>
} {
  const { signal, timeoutMs, headers, ...query } = params
  return {
    init: { signal, headers },
    timeoutMs,
    query: query as Omit<T, keyof CommerceRequestOptions>,
  }
}

/** Создает Commerce Client поверх Medusa JS SDK. */
export function createCommerceClient(options: CommerceClientOptions): CommerceClient {
  const sdk = new Medusa({
    baseUrl: options.baseUrl,
    publishableKey: options.publishableKey,
    globalHeaders: options.defaultHeaders,
    debug: options.debug ?? false,
  })

  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /**
   * Выполняет запрос через SDK с таймаутом, отменой и нормализацией ошибок.
   * Ошибки сети/таймаута/HTTP всегда превращаются в `CommerceError`.
   */
  async function request<T>(
    path: string,
    init: Pick<FetchArgs, "signal" | "query"> & {
      headers?: Record<string, string>
    },
    timeoutMs?: number
  ): Promise<T> {
    const signals: AbortSignal[] = []
    if (init.signal) {
      signals.push(init.signal)
    }

    const effectiveTimeout = timeoutMs ?? defaultTimeoutMs
    if (effectiveTimeout > 0) {
      signals.push(AbortSignal.timeout(effectiveTimeout))
    }

    const signal =
      signals.length === 0
        ? undefined
        : signals.length === 1
          ? signals[0]
          : AbortSignal.any(signals)

    try {
      return await sdk.client.fetch<T>(
        path,
        signal ? { ...init, signal } : { ...init }
      )
    } catch (error) {
      throw toCommerceError(error)
    }
  }

  return {
    products: {
      list: (params: CommerceProductListParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        return request<HttpTypes.StoreProductListResponse>(
          "/store/products",
          { ...init, query: withPriceFields(query) },
          timeoutMs
        )
      },

      getById: (id: string, params: CommerceProductParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        return request<HttpTypes.StoreProductResponse>(
          `/store/products/${encodeURIComponent(id)}`,
          { ...init, query: withPriceFields(query) },
          timeoutMs
        )
      },

      getByHandle: async (
        handle: string,
        params: CommerceProductParams = {}
      ) => {
        const { init, timeoutMs, query } = splitOptions(params)
        const response = await request<HttpTypes.StoreProductListResponse>(
          "/store/products",
          // Штатный механизм Medusa: фильтр handle в списке товаров.
          { ...init, query: withPriceFields({ ...query, handle, limit: 1 }) },
          timeoutMs
        )
        return response.products[0] ?? null
      },
    },

    categories: {
      list: (params: CommerceCategoryListParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        return request<HttpTypes.StoreProductCategoryListResponse>(
          "/store/product-categories",
          { ...init, query },
          timeoutMs
        )
      },

      getById: async (id: string, params: CommerceCategoryParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        const response = await request<HttpTypes.StoreProductCategoryResponse>(
          `/store/product-categories/${encodeURIComponent(id)}`,
          { ...init, query },
          timeoutMs
        )
        // Особенность Medusa 2.23: несуществующая категория по ID возвращает
        // 200 с пустым телом вместо 404 — нормализуем в явный 404.
        if (!response?.product_category) {
          throw new CommerceError(
            `Категория с id "${id}" не найдена.`,
            { statusCode: 404, code: "not_found" }
          )
        }
        return response
      },

      getByHandle: async (
        handle: string,
        params: CommerceCategoryParams = {}
      ) => {
        const { init, timeoutMs, query } = splitOptions(params)
        const response =
          await request<HttpTypes.StoreProductCategoryListResponse>(
            "/store/product-categories",
            // Штатный механизм Medusa: фильтр handle в списке категорий.
            { ...init, query: { ...query, handle, limit: 1 } },
            timeoutMs
          )
        return response.product_categories[0] ?? null
      },
    },

    collections: {
      list: (params: CommerceCollectionListParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        return request<HttpTypes.StoreCollectionListResponse>(
          "/store/collections",
          { ...init, query },
          timeoutMs
        )
      },

      getById: (id: string, params: CommerceCollectionParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        return request<HttpTypes.StoreCollectionResponse>(
          `/store/collections/${encodeURIComponent(id)}`,
          { ...init, query },
          timeoutMs
        )
      },
    },

    regions: {
      list: (params: CommerceRegionListParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        return request<HttpTypes.StoreRegionListResponse>(
          "/store/regions",
          { ...init, query },
          timeoutMs
        )
      },

      getById: (id: string, params: CommerceRegionParams = {}) => {
        const { init, timeoutMs, query } = splitOptions(params)
        return request<HttpTypes.StoreRegionResponse>(
          `/store/regions/${encodeURIComponent(id)}`,
          { ...init, query },
          timeoutMs
        )
      },
    },
  }
}

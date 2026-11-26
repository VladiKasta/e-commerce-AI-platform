/**
 * Типизированные контракты каталога и поиска (этап 3).
 *
 * Используются маршрутами Store API (backend) и подготавливаются для
 * переиспользования Commerce Client'ом витрины (зеркальная копия —
 * storefront/shared/types/catalog.ts; composables появятся на этапе 4).
 *
 * Контракт ответа един для /store/catalog и /store/search (см. docs/api.md).
 */

/** Поддерживаемые варианты сортировки каталога. */
export type CatalogSort =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "newest"
  | "title_asc"

export const CATALOG_SORT_OPTIONS: CatalogSort[] = [
  "relevance",
  "price_asc",
  "price_desc",
  "newest",
  "title_asc",
]

/** Параметры запроса каталога/поиска после валидации. */
export type CatalogQuery = {
  /** Полнотекстовый запрос (обязателен для /store/search). */
  q?: string
  /** Хэндл категории каталога. */
  category?: string
  /** Хэндл коллекции. */
  collection?: string
  /** Регион ценообразования; проверяется на backend, валюта определяется им же. */
  region_id?: string
  /** Значения фильтров: код характеристики → выбранные значения (OR внутри кода). */
  filter?: Record<string, string[]>
  /** Диапазон цен в валюте региона (основные единицы Medusa). */
  price_min?: number
  price_max?: number
  /** Фильтр по наличию. */
  in_stock?: boolean
  sort?: CatalogSort
  limit?: number
  offset?: number
}

/** Товар каталога — поисковая проекция варианта-представителя товара. */
export type CatalogProduct = {
  id: string
  variant_id: string | null
  title: string
  description: string
  handle: string
  sku: string
  thumbnail: string | null
  price: {
    /** Сумма в основных единицах (1490 = 1490 ₽). */
    amount: number
    currency_code: string
  }
  in_stock: boolean
  category_handles: string[]
  collection_handles: string[]
  /**
   * Характеристики представленного варианта. НЕ является заменой карточки
   * товара: витрина обязана запрашивать полные данные и рассчитанные цены
   * через штатный /store/products (Meilisearch — производная проекция).
   */
  attributes: Record<string, unknown>
}

/** Значение фасета с точным числом УНИКАЛЬНЫХ товаров. */
export type FacetOption = {
  value: string
  label: string
  count: number
  selected: boolean
}

/** Фасет-список значений (checkbox/select/radio/color). */
export type OptionsFacet = {
  code: string
  label: string
  type: "checkbox" | "select" | "radio" | "color"
  unit?: string
  options: FacetOption[]
}

/** Числовой диапазон (цена, числовые характеристики). min/max — по текущей
 *  выборке с учетом остальных фильтров (disjunctive), без собственного фильтра. */
export type RangeFacet = {
  code: string
  label: string
  type: "range"
  unit: string
  min: number
  max: number
}

/** Boolean-фасет (наличие, boolean-характеристики). */
export type BooleanFacet = {
  code: string
  label: string
  type: "boolean"
  options: FacetOption[]
}

export type CatalogFacet = OptionsFacet | RangeFacet | BooleanFacet

export type CatalogPagination = {
  /** Точное число уникальных товаров по запросу (не вариантов). */
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

/** Единый контракт ответа /store/catalog и /store/search. */
export type CatalogResponse = {
  products: CatalogProduct[]
  pagination: CatalogPagination
  facets: CatalogFacet[]
  sortOptions: CatalogSort[]
}

/** Подсказка поиска (/store/search/suggestions). */
export type SearchSuggestion = {
  text: string
  product_id: string
  handle: string
  sku: string
}

/** Коды ошибок поисковых маршрутов (см. docs/api.md). */
export type CatalogErrorCode =
  | "invalid_query"
  | "unknown_region"
  | "search_unavailable"

export type CatalogErrorResponse = {
  type: string
  message: string
}

/** Ограничения запросов каталога (защита от перегрузки). */
export const CATALOG_LIMITS = {
  defaultLimit: 24,
  maxLimit: 100,
  maxOffset: 10_000,
  /** Максимум значений на фасет в ответе. */
  maxFacetValues: 25,
  /** Максимум фасетов в ответе. */
  maxFacets: 10,
  /** Максимум длины поисковой строки. */
  maxQueryLength: 128,
} as const

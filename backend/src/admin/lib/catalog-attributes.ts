import type {
  AttributeDataType,
  AttributeFilterType,
} from "../../modules/catalog-attributes"

/**
 * Типы и API-клиент Admin API характеристик каталога для расширений
 * Medusa Admin (этап 3.5.1).
 *
 * Запросы выполняются обычным fetch в том же origin, что и Medusa Admin
 * (бандл расширений исполняется внутри dashboard): аутентификация —
 * session cookie (credentials: "include"), как у штатных страниц админки.
 * Новых зависимостей не требуется (@tanstack/react-query уже входит в
 * backend-зависимости и используется бандлом админки).
 *
 * Союзные типы значений импортируются из модуля (import type — стирается
 * при компиляции, серверный код в бандл не попадает). Остальные контракты
 * зеркалируют docs/api.md (маршруты 15–26).
 */

export type { AttributeDataType, AttributeFilterType }

export interface AttributeOptionDTO {
  id: string
  attribute_id?: string
  value: string
  label: string
  position: number
}

export interface AttributeDTO {
  id: string
  code: string
  name: string
  data_type: AttributeDataType
  filter_type: AttributeFilterType
  unit: string | null
  filterable: boolean
  /** Не отображается в UI: флаг не потребляется индексатором (техдолг). */
  searchable: boolean
  position: number
  option_title: string | null
  options: AttributeOptionDTO[]
  categories: Array<{ id: string; category_id: string; position: number }>
}

export interface AttributeListResponse {
  attributes: AttributeDTO[]
  count: number
  limit: number
  offset: number
}

export interface AttributeResponse {
  attribute: AttributeDTO
}

export interface AttributeOptionsResponse {
  attribute_options: AttributeOptionDTO[]
}

export interface AttributeOptionResponse {
  attribute_option: AttributeOptionDTO
}

export interface DeleteResponse {
  id: string
  object: string
  deleted: boolean
}

export interface CategoryAttributesResponse {
  category_attributes: Array<{
    id: string
    category_id: string
    position: number
  }>
}

export interface ProductCategoryDTO {
  id: string
  name: string
  handle: string
}

export interface ProductCategoriesResponse {
  product_categories: ProductCategoryDTO[]
  count: number
}

export interface ProductAttributeValueDTO {
  id: string
  attribute_id: string
  product_id: string
  variant_id: string | null
  text_value: string | null
  numeric_value: number | null
  boolean_value: boolean | null
}

export interface ProductAttributeValuesResponse {
  product_attribute_values: ProductAttributeValueDTO[]
}

export interface ProductWithCategoriesResponse {
  product: {
    id: string
    title: string
    categories: Array<{ id: string; name: string; handle: string }>
  }
}

/** Примитивное значение строки характеристики (заполнена одна из колонок). */
export function readRawValue(
  row: ProductAttributeValueDTO
): string | number | boolean | null {
  if (row.text_value !== null && row.text_value !== undefined) {
    return row.text_value
  }
  if (row.numeric_value !== null && row.numeric_value !== undefined) {
    // Float32 в PostgreSQL дает артефакты точности (4.7 → 4.699999809…):
    // нормализуем для отображения и сравнения.
    return Math.round(row.numeric_value * 1e6) / 1e6
  }
  if (row.boolean_value !== null && row.boolean_value !== undefined) {
    return row.boolean_value
  }
  return null
}

export const DATA_TYPE_LABELS: Record<AttributeDataType, string> = {
  text: "Текст",
  number: "Число",
  boolean: "Флажок",
  select: "Выбор одного значения",
  multi_select: "Выбор нескольких значений",
}

export const FILTER_TYPE_LABELS: Record<AttributeFilterType, string> = {
  checkbox: "Чек-боксы",
  select: "Выпадающий список",
  radio: "Радио-кнопки",
  range: "Диапазон",
  color: "Цвет",
  boolean: "Да/Нет",
}

type RequestOptions = {
  method?: string
  body?: unknown
}

/** fetch к Admin API с session-аутентификацией; ошибка — Error с message API. */
export async function adminFetch<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const hasBody = options.body !== undefined
  const res = await fetch(path, {
    credentials: "include",
    method: options.method ?? "GET",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  })

  if (!res.ok) {
    const error = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(error?.message ?? `Ошибка запроса (HTTP ${res.status})`)
  }

  return (await res.json()) as T
}

// ── Ресурс «характеристики» ───────────────────────────────────────────────

export const attributesApi = {
  list: () => adminFetch<AttributeListResponse>("/admin/catalog-attributes?limit=100"),

  retrieve: (id: string) =>
    adminFetch<AttributeResponse>(`/admin/catalog-attributes/${id}`),

  create: (body: {
    code: string
    name: string
    data_type: AttributeDataType
    filter_type: AttributeFilterType
    unit?: string | null
    filterable: boolean
    position: number
    option_title?: string | null
    options?: Array<{ value: string; label: string }>
  }) =>
    adminFetch<AttributeResponse>("/admin/catalog-attributes", {
      method: "POST",
      body,
    }),

  update: (
    id: string,
    body: Partial<{
      name: string
      filter_type: AttributeFilterType
      unit: string | null
      filterable: boolean
      position: number
      option_title: string | null
    }>
  ) =>
    adminFetch<AttributeResponse>(`/admin/catalog-attributes/${id}`, {
      method: "POST",
      body,
    }),

  delete: (id: string) =>
    adminFetch<DeleteResponse>(`/admin/catalog-attributes/${id}`, {
      method: "DELETE",
    }),

  /**
   * Идемпотентная замена всего набора привязок к категориям:
   * порядок массива задает position (docs/api.md, маршрут 23).
   */
  setCategories: (id: string, categoryIds: string[]) =>
    adminFetch<CategoryAttributesResponse>(
      `/admin/catalog-attributes/${id}/categories`,
      { method: "POST", body: { category_ids: categoryIds } }
    ),

  // ── Допустимые значения ────────────────────────────────────────────────

  addOptions: (
    id: string,
    options: Array<{ value: string; label: string; position?: number }>
  ) =>
    adminFetch<AttributeOptionsResponse>(
      `/admin/catalog-attributes/${id}/options`,
      { method: "POST", body: { options } }
    ),

  updateOption: (
    id: string,
    optionId: string,
    body: { label?: string; position?: number }
  ) =>
    adminFetch<AttributeOptionResponse>(
      `/admin/catalog-attributes/${id}/options/${optionId}`,
      { method: "POST", body }
    ),

  deleteOption: (id: string, optionId: string) =>
    adminFetch<DeleteResponse>(
      `/admin/catalog-attributes/${id}/options/${optionId}`,
      { method: "DELETE" }
    ),
}

// ── Ресурс «категории каталога» (штатный Admin API Medusa) ────────────────

/** Имена категорий для отображения привязок (базовые поля, seed ≤ 100). */
export const categoriesApi = {
  list: () =>
    adminFetch<ProductCategoriesResponse>(
      "/admin/product-categories?limit=100&fields=+handle"
    ),
}

// ── Ресурс «значения характеристик товара» (маршруты 24–26) ──────────────

export const productAttributeValuesApi = {
  list: (productId: string) =>
    adminFetch<ProductAttributeValuesResponse>(
      `/admin/products/${productId}/attribute-values`
    ),

  /**
   * Идемпотентная перезапись значений: для каждой пары
   * (характеристика × товар) набор заменяется целиком (маршрут 25).
   */
  set: (
    productId: string,
    values: Array<{ attribute_id: string; value: string | number | boolean }>
  ) =>
    adminFetch<ProductAttributeValuesResponse>(
      `/admin/products/${productId}/attribute-values`,
      { method: "POST", body: { values } }
    ),

  /** Удаление всех значений одной характеристики уровня товара (маршрут 26). */
  clear: (productId: string, attributeId: string) =>
    adminFetch<{
      ids: string[]
      object: string
      deleted: boolean
      product_id: string
      attribute_id: string
      variant_id: string | null
    }>(
      `/admin/products/${productId}/attribute-values?attribute_id=${attributeId}`,
      { method: "DELETE" }
    ),
}

/** Категории товара (для вычисления доступных характеристик виджета). */
export const productCategoriesOf = (productId: string) =>
  adminFetch<ProductWithCategoriesResponse>(
    `/admin/products/${productId}?fields=+categories.id,+categories.name,+categories.handle`
  )

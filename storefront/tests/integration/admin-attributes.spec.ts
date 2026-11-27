import { beforeAll, describe, expect, it } from "vitest"

/**
 * Интеграционные тесты Admin API характеристик товаров (этап 3.4) на
 * РЕАЛЬНОЙ Medusa (демо-данные). Запускаются через `make test` внутри
 * Docker: ADMIN_EMAIL/ADMIN_PASSWORD передаются ТОЛЬКО в одноразовый
 * тестовый контейнер (docker compose run -e). Тесты образуют сквозной
 * сценарий (создание → редактирование → опции → категории → значения →
 * удаление) и выполняются последовательно; тестовая характеристика
 * удаляется каскадом в предпоследнем тесте — seed-данные не затрагиваются.
 */

const baseUrl =
  process.env.NUXT_MEDUSA_URL ??
  process.env.MEDUSA_PUBLIC_URL ??
  "http://localhost:9000"

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD

const publishableKey =
  process.env.NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  process.env.MEDUSA_PUBLISHABLE_KEY

// ── Типы ответов Admin API характеристик (docs/api.md, маршруты 15–26) ──

interface AttributeOptionDto {
  id: string
  value: string
  label: string
}

interface CategoryAttributeDto {
  id: string
  category_id: string
  position: number
}

interface AttributeDto {
  id: string
  code: string
  name: string
  data_type: string
  options: AttributeOptionDto[]
  categories: CategoryAttributeDto[]
}

interface AttributeListResponse {
  attributes: AttributeDto[]
  count: number
}

interface AttributeResponse {
  attribute: AttributeDto
}

interface AttributeOptionsResponse {
  attribute_options: AttributeOptionDto[]
}

interface CategoryAttributesResponse {
  category_attributes: CategoryAttributeDto[]
}

interface ProductAttributeValueDto {
  id: string
  attribute_id: string
  text_value: string | null
}

interface ProductAttributeValuesResponse {
  product_attribute_values: ProductAttributeValueDto[]
}

interface DeleteResponse {
  id: string
  object: string
  deleted: boolean
}

interface CatalogFacetOption {
  value: string
  count: number
}

interface CatalogResponse {
  pagination: { total: number }
  facets: Array<{ code: string; options: CatalogFacetOption[] }>
}

interface ErrorBody {
  type?: string
  message?: string
}

/**
 * Ответ API: статус + распарсенное тело (null для пустых/не-JSON ответов).
 * Тело ошибки читается вызовом с T = ErrorBody (контракт {type, message}).
 */
type ApiResult<T> = { status: number; body: T | null }

async function adminFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; token?: string }
): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init?.body !== undefined
      ? { body: JSON.stringify(init.body) }
      : {}),
  })
  const body = (await res.json().catch(() => null)) as T | null
  return { status: res.status, body }
}

function storeHeaders(): Record<string, string> {
  if (!publishableKey) {
    throw new Error(
      "Интеграционные тесты требуют publishable API key: задайте MEDUSA_PUBLISHABLE_KEY (или запускайте через `make test`)."
    )
  }
  return { "x-publishable-api-key": publishableKey }
}

async function storeFetch<T>(path: string): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, { headers: storeHeaders() })
  const body = (await res.json().catch(() => null)) as T | null
  return { status: res.status, body }
}

// ── Состояние сквозного сценария ─────────────────────────────────────────

let token = ""
let attributeId = ""
let attributeCode = ""
let productId = ""
let categoryId = ""

beforeAll(async () => {
  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Тесты Admin API требуют ADMIN_EMAIL/ADMIN_PASSWORD (передаются через `make test`)."
    )
  }

  const auth = await adminFetch<{ token?: string }>("/auth/user/emailpass", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  })
  if (!auth.body?.token) {
    throw new Error(
      `Не удалось аутентифицировать администратора: HTTP ${auth.status}`
    )
  }
  token = auth.body.token

  const products = await adminFetch<{ products: Array<{ id: string }> }>(
    "/admin/products?limit=1",
    { token }
  )
  productId = products.body?.products[0]?.id ?? ""

  const categories = await adminFetch<{
    product_categories: Array<{ id: string }>
  }>("/admin/product-categories?limit=1", { token })
  categoryId = categories.body?.product_categories[0]?.id ?? ""

  if (!productId || !categoryId) {
    throw new Error("В магазине нет товаров или категорий для теста")
  }

  // Уникальный код: тесты можно запускать повторно без конфликтов.
  attributeCode = `test-season-${Date.now()}`
})

describe("Admin API характеристик: авторизация и реестр", () => {
  it("требует авторизацию: без Bearer JWT — 401", async () => {
    const res = await adminFetch<Record<string, unknown>>(
      "/admin/catalog-attributes"
    )

    expect(res.status).toBe(401)
  })

  it("список: seed-реестр с допустимыми значениями и привязками", async () => {
    const res = await adminFetch<AttributeListResponse>(
      "/admin/catalog-attributes?limit=20",
      { token }
    )

    expect(res.status).toBe(200)
    const body = res.body as AttributeListResponse
    expect(body.count).toBeGreaterThanOrEqual(6)

    const brand = body.attributes.find(
      (attribute) => attribute.code === "brand"
    )
    expect(brand).toBeDefined()
    expect(brand!.options.length).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(brand!.categories)).toBe(true)
  })
})

describe("Admin API характеристик: CRUD и валидация", () => {
  it("создание характеристики с допустимыми значениями", async () => {
    const res = await adminFetch<AttributeResponse>(
      "/admin/catalog-attributes",
      {
        method: "POST",
        token,
        body: {
          code: attributeCode,
          name: "Сезон",
          data_type: "select",
          options: [
            { value: "summer", label: "Лето" },
            { value: "winter", label: "Зима" },
          ],
        },
      }
    )

    expect(res.status).toBe(201)
    const attribute = (res.body as AttributeResponse).attribute
    expect(attribute.code).toBe(attributeCode)
    expect(attribute.data_type).toBe("select")
    expect(attribute.options.map((option) => option.value).sort()).toEqual([
      "summer",
      "winter",
    ])
    attributeId = attribute.id
  })

  it("валидация: дубликат кода и некорректный код → 400 invalid_data", async () => {
    const duplicate = await adminFetch<ErrorBody>("/admin/catalog-attributes", {
      method: "POST",
      token,
      body: { code: attributeCode, name: "Дубль" },
    })
    expect(duplicate.status).toBe(400)
    expect((duplicate.body as ErrorBody).type).toBe("invalid_data")

    const invalidCode = await adminFetch<ErrorBody>(
      "/admin/catalog-attributes",
      {
        method: "POST",
        token,
        body: { code: "Bad Code", name: "Плохой код" },
      }
    )
    expect(invalidCode.status).toBe(400)
    expect((invalidCode.body as ErrorBody).type).toBe("invalid_data")
  })

  it("редактирование: name обновляется, data_type неизменяем", async () => {
    const res = await adminFetch<AttributeResponse>(
      `/admin/catalog-attributes/${attributeId}`,
      { method: "POST", token, body: { name: "Сезонность" } }
    )
    expect(res.status).toBe(200)
    expect((res.body as AttributeResponse).attribute.name).toBe("Сезонность")

    const resample = await adminFetch<ErrorBody>(
      `/admin/catalog-attributes/${attributeId}`,
      { method: "POST", token, body: { data_type: "text" } }
    )
    expect(resample.status).toBe(400)
    expect((resample.body as ErrorBody).type).toBe("invalid_data")
  })
})

describe("Admin API характеристик: допустимые значения, категории, товары", () => {
  it("опции: добавление 201, дубликат существующего значения 400", async () => {
    const res = await adminFetch<AttributeOptionsResponse>(
      `/admin/catalog-attributes/${attributeId}/options`,
      {
        method: "POST",
        token,
        body: { options: [{ value: "demi", label: "Демисезон" }] },
      }
    )
    expect(res.status).toBe(201)
    const option = (res.body as AttributeOptionsResponse).attribute_options[0]!
    expect(option.value).toBe("demi")
    expect(option.label).toBe("Демисезон")

    const duplicate = await adminFetch<ErrorBody>(
      `/admin/catalog-attributes/${attributeId}/options`,
      {
        method: "POST",
        token,
        body: { options: [{ value: "summer", label: "Дубль лета" }] },
      }
    )
    expect(duplicate.status).toBe(400)
    expect((duplicate.body as ErrorBody).type).toBe("invalid_data")
  })

  it("привязки к категориям: валидная категория 200, несуществующая 400", async () => {
    const res = await adminFetch<CategoryAttributesResponse>(
      `/admin/catalog-attributes/${attributeId}/categories`,
      { method: "POST", token, body: { category_ids: [categoryId] } }
    )
    expect(res.status).toBe(200)
    const binding = (res.body as CategoryAttributesResponse)
      .category_attributes[0]!
    expect(binding.category_id).toBe(categoryId)
    expect(binding.position).toBe(1)

    const invalid = await adminFetch<ErrorBody>(
      `/admin/catalog-attributes/${attributeId}/categories`,
      { method: "POST", token, body: { category_ids: ["pcat_nonexistent"] } }
    )
    expect(invalid.status).toBe(400)
    expect((invalid.body as ErrorBody).type).toBe("invalid_data")
  })

  it("значения товара: перезапись идемпотентна, тип и допустимость проверяются", async () => {
    const set = await adminFetch<ProductAttributeValuesResponse>(
      `/admin/products/${productId}/attribute-values`,
      {
        method: "POST",
        token,
        body: { values: [{ attribute_id: attributeId, value: "summer" }] },
      }
    )
    expect(set.status).toBe(201)
    expect(
      (set.body as ProductAttributeValuesResponse).product_attribute_values
    ).toHaveLength(1)

    // Перезапись того же scope заменяет значение, а не дублирует.
    const replace = await adminFetch<ProductAttributeValuesResponse>(
      `/admin/products/${productId}/attribute-values`,
      {
        method: "POST",
        token,
        body: { values: [{ attribute_id: attributeId, value: "winter" }] },
      }
    )
    expect(replace.status).toBe(201)

    const values = await adminFetch<ProductAttributeValuesResponse>(
      `/admin/products/${productId}/attribute-values`,
      { token }
    )
    expect(values.status).toBe(200)
    const rows = (values.body as ProductAttributeValuesResponse)
      .product_attribute_values
    const scoped = rows.filter((row) => row.attribute_id === attributeId)
    expect(scoped).toHaveLength(1)
    expect(scoped[0]!.text_value).toBe("winter")

    // Число для select-характеристики — некорректный тип значения.
    const wrongType = await adminFetch<ErrorBody>(
      `/admin/products/${productId}/attribute-values`,
      {
        method: "POST",
        token,
        body: { values: [{ attribute_id: attributeId, value: 42 }] },
      }
    )
    expect(wrongType.status).toBe(400)
    expect((wrongType.body as ErrorBody).type).toBe("invalid_data")

    // Значение вне реестра допустимых опций.
    const unknownOption = await adminFetch<ErrorBody>(
      `/admin/products/${productId}/attribute-values`,
      {
        method: "POST",
        token,
        body: {
          values: [{ attribute_id: attributeId, value: "not-a-season" }],
        },
      }
    )
    expect(unknownOption.status).toBe(400)
    expect((unknownOption.body as ErrorBody).type).toBe("invalid_data")
  })

  it("удаление: каскад без осиротевших значений", async () => {
    const res = await adminFetch<DeleteResponse>(
      `/admin/catalog-attributes/${attributeId}`,
      { method: "DELETE", token }
    )
    expect(res.status).toBe(200)
    const deleted = res.body as DeleteResponse
    expect(deleted.id).toBe(attributeId)
    expect(deleted.object).toBe("catalog-attribute")
    expect(deleted.deleted).toBe(true)

    const gone = await adminFetch<ErrorBody>(
      `/admin/catalog-attributes/${attributeId}`,
      { token }
    )
    expect(gone.status).toBe(404)
    expect((gone.body as ErrorBody).type).toBe("not_found")

    // Значения товара, ссылающиеся на удаленную характеристику, удалены.
    const values = await adminFetch<ProductAttributeValuesResponse>(
      `/admin/products/${productId}/attribute-values`,
      { token }
    )
    expect(values.status).toBe(200)
    const orphaned = (values.body as ProductAttributeValuesResponse)
      .product_attribute_values
      .filter((row) => row.attribute_id === attributeId)
    expect(orphaned).toHaveLength(0)
  })
})

describe("Admin API характеристик: регрессия витрины", () => {
  it("точные счетчики seed-фасетов сохранены (сумма brand = total)", async () => {
    const res = await storeFetch<CatalogResponse>("/store/catalog?limit=5")

    expect(res.status).toBe(200)
    const body = res.body as CatalogResponse
    expect(body.pagination.total).toBeGreaterThanOrEqual(10)

    const brand = body.facets.find((facet) => facet.code === "brand")
    expect(brand).toBeDefined()
    const sum = brand!.options.reduce((acc, option) => acc + option.count, 0)
    expect(sum).toBe(body.pagination.total)
  })
})

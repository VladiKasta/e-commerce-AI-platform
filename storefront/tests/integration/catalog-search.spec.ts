import { beforeAll, describe, expect, it } from "vitest"

/**
 * Интеграционные тесты поисковых маршрутов каталога (этап 3) на РЕАЛЬНЫХ
 * Medusa и Meilisearch (демо-данные этапов 1–3).
 *
 * Маршруты: GET /store/catalog, GET /store/search,
 * GET /store/search/suggestions — см. docs/api.md.
 *
 * Запускаются через `make test` внутри Docker (env из docker-compose)
 * или на хосте:
 *
 *   MEDUSA_PUBLISHABLE_KEY=... pnpm --filter @ecommerce-starter/storefront test:integration
 */

const baseUrl =
  process.env.NUXT_MEDUSA_URL ??
  process.env.MEDUSA_PUBLIC_URL ??
  "http://localhost:9000"

const publishableKey =
  process.env.NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  process.env.MEDUSA_PUBLISHABLE_KEY

let apiKey: string

beforeAll(() => {
  if (!publishableKey) {
    throw new Error(
      "Интеграционные тесты требуют publishable API key: задайте MEDUSA_PUBLISHABLE_KEY (или запускайте через `make test`)."
    )
  }
  apiKey = publishableKey
})

// Минимальные структурные типы контракта (зеркало backend/src/types/catalog.ts).
type CatalogProduct = {
  id: string
  variant_id: string | null
  title: string
  handle: string
  sku: string
  price: { amount: number; currency_code: string }
  in_stock: boolean
  category_handles: string[]
  collection_handles: string[]
  attributes: Record<string, unknown>
}

type FacetOption = { value: string; label: string; count: number; selected: boolean }

type CatalogFacet =
  | { code: string; label: string; type: "checkbox" | "select" | "radio" | "color"; options: FacetOption[] }
  | { code: string; label: string; type: "range"; unit: string; min: number; max: number }
  | { code: string; label: string; type: "boolean"; options: FacetOption[] }

type CatalogResponse = {
  products: CatalogProduct[]
  pagination: { total: number; limit: number; offset: number; hasMore: boolean }
  facets: CatalogFacet[]
  sortOptions: string[]
}

type CatalogErrorResponse = { type: string; message: string }

type ApiResult<T> = { status: number; body: T }

async function apiGet<T>(path: string, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-publishable-api-key": apiKey, ...headers },
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as T) : ({} as T) }
}

function catalog(path: string): Promise<ApiResult<CatalogResponse & { products: CatalogProduct[] }>> {
  return apiGet<CatalogResponse>(`/store/catalog${path}`)
}

function facet(response: CatalogResponse, code: string): CatalogFacet | undefined {
  return response.facets.find((item) => item.code === code)
}

function optionsOf(facetValue: CatalogFacet | undefined): FacetOption[] {
  return facetValue && "options" in facetValue ? facetValue.options : []
}

const enc = encodeURIComponent

/** Всего демо-товаров в каталоге (fixture этапа 3). */
const TOTAL_PRODUCTS = 12

describe("Store API каталога: базовый контракт", () => {
  it("возвращает каталог с точным числом уникальных товаров", async () => {
    const { status, body } = await catalog("?limit=100")

    expect(status).toBe(200)
    expect(body.products).toHaveLength(TOTAL_PRODUCTS)
    expect(body.pagination.total).toBe(TOTAL_PRODUCTS)
    expect(body.pagination.hasMore).toBe(false)

    const ids = body.products.map((product) => product.id)
    expect(new Set(ids).size).toBe(TOTAL_PRODUCTS)

    for (const product of body.products) {
      expect(product.handle).toBeTruthy()
      expect(product.price.currency_code).toBe("rub")
      expect(typeof product.price.amount).toBe("number")
      expect(typeof product.in_stock).toBe("boolean")
    }
  })

  it("возвращает фасеты с точными счетчиками уникальных товаров", async () => {
    const { body } = await catalog("?limit=1")

    const brand = facet(body, "brand")
    const brandOptions = optionsOf(brand)
    expect(brandOptions.length).toBeGreaterThan(0)

    // Сумма счетчиков фасета brand = число товаров: каждый товар считается
    // один раз (прототип этапа 3: facetDistribution считает варианты,
    // маршрут считает уникальные товары).
    const brandSum = brandOptions.reduce((sum, option) => sum + option.count, 0)
    expect(brandSum).toBe(TOTAL_PRODUCTS)
  })

  it("возвращает диапазон цен в валюте магазина", async () => {
    const { body } = await catalog("?limit=1")
    const price = facet(body, "price")

    expect(price?.type).toBe("range")
    if (price?.type === "range") {
      expect(price.unit).toBe("RUB")
      expect(price.min).toBeLessThanOrEqual(price.max)
      expect(price.min).toBeGreaterThan(0)
    }
  })
})

describe("Store API каталога: поиск", () => {
  it("находит товары по названию (русский язык)", async () => {
    const { status, body } = await apiGet<CatalogResponse>(
      `/store/search?q=${enc("футболка")}&limit=10`
    )

    expect(status).toBe(200)
    expect(body.pagination.total).toBe(3)
    const titles = body.products.map((product) => product.title)
    expect(titles).toContain("Футболка «Медуза»")
    expect(titles).toContain("Футболка «Кракен»")
    expect(titles).toContain("Футболка «Простая»")
  })

  it("находит товар по артикулу", async () => {
    const { body } = await apiGet<CatalogResponse>(
      `/store/search?q=${enc("TEE-KRAKEN")}&limit=10`
    )

    expect(body.pagination.total).toBeGreaterThanOrEqual(1)
    expect(body.products.map((product) => product.handle)).toContain("futbolka-kraken")
  })

  it("поиск по неполному слову через подсказки", async () => {
    const { status, body } = await apiGet<{ suggestions: Array<{ text: string; product_id: string; handle: string; sku: string }> }>(
      `/store/search/suggestions?q=${enc("футб")}`
    )

    expect(status).toBe(200)
    expect(body.suggestions.length).toBeGreaterThanOrEqual(3)

    const productIds = body.suggestions.map((suggestion) => suggestion.product_id)
    expect(new Set(productIds).size).toBe(productIds.length)

    expect(
      body.suggestions.some((suggestion) => suggestion.text.includes("Футболка"))
    ).toBe(true)
  })
})

describe("Store API каталога: фильтрация", () => {
  it("фильтрует по диапазону цен", async () => {
    const { body } = await catalog("?price_min=3000")

    expect(body.products.length).toBeGreaterThan(0)
    for (const product of body.products) {
      expect(product.price.amount).toBeGreaterThanOrEqual(3000)
    }

    const narrow = await catalog("?price_max=500")
    expect(narrow.body.products.map((product) => product.handle)).toEqual(["stikerpak-more"])

    const combined = await catalog("?price_min=1000&price_max=2000")
    expect(combined.body.products.length).toBeGreaterThan(0)
    for (const product of combined.body.products) {
      expect(product.price.amount).toBeGreaterThanOrEqual(1000)
      expect(product.price.amount).toBeLessThanOrEqual(2000)
    }
  })

  it("фильтрует по наличию; фильтр согласован со счетчиком фасета", async () => {
    const inStock = await catalog("?in_stock=true&limit=100")
    expect(inStock.body.pagination.total).toBe(10)

    const outOfStock = await catalog("?in_stock=false&limit=100")
    expect(outOfStock.body.pagination.total).toBe(4)

    // Счетчик фасета in_stock = результату одноименного фильтра (disjunctive).
    const base = await catalog("?limit=1")
    const stockOptions = optionsOf(facet(base.body, "in_stock"))
    expect(stockOptions.find((option) => option.value === "true")?.count).toBe(10)
    expect(stockOptions.find((option) => option.value === "false")?.count).toBe(4)
  })

  it("OR внутри одной характеристики", async () => {
    const { body } = await catalog(
      `?filter[brand]=${encodeURIComponent("deep-sea,urban-basic")}&limit=100`
    )

    expect(body.pagination.total).toBe(6)
    const handles = body.products.map((product) => product.handle).sort()
    expect(handles).toEqual(
      [
        "futbolka-kraken",
        "futbolka-prostaya",
        "stikerpak-more",
        "sumka-shopper",
        "sumka-shopper-eko",
        "svitshot-atlantika",
      ].sort()
    )
  })

  it("AND между разными характеристиками", async () => {
    const both = await catalog("?filter[brand]=medusa-originals&filter[eco]=true&limit=100")
    expect(both.body.pagination.total).toBe(4)

    const none = await catalog("?filter[brand]=deep-sea&filter[eco]=true&limit=100")
    expect(none.body.pagination.total).toBe(0)
    expect(none.body.products).toEqual([])
  })
})

describe("Store API каталога: критический сценарий комбинации вариантов", () => {
  it("цвет + размер + наличие одного варианта не находят товар с комбинацией только у отсутствующего варианта", async () => {
    // Футболка «Медуза»: Чёрный/S и Белый/M в наличии, Чёрный/M — НЕТ.
    // Лонгслив «Медуза»: Чёрный/S в наличии, Чёрный/M — НЕТ.
    const critical = await catalog(
      `?filter[color]=${enc("Чёрный")}&filter[size]=M&in_stock=true&limit=100`
    )

    expect(critical.body.pagination.total).toBe(0)
    expect(critical.body.products).toEqual([])
  })

  it("та же комбинация без фильтра наличия находит оба товара", async () => {
    const { body } = await catalog(
      `?filter[color]=${enc("Чёрный")}&filter[size]=M&limit=100`
    )

    expect(body.pagination.total).toBe(2)
    expect(body.products.map((product) => product.handle).sort()).toEqual([
      "futbolka-meduza",
      "longsliv-meduza",
    ])
  })
})

describe("Store API каталога: пересчет фасетов", () => {
  it("фасет размера пересчитывается disjunctively (без собственного фильтра)", async () => {
    // Активны color=Чёрный И size=M: фасет size считается по черным товарам
    // без учета собственного фильтра, чтобы соседние значения оставались.
    const { body } = await catalog(
      `?filter[color]=${enc("Чёрный")}&filter[size]=M&limit=1`
    )

    const sizeOptions = optionsOf(facet(body, "size"))
    const sizeM = sizeOptions.find((option) => option.value === "M")
    const sizeS = sizeOptions.find((option) => option.value === "S")

    expect(sizeM?.selected).toBe(true)
    expect(sizeM?.count).toBe(2)
    expect(sizeS?.count).toBe(2)

    // Фасет color: выбранное значение доступно для снятия фильтра.
    const colorOptions = optionsOf(facet(body, "color"))
    expect(
      colorOptions.find((option) => option.value === "Чёрный")?.selected
    ).toBe(true)
  })

  it("фасет бренда пересчитывается с учетом фильтра другой характеристики", async () => {
    // Активен фильтр color=Чёрный: фасет brand показывает только бренды
    // черных товаров, с точными счетчиками уникальных товаров.
    const { body } = await catalog(`?filter[color]=${enc("Чёрный")}&limit=1`)

    const brandOptions = optionsOf(facet(body, "brand"))
    expect(brandOptions.length).toBeGreaterThan(0)
    const brandSum = brandOptions.reduce((sum, option) => sum + option.count, 0)
    expect(brandSum).toBe(body.pagination.total)

    const byCode = new Map(brandOptions.map((option) => [option.value, option.count]))
    // Черные товары: футболка «Медуза» и лонгслив (medusa-originals),
    // шоппер «Эко» (urban-basic). У «Кракена» цвета нет вовсе.
    expect(byCode.get("medusa-originals")).toBe(2)
    expect(byCode.get("urban-basic")).toBe(1)
    expect(byCode.get("deep-sea")).toBeUndefined()
  })
})

describe("Store API каталога: сортировка и пагинация", () => {
  it("сортирует по цене; страницы не пересекаются и не дублируют товары", async () => {
    const first = await catalog("?sort=price_asc&limit=5&offset=0")
    const second = await catalog("?sort=price_asc&limit=5&offset=5")
    const third = await catalog("?sort=price_asc&limit=5&offset=10")

    expect(first.body.products).toHaveLength(5)
    expect(second.body.products).toHaveLength(5)
    expect(third.body.products).toHaveLength(2)
    expect(first.body.pagination.total).toBe(TOTAL_PRODUCTS)
    expect(first.body.pagination.hasMore).toBe(true)
    expect(third.body.pagination.hasMore).toBe(false)

    // Цены не убывают внутри страницы.
    const prices = [...first.body.products, ...second.body.products, ...third.body.products]
      .map((product) => product.price.amount)
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]!)
    }
    expect(prices[0]).toBe(390)

    // Нет пересечений товаров между страницами.
    const ids = [
      ...first.body.products,
      ...second.body.products,
      ...third.body.products,
    ].map((product) => product.id)
    expect(new Set(ids).size).toBe(TOTAL_PRODUCTS)
  })

  it("сортирует по убыванию цены", async () => {
    const { body } = await catalog("?sort=price_desc&limit=5")
    const prices = body.products.map((product) => product.price.amount)
    expect(prices[0]).toBe(4590)
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]!)
    }
  })

  it("сортирует по новизне", async () => {
    const { body } = await catalog("?sort=newest&limit=12")
    // Демо-товары этапа 3 созданы позже этапа 1 — они первые
    // (порядок между ними не фиксируется: созданы одним батчем).
    const newest = new Set([body.products[0]?.handle, body.products[1]?.handle])
    expect(newest).toEqual(new Set(["longsliv-meduza", "sumka-shopper-eko"]))
  })
})

describe("Store API каталога: пустая выдача и ошибки валидации", () => {
  it("пустая выдача: корректный контракт без товаров", async () => {
    const { status, body } = await apiGet<CatalogResponse>(
      `/store/search?q=${enc("осьминогблаблаблаxyz")}`
    )

    expect(status).toBe(200)
    expect(body.products).toEqual([])
    expect(body.pagination.total).toBe(0)
    expect(body.pagination.hasMore).toBe(false)
    expect(body.facets).toBeDefined()
  })

  it("400 для limit=abc", async () => {
    const { status, body } = await apiGet<CatalogErrorResponse>("/store/catalog?limit=abc")
    expect(status).toBe(400)
    expect(body.type).toBe("invalid_query")
  })

  it("400 для неизвестной характеристики в фильтре", async () => {
    const { status, body } = await apiGet<CatalogErrorResponse>(
      "/store/catalog?filter[no_such_attribute]=x"
    )
    expect(status).toBe(400)
    expect(body.type).toBe("invalid_query")
    expect(body.message).toContain("no_such_attribute")
  })

  it("400 для неизвестной сортировки", async () => {
    const { status } = await apiGet("/store/catalog?sort=bogus")
    expect(status).toBe(400)
  })

  it("400 для price_min > price_max", async () => {
    const { status } = await apiGet("/store/catalog?price_min=5000&price_max=100")
    expect(status).toBe(400)
  })

  it("400 для /store/search без параметра q", async () => {
    const { status, body } = await apiGet<CatalogErrorResponse>("/store/search")
    expect(status).toBe(400)
    expect(body.message).toContain("q")
  })

  it("400 для неизвестного региона", async () => {
    const { status } = await apiGet("/store/catalog?region_id=reg_missing")
    expect(status).toBe(400)
  })
})

describe("Store API каталога: авторизация", () => {
  it("400 без publishable API key", async () => {
    const response = await fetch(`${baseUrl}/store/catalog?limit=1`, {
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await response.json()) as { type?: string }

    expect(response.status).toBe(400)
    expect(body.type).toBe("not_allowed")
  })
})

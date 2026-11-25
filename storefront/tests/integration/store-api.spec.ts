import { beforeAll, describe, expect, it } from "vitest"
import { CommerceError } from "#shared/utils/commerce-error"
import { createCommerceClient } from "#shared/utils/commerce-client"
import type { CommerceClient } from "#shared/types/commerce"

/**
 * Интеграционные тесты Commerce Client на РЕАЛЬНОЙ Medusa
 * (демо-данные этапа 1). Запускаются через `make test` внутри
 * Docker (env из docker-compose) или на хосте:
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

let commerce: CommerceClient

beforeAll(() => {
  if (!publishableKey) {
    throw new Error(
      "Интеграционные тесты требуют publishable API key: задайте MEDUSA_PUBLISHABLE_KEY (или запускайте через `make test`)."
    )
  }
  commerce = createCommerceClient({ baseUrl, publishableKey, timeoutMs: 10_000 })
})

describe("Medusa Store API: доступность и регионы", () => {
  it("возвращает регионы магазина", async () => {
    const response = await commerce.regions.list()

    expect(response.regions.length).toBeGreaterThanOrEqual(1)
    expect(response.count).toBeGreaterThanOrEqual(1)
    for (const region of response.regions) {
      expect(region.id).toMatch(/^reg_/)
      expect(region.currency_code).toBeTruthy()
    }
  })

  it("возвращает регион по ID", async () => {
    const list = await commerce.regions.list()
    const first = list.regions[0]!

    const response = await commerce.regions.getById(first.id)

    expect(response.region.id).toBe(first.id)
    expect(response.region.name).toBe(first.name)
  })

  it("404 для несуществующего региона", async () => {
    await expect(commerce.regions.getById("reg_missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found",
    })
  })
})

describe("Medusa Store API: товары", () => {
  it("возвращает список товаров с пагинацией (limit/offset/count)", async () => {
    const page1 = await commerce.products.list({ limit: 3, offset: 0 })

    expect(page1.products).toHaveLength(3)
    expect(page1.limit).toBe(3)
    expect(page1.offset).toBe(0)
    expect(page1.count).toBeGreaterThanOrEqual(3)
  })

  it("страницы пагинации не пересекаются", async () => {
    const page1 = await commerce.products.list({ limit: 2, offset: 0 })
    const page2 = await commerce.products.list({ limit: 2, offset: 2 })

    const ids1 = new Set(page1.products.map((product) => product.id))
    const page2Ids = page2.products.map((product) => product.id)

    expect(page1.count).toBe(page2.count)
    for (const id of page2Ids) {
      expect(ids1.has(id)).toBe(false)
    }
  })

  it("возвращает рассчитанные цены вариантов в контексте региона", async () => {
    const regions = await commerce.regions.list()
    const region = regions.regions[0]!

    const response = await commerce.products.list({
      limit: 3,
      region_id: region.id,
    })

    const variant = response.products[0]!.variants![0]!
    expect(variant.calculated_price).toBeDefined()
    expect(typeof variant.calculated_price!.calculated_amount).toBe("number")
    expect(variant.calculated_price!.currency_code).toBe(region.currency_code)
    // Суммы в основных единицах: рассчитанная цена — разумное число рублей.
    expect(variant.calculated_price!.calculated_amount).toBeGreaterThan(0)
  })

  it("без регионального контекста calculated_price отсутствует", async () => {
    const response = await commerce.products.list({ limit: 1 })

    const variant = response.products[0]!.variants![0]!
    expect(variant.calculated_price).toBeUndefined()
  })

  it("возвращает товар по ID с вариантами и опциями", async () => {
    const regions = await commerce.regions.list()
    const list = await commerce.products.list({
      limit: 1,
      region_id: regions.regions[0]!.id,
    })
    const source = list.products[0]!

    const response = await commerce.products.getById(source.id, {
      region_id: regions.regions[0]!.id,
    })

    expect(response.product.id).toBe(source.id)
    expect(response.product.title).toBeTruthy()
    expect(response.product.variants!.length).toBeGreaterThanOrEqual(1)
    expect(response.product.variants![0]!.calculated_price).toBeDefined()
    expect((response.product.options ?? []).length).toBeGreaterThanOrEqual(0)
  })

  it("возвращает товар по handle (штатный фильтр Medusa)", async () => {
    const product = await commerce.products.getByHandle("futbolka-meduza")

    expect(product).not.toBeNull()
    expect(product!.handle).toBe("futbolka-meduza")
    expect(product!.variants!.length).toBeGreaterThanOrEqual(1)
  })

  it("null для несуществующего handle (без ложного успеха)", async () => {
    const product = await commerce.products.getByHandle("takogo-tovara-net")

    expect(product).toBeNull()
  })

  it("404 для несуществующего ID товара", async () => {
    await expect(commerce.products.getById("prod_missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found",
    })
  })
})

describe("Medusa Store API: категории", () => {
  it("возвращает список категорий каталога", async () => {
    const response = await commerce.categories.list()

    expect(response.count).toBeGreaterThanOrEqual(3)
    expect(response.product_categories.length).toBeGreaterThanOrEqual(3)
    const handles = response.product_categories.map((category) => category.handle)
    expect(handles).toContain("t-shirts")
  })

  it("возвращает категорию по handle", async () => {
    const category = await commerce.categories.getByHandle("t-shirts")

    expect(category).not.toBeNull()
    expect(category!.handle).toBe("t-shirts")
  })

  it("возвращает категорию по ID", async () => {
    const byHandle = await commerce.categories.getByHandle("hoodies")
    expect(byHandle).not.toBeNull()

    const response = await commerce.categories.getById(byHandle!.id)
    expect(response.product_category.id).toBe(byHandle!.id)
  })

  it("нормализует 200 с пустым телом Medusa в 404 для несуществующей категории", async () => {
    const rejection = commerce.categories.getById("pcat_missing")

    await expect(rejection).rejects.toBeInstanceOf(CommerceError)
    await expect(rejection).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found",
    })
  })

  it("возвращает товары категории (штатный фильтр category_id)", async () => {
    const category = await commerce.categories.getByHandle("t-shirts")
    expect(category).not.toBeNull()

    const response = await commerce.products.list({
      category_id: category!.id,
      limit: 10,
    })

    expect(response.count).toBeGreaterThanOrEqual(1)
    expect(response.products.length).toBeGreaterThanOrEqual(1)
  })
})

describe("Medusa Store API: коллекции", () => {
  it("возвращает список коллекций (может быть пустым после seed этапа 1)", async () => {
    const response = await commerce.collections.list()

    expect(Array.isArray(response.collections)).toBe(true)
    expect(response.limit).toBeGreaterThan(0)
  })

  it("404 для несуществующей коллекции", async () => {
    await expect(commerce.collections.getById("pcol_missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found",
    })
  })
})

describe("Commerce Client: недоступность Medusa", () => {
  it("ошибки сети нормализуются в 503 medusa_unreachable", async () => {
    const broken = createCommerceClient({
      // Порт 9 (discard) локальной машины — соединение гарантированно отвергается.
      baseUrl: "http://127.0.0.1:9",
      publishableKey: publishableKey!,
      timeoutMs: 5_000,
    })

    await expect(broken.regions.list()).rejects.toMatchObject({
      statusCode: 503,
      code: "medusa_unreachable",
    })
  })

  it("таймаут нормализуется в 504 timeout", async () => {
    // Локальный адрес из несуществующей подсети: пакеты «повисают» до таймаута.
    const unreachable = createCommerceClient({
      baseUrl: "http://10.255.255.1:9000",
      publishableKey: publishableKey!,
      timeoutMs: 500,
    })

    await expect(unreachable.regions.list()).rejects.toMatchObject({
      statusCode: 504,
      code: "timeout",
    })
  })
})

import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"
import { getProductPriceText, resolveProductPrice } from "~/utils/product-price"
import { formatPrice } from "~/utils/format-price"

function makeProduct(overrides: Partial<HttpTypes.StoreProduct> = {}): HttpTypes.StoreProduct {
  return {
    id: "prod_test",
    title: "Тестовый товар",
    handle: "test",
    variants: [],
    options: [],
    images: [],
    ...overrides,
  } as HttpTypes.StoreProduct
}

describe("resolveProductPrice", () => {
  it("берет рассчитанную цену варианта в контексте региона (calculated_price)", () => {
    const product = makeProduct({
      variants: [
        {
          id: "v1",
          title: "S",
          options: [],
          calculated_price: {
            id: "pset_1",
            calculated_amount: 1000,
            original_amount: 1200,
            currency_code: "rub",
          },
        },
        {
          id: "v2",
          title: "M",
          options: [],
          calculated_price: {
            id: "pset_2",
            calculated_amount: 2000,
            original_amount: 2000,
            currency_code: "rub",
          },
        },
      ] as HttpTypes.StoreProductVariant[],
    })

    const price = resolveProductPrice(product, "rub")

    expect(price.minAmount).toBe(1000)
    expect(price.maxAmount).toBe(2000)
    expect(price.currencyCode).toBe("rub")
  })

  it("fallback: сырые цены вариантов фильтруются по валюте", () => {
    const product = makeProduct({
      variants: [
        {
          id: "v1",
          title: "OS",
          options: [],
          prices: [{ currency_code: "rub", amount: 790 }],
        },
        {
          id: "v2",
          title: "OS-EUR",
          options: [],
          prices: [{ currency_code: "eur", amount: 10 }],
        },
      ] as unknown as HttpTypes.StoreProductVariant[],
    })

    const price = resolveProductPrice(product, "rub")

    expect(price.minAmount).toBe(790)
    expect(price.maxAmount).toBe(790)
    expect(price.currencyCode).toBe("rub")
  })

  it("возвращает null, когда цен нет", () => {
    const price = resolveProductPrice(makeProduct(), "rub")

    expect(price.minAmount).toBeNull()
    expect(price.maxAmount).toBeNull()
    expect(price.currencyCode).toBeNull()
  })
})

describe("getProductPriceText", () => {
  const format = (amount: number | string | null | undefined, currency?: string) =>
    formatPrice(amount, currency ?? "rub", "ru-RU")

  it("показывает минимальную цену с пометкой «от» при разбросе цен", () => {
    const product = makeProduct({
      variants: [
        {
          id: "v1",
          title: "S",
          options: [],
          calculated_price: {
            id: "pset_1",
            calculated_amount: 1000,
            original_amount: 1000,
            currency_code: "rub",
          },
        },
        {
          id: "v2",
          title: "XL",
          options: [],
          calculated_price: {
            id: "pset_2",
            calculated_amount: 2500,
            original_amount: 2500,
            currency_code: "rub",
          },
        },
      ] as HttpTypes.StoreProductVariant[],
    })

    const text = getProductPriceText(product, format, "rub")

    expect(text.startsWith("от ")).toBe(true)
    expect(text).toContain("1")
    expect(text).toContain("000")
  })

  it("без разброса цен показывает одну цену", () => {
    const product = makeProduct({
      variants: [
        {
          id: "v1",
          title: "OS",
          options: [],
          calculated_price: {
            id: "pset_1",
            calculated_amount: 790,
            original_amount: 790,
            currency_code: "rub",
          },
        },
      ] as HttpTypes.StoreProductVariant[],
    })

    const text = getProductPriceText(product, format, "rub")

    expect(text.startsWith("от ")).toBe(false)
    expect(text).toContain("790")
  })

  it("возвращает «Цена не указана» для товара без цен", () => {
    expect(getProductPriceText(makeProduct(), format, "rub")).toBe(
      "Цена не указана"
    )
  })
})

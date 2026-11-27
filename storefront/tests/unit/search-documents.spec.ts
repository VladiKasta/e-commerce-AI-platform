import { beforeAll, describe, expect, it } from "vitest"

/**
 * Unit-тесты трансформации товаров в поисковые документы (этап 3.6.3).
 *
 * Тестируют РЕАЛЬНЫЙ код индексатора: buildProductDocuments экспортирован
 * из backend/src/search/products.ts (с этапа 3.6.2 — переиспользование без
 * второго индексатора). Исходники backend доступны тест-контейнеру
 * read-only через volume `.:/server/repo` (docker-compose.yml); импорт —
 * динамический, потому что абсолютный путь монтирования существует только
 * внутри контейнера (`make test`). Типы фикстур локальные — структура
 * соответствует RemoteQuery-строкам, которые читает индексатор.
 */

type SearchDocument = Record<string, unknown>

type BuildFn = (
  products: unknown[],
  attributesById: Map<string, unknown>,
  valuesByProduct: Map<string, unknown[]>
) => SearchDocument[]

const backendRoot =
  process.env.BACKEND_SRC_DIR ?? "/server/repo/backend/src"

let buildProductDocuments: BuildFn

beforeAll(async () => {
  // products.ts регистрирует индекс на import (штатный механизм
  // defineSearchIndex → global.MedusaModule). Вне приложения реестра нет —
  // подменяем no-op-ом: трансформация не зависит от регистрации.
  const globals = globalThis as {
    MedusaModule?: { setSearchIndex: (definition: unknown, path?: string) => void }
  }
  globals.MedusaModule ??= { setSearchIndex: () => undefined }

  const module = (await import(
    `${backendRoot}/search/products`
  )) as unknown as { buildProductDocuments: BuildFn }
  buildProductDocuments = module.buildProductDocuments
})

// ── Фикстуры: структура RemoteQuery-строк индексатора ────────────────────

type PriceRow = {
  currency_code: string
  amount?: number | string | null
  price_list_id?: string | null
  price_list?: { id?: string } | null
}

type VariantRow = {
  id: string
  sku?: string | null
  title?: string | null
  manage_inventory?: boolean
  allow_backorder?: boolean
  options?: Array<{ value: string; option?: { title?: string } | null }>
  prices?: PriceRow[]
  inventory?: Array<{
    stocked_quantity?: number
    reserved_quantity?: number
  }>
}

type ProductRow = {
  id: string
  handle: string
  title: string
  description?: string | null
  status?: string
  thumbnail?: string | null
  created_at?: string
  updated_at?: string
  categories?: Array<{ id: string; handle: string }>
  collection?: { id: string; handle: string } | null
  sales_channels?: Array<{ id: string }>
  variants?: VariantRow[]
}

type AttributeRow = {
  id: string
  code: string
  data_type: string
  option_title?: string | null
}

type ValueRow = {
  product_id: string
  variant_id?: string | null
  attribute_id: string
  text_value?: string | null
  numeric_value?: number | null
  boolean_value?: boolean | null
}

const RUB = "rub"
const EUR = "eur"

function variant(overrides: Partial<VariantRow> & { id: string }): VariantRow {
  return {
    manage_inventory: true,
    allow_backorder: false,
    prices: [{ currency_code: RUB, amount: 1000 }],
    ...overrides,
  }
}

function product(overrides: Partial<ProductRow> & { id: string }): ProductRow {
  return {
    handle: `handle-${overrides.id}`,
    title: `Товар ${overrides.id}`,
    status: "published",
    created_at: "2026-11-26T09:00:00.000Z",
    updated_at: "2026-11-27T09:00:00.000Z",
    categories: [{ id: "cat_1", handle: "cat-one" }],
    collection: { id: "col_1", handle: "col-one" },
    sales_channels: [{ id: "sc_1" }],
    variants: [],
    ...overrides,
  }
}

function build(
  products: ProductRow[],
  attributes: AttributeRow[] = [],
  values: ValueRow[] = []
): SearchDocument[] {
  const attributesById = new Map<string, AttributeRow>(
    attributes.map((attribute) => [attribute.id, attribute])
  )
  const valuesByProduct = new Map<string, ValueRow[]>()
  for (const row of values) {
    const bucket = valuesByProduct.get(row.product_id) ?? []
    bucket.push(row)
    valuesByProduct.set(row.product_id, bucket)
  }
  return buildProductDocuments(products, attributesById, valuesByProduct)
}

// ── 1. Трансформация товаров и вариантов в документы ─────────────────────

describe("Трансформация товаров в поисковые документы", () => {
  it("неопубликованный товар не попадает в индекс", () => {
    const documents = build([
      product({ id: "p_draft", status: "draft", variants: [variant({ id: "v1" })] }),
    ])
    expect(documents).toHaveLength(0)
  })

  it("документ = вариант × валюта; id = `${variant_id}__${currency_code}`", () => {
    const documents = build([
      product({
        id: "p_multi",
        variants: [
          variant({ id: "v_rub", prices: [{ currency_code: RUB, amount: 1490 }] }),
        ],
      }),
    ])
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      id: `v_rub__${RUB}`,
      product_id: "p_multi",
      variant_id: "v_rub",
      currency_code: RUB,
      price: 1490,
    })
  })

  it("вариант без цен не порождает документов", () => {
    const documents = build([
      product({
        id: "p_free",
        variants: [
          variant({ id: "v_no_price", prices: [] }),
          variant({ id: "v_priced", prices: [{ currency_code: RUB, amount: 500 }] }),
        ],
      }),
    ])
    expect(documents.map((doc) => doc.id)).toEqual([`v_priced__${RUB}`])
  })

  it("даты сериализуются unix-секундами", () => {
    const documents = build([
      product({ id: "p_dates", variants: [variant({ id: "v1" })] }),
    ])
    expect(documents[0]).toMatchObject({
      created_at: Math.floor(new Date("2026-11-26T09:00:00.000Z").getTime() / 1000),
      updated_at: Math.floor(new Date("2026-11-27T09:00:00.000Z").getTime() / 1000),
    })
  })

  it("категории, коллекция и канал продаж попадают в документ", () => {
    const documents = build([
      product({ id: "p_links", variants: [variant({ id: "v1" })] }),
    ])
    expect(documents[0]).toMatchObject({
      handle: "handle-p_links",
      title: "Товар p_links",
      category_ids: ["cat_1"],
      category_handles: ["cat-one"],
      collection_ids: ["col_1"],
      collection_handles: ["col-one"],
      sales_channel_ids: ["sc_1"],
    })
  })
})

// ── 2. Характеристики всех поддерживаемых типов ───────────────────────────

describe("Характеристики всех типов данных", () => {
  const A = {
    text: "attr_text",
    number: "attr_number",
    boolean: "attr_boolean",
    select: "attr_select",
    multi: "attr_multi",
    optionSize: "attr_size",
  }

  const attributes: AttributeRow[] = [
    { id: A.text, code: "note", data_type: "text" },
    { id: A.number, code: "rating", data_type: "number" },
    { id: A.boolean, code: "eco", data_type: "boolean" },
    { id: A.select, code: "brand", data_type: "select" },
    { id: A.multi, code: "material", data_type: "multi_select" },
    { id: A.optionSize, code: "size", data_type: "select", option_title: "Размер" },
  ]

  const values: ValueRow[] = [
    { product_id: "p_attr", attribute_id: A.text, text_value: "заметка" },
    { product_id: "p_attr", attribute_id: A.number, numeric_value: 4.7 },
    { product_id: "p_attr", attribute_id: A.boolean, boolean_value: true },
    { product_id: "p_attr", attribute_id: A.select, text_value: "deep-sea" },
    { product_id: "p_attr", attribute_id: A.multi, text_value: "cotton" },
    { product_id: "p_attr", attribute_id: A.multi, text_value: "polyester" },
    {
      product_id: "p_attr",
      variant_id: "v_l",
      attribute_id: A.optionSize,
      text_value: null,
      numeric_value: null,
      boolean_value: null,
    },
  ]

  it("text/number/boolean/select — скаляры, multi_select — массив", () => {
    const documents = build(
      [product({ id: "p_attr", variants: [variant({ id: "v_l" })] })],
      attributes,
      values
    )
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      attributes: expect.objectContaining({
        note: "заметка",
        rating: 4.7,
        eco: true,
        brand: "deep-sea",
        material: ["cotton", "polyester"],
      }),
    })
  })

  it("характеристика значения null не попадает в документ", () => {
    const documents = build(
      [product({ id: "p_null", variants: [variant({ id: "v1" })] })],
      [{ id: "attr_empty", code: "empty", data_type: "text" }],
      [
        {
          product_id: "p_null",
          attribute_id: "attr_empty",
          text_value: null,
          numeric_value: null,
          boolean_value: null,
        },
      ]
    )
    expect((documents[0]?.attributes as Record<string, unknown>)["empty"])
      .toBeUndefined()
  })

  it("одна характеристика = одно значение → скаляр, не массив", () => {
    const documents = build(
      [product({ id: "p_single", variants: [variant({ id: "v1" })] })],
      attributes,
      [{ product_id: "p_single", attribute_id: A.multi, text_value: "cotton" }]
    )
    expect((documents[0]?.attributes as Record<string, unknown>)["material"])
      .toBe("cotton")
  })

  it("значение уровня варианта попадает только в его документы", () => {
    const documents = build(
      [
        product({
          id: "p_scoped",
          variants: [variant({ id: "v_a" }), variant({ id: "v_b" })],
        }),
      ],
      [{ id: "attr_c", code: "color", data_type: "text" }],
      [
        {
          product_id: "p_scoped",
          variant_id: "v_a",
          attribute_id: "attr_c",
          text_value: "Чёрный",
        },
      ]
    )
    expect(documents).toHaveLength(2)
    const byVariant = new Map(
      documents.map((doc) => [String(doc.variant_id), doc.attributes])
    )
    expect((byVariant.get("v_a") as Record<string, unknown>)["color"])
      .toBe("Чёрный")
    expect((byVariant.get("v_b") as Record<string, unknown>)["color"])
      .toBeUndefined()
  })

  it("option_title выводит цвет/размер варианта из штатных опций", () => {
    const documents = build(
      [
        product({
          id: "p_opts",
          variants: [
            variant({
              id: "v_opts",
              options: [
                { value: "M", option: { title: "Размер" } },
                { value: "Чёрный", option: { title: "Цвет" } },
              ],
            }),
          ],
        }),
      ],
      [{ id: "attr_size", code: "size", data_type: "select", option_title: "Размер" }]
    )
    expect((documents[0]?.attributes as Record<string, unknown>)["size"])
      .toBe("M")
  })

  it("назначенное вручную значение варианта приоритетнее штатной опции", () => {
    const documents = build(
      [
        product({
          id: "p_manual",
          variants: [
            variant({
              id: "v_manual",
              options: [{ value: "M", option: { title: "Размер" } }],
            }),
          ],
        }),
      ],
      [{ id: "attr_size", code: "size", data_type: "select", option_title: "Размер" }],
      [
        {
          product_id: "p_manual",
          variant_id: "v_manual",
          attribute_id: "attr_size",
          text_value: "XXL",
        },
      ]
    )
    expect((documents[0]?.attributes as Record<string, unknown>)["size"])
      .toBe("XXL")
  })
})

// ── 3. Цены, валюты, наличие и комбинации вариантов ──────────────────────

describe("Цены, валюты и наличие", () => {
  it("несколько валют → отдельный документ на валюту с минимальной ценой", () => {
    const documents = build([
      product({
        id: "p_cur",
        variants: [
          variant({
            id: "v_cur",
            prices: [
              { currency_code: RUB, amount: 2000 },
              { currency_code: RUB, amount: 1500 },
              { currency_code: EUR, amount: 15 },
            ],
          }),
        ],
      }),
    ])
    expect(documents).toHaveLength(2)
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `v_cur__${RUB}`, price: 1500 }),
        expect.objectContaining({ id: `v_cur__${EUR}`, price: 15 }),
      ])
    )
  })

  it("прайс-листы (приватные цены) исключаются из индекса", () => {
    const documents = build([
      product({
        id: "p_pl",
        variants: [
          variant({
            id: "v_pl",
            prices: [
              { currency_code: RUB, amount: 1000 },
              { currency_code: RUB, amount: 800, price_list_id: "pl_1" },
            ],
          }),
        ],
      }),
    ])
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({ price: 1000 })
  })

  it("наличие: физический остаток минус резерв", () => {
    const documents = build([
      product({
        id: "p_stock",
        variants: [
          variant({
            id: "v_in",
            inventory: [{ stocked_quantity: 10, reserved_quantity: 3 }],
          }),
          variant({
            id: "v_out",
            inventory: [{ stocked_quantity: 2, reserved_quantity: 5 }],
          }),
          variant({
            id: "v_zero",
            inventory: [{ stocked_quantity: 0, reserved_quantity: 0 }],
          }),
        ],
      }),
    ])
    const inStock = new Map(
      documents.map((doc) => [String(doc.variant_id), doc.in_stock])
    )
    expect(inStock.get("v_in")).toBe(true)
    expect(inStock.get("v_out")).toBe(false)
    expect(inStock.get("v_zero")).toBe(false)
  })

  it("наличие: manage_inventory=false и allow_backorder=true всегда в наличии", () => {
    const documents = build([
      product({
        id: "p_flags",
        variants: [
          variant({
            id: "v_no_mgmt",
            manage_inventory: false,
            inventory: [{ stocked_quantity: 0, reserved_quantity: 0 }],
          }),
          variant({
            id: "v_backorder",
            allow_backorder: true,
            inventory: [{ stocked_quantity: 0, reserved_quantity: 0 }],
          }),
        ],
      }),
    ])
    const inStock = new Map(
      documents.map((doc) => [String(doc.variant_id), doc.in_stock])
    )
    expect(inStock.get("v_no_mgmt")).toBe(true)
    expect(inStock.get("v_backorder")).toBe(true)
  })

  it("комбинация: разные варианты с разными ценами и валютами", () => {
    const documents = build([
      product({
        id: "p_combo",
        variants: [
          variant({
            id: "v_s",
            sku: "SKU-S",
            prices: [
              { currency_code: RUB, amount: 990 },
              { currency_code: EUR, amount: 9 },
            ],
          }),
          variant({ id: "v_m", prices: [{ currency_code: RUB, amount: 1090 }] }),
        ],
      }),
    ])
    expect(documents).toHaveLength(3)
    expect(documents.map((doc) => doc.id).sort()).toEqual([
      `v_m__${RUB}`,
      `v_s__${EUR}`,
      `v_s__${RUB}`,
    ])
    for (const doc of documents) {
      expect(doc).toMatchObject({
        product_id: "p_combo",
        status: "published",
      })
    }
  })

  it("трансформация идемпотентна: те же входные данные → тот же документ", () => {
    const products = [
      product({
        id: "p_idem",
        variants: [variant({ id: "v_i", prices: [{ currency_code: RUB, amount: 750 }] })],
      }),
    ]
    const attributes: AttributeRow[] = [
      { id: "attr_b", code: "brand", data_type: "select" },
    ]
    const values: ValueRow[] = [
      { product_id: "p_idem", attribute_id: "attr_b", text_value: "urban-basic" },
    ]
    const first = JSON.stringify(build(products, attributes, values))
    const second = JSON.stringify(build(products, attributes, values))
    expect(second).toBe(first)
  })
})

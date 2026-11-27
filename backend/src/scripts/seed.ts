import path from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import type { IProductModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductOptionsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import { readEnvFile, upsertEnvValue } from "./lib/update-env-file"

/**
 * Идемпотентный seed-скрипт eCommerce Starter Kit.
 *
 * Создает (только если еще не созданы):
 *  - магазин с валютой из STORE_CURRENCY и названием из STORE_NAME;
 *  - канал продаж и связанный с ним publishable API key;
 *  - регион России с тестовым платежным провайдером `pp_system_default`;
 *  - налоговый регион;
 *  - склад, fulfillment set, зону доставки и тестовые способы доставки;
 *  - при SEED_DEMO_DATA=true — категории, демо-товары и остатки.
 *
 * Повторный запуск никогда не создает дубликаты и не удаляет существующие
 * данные. Все коммерческие данные создаются через штатные workflows Medusa,
 * без прямой записи в таблицы PostgreSQL.
 *
 * Запуск: `medusa exec ./src/scripts/seed.ts` (см. `pnpm seed`).
 */

const SALES_CHANNEL_NAME = "Веб-витрина"
const REGION_NAME = "Россия"
const STOCK_LOCATION_NAME = "Основной склад"
const FULFILLMENT_SET_NAME = "Доставка основного склада"
const SERVICE_ZONE_NAME = "Россия"
const API_KEY_TITLE = "Storefront"

const COUNTRY = "ru"

// ВАЖНО: Medusa хранит цены в основных денежных единицах (не в копейках):
// значение 1490 — это 1490 ₽.
const PRICE_TSHIRT = 1490
const PRICE_TSHIRT_WHITE = 1540
const PRICE_TSHIRT_XL = 1590
const PRICE_KRAKEN = 1290
const PRICE_HOODIE = 3990
const PRICE_SWEATSHIRT = 3490
const PRICE_WARM_HOODIE = 4590
const PRICE_SHOPPER = 1590
const PRICE_BOTTLE = 1190

const SIZES = ["S", "M", "L", "XL"]

type DemoVariant = {
  title: string
  sku: string
  options: Record<string, string>
  price: number
}

type DemoProduct = {
  title: string
  handle: string
  description: string
  categoryHandle: string
  images?: string[]
  variants: DemoVariant[]
}

function buildOneSizeVariant(sku: string, price: number): DemoVariant {
  return {
    title: "OS",
    sku,
    options: { "Размер": "OS" },
    price,
  }
}

// В Medusa v2.23 каждый товар обязан иметь хотя бы одну опцию
// (validateProductInputStep в createProductsWorkflow), поэтому одиночные
// варианты используют опцию «Размер» со значением «OS».

const DEMO_CATEGORIES = [
  { name: "Футболки", handle: "t-shirts", is_active: true, is_internal: false },
  { name: "Худи и свитшоты", handle: "hoodies", is_active: true, is_internal: false },
  { name: "Аксессуары", handle: "accessories", is_active: true, is_internal: false },
]

const TSHIRT_COLOR_CODES = [
  { value: "Чёрный", code: "BLK", price: PRICE_TSHIRT },
  { value: "Белый", code: "WHT", price: PRICE_TSHIRT_WHITE },
]

function buildSizeVariants(
  skuPrefix: string,
  price: number,
  sizes: string[] = SIZES
): DemoVariant[] {
  return sizes.map((size) => ({
    title: size,
    sku: `${skuPrefix}-${size}`,
    options: { "Размер": size },
    price,
  }))
}

function buildTshirtVariants(): DemoVariant[] {
  const variants: DemoVariant[] = []

  for (const color of TSHIRT_COLOR_CODES) {
    for (const size of SIZES) {
      variants.push({
        title: `${size} / ${color.value}`,
        sku: `TEE-MED-${size}-${color.code}`,
        options: { "Размер": size, "Цвет": color.value },
        price: size === "XL" ? PRICE_TSHIRT_XL : color.price,
      })
    }
  }

  return variants
}

const DEMO_PRODUCTS: DemoProduct[] = [
  {
    title: "Футболка «Медуза»",
    handle: "futbolka-meduza",
    description:
      "Базовая футболка из плотного хлопка с принтом «Медуза». Устойчива к стирке, не теряет форму.",
    categoryHandle: "t-shirts",
    images: [
      "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
      "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-back.png",
    ],
    variants: buildTshirtVariants(),
  },  {
    title: "Футболка «Кракен»",
    handle: "futbolka-kraken",
    description:
      "Футболка с минималистичным принтом «Кракен». Прямой крой, 100% хлопок.",
    categoryHandle: "t-shirts",
    images: [
      "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-white-front.png",
    ],
    variants: buildSizeVariants("TEE-KRAKEN", PRICE_KRAKEN),
  },
  {
    title: "Футболка «Простая»",
    handle: "futbolka-prostaya",
    description:
      "Однотонная футболка без принта. Идеальная база для любого образа.",
    categoryHandle: "t-shirts",
    variants: [buildOneSizeVariant("TEE-BASIC-OS", 990)],
  },
  {
    title: "Худи «Медуза»",
    handle: "hudi-meduza",
    description:
      "Теплое худи с начесом и вышивкой «Медуза». Капюшон на кулиске, карман-кенгуру.",
    categoryHandle: "hoodies",
    images: [
      "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-front.png",
      "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-back.png",
    ],
    variants: buildSizeVariants("HOODIE-MED", PRICE_HOODIE),
  },
  {
    title: "Свитшот «Атлантика»",
    handle: "svitshot-atlantika",
    description:
      "Свитшот в морской стилистике из футера. Приятный к телу, держит тепло.",
    categoryHandle: "hoodies",
    images: [
      "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-front.png",
    ],
    variants: buildSizeVariants("SWEAT-ATL", PRICE_SWEATSHIRT),
  },
  {
    title: "Худи «Полярное»",
    handle: "hudi-polyarnoe",
    description: "Утепленное худи для холодного сезона. Высокий ворот, плотный трикотаж.",
    categoryHandle: "hoodies",
    variants: buildSizeVariants("HOODIE-POL", PRICE_WARM_HOODIE, ["S", "M", "L"]),
  },
  {
    title: "Сумка-шоппер",
    handle: "sumka-shopper",
    description: "Плотная сумка-шоппер с длинными ручками. Выдерживает до 10 кг.",
    categoryHandle: "accessories",
    variants: [buildOneSizeVariant("SHOPPER-OS", PRICE_SHOPPER)],
  },
  {
    title: "Кружка «Медуза»",
    handle: "kruzhka-meduza",
    description: "Керамическая кружка 350 мл с логотипом «Медуза». Можно в микроволновку и посудомойку.",
    categoryHandle: "accessories",
    variants: [buildOneSizeVariant("MUG-MEDUSA", 790)],
  },
  {
    title: "Стикерпак «Море»",
    handle: "stikerpak-more",
    description: "Набор из 12 виниловых наклеек морской тематики. Водостойкие.",
    categoryHandle: "accessories",
    variants: [buildOneSizeVariant("STICKER-PACK", 390)],
  },
  {
    title: "Бутылка для воды 750 мл",
    handle: "butylka-dlya-vody",
    description: "Спортивная бутылка из нержавеющей стали. Держит холод до 24 часов.",
    categoryHandle: "accessories",
    variants: [buildOneSizeVariant("BOTTLE-750", PRICE_BOTTLE)],
  },
  {
    // Демонстрирует пересекающиеся значения характеристик (бренд и цвет
    // совпадают с футболкой «Медуза») и ручную характеристику цвета для
    // товара без штатной опции «Цвет».
    title: "Сумка-шоппер «Эко»",
    handle: "sumka-shopper-eko",
    description:
      "Эко-шоппер из органического хлопка с принтом «Медуза». Выдерживает до 15 кг.",
    categoryHandle: "accessories",
    variants: [buildOneSizeVariant("SHOPPER-EKO-OS", 1890)],
  },
  {
    // Второй товар с вариантом без наличия: Чёрный/S в наличии,
    // Чёрный/M — нет (пересечение с критическим сценарием).
    title: "Лонгслив «Медуза»",
    handle: "longsliv-meduza",
    description:
      "Лонгслив с длинным рукавом из органического хлопка. Принт «Медуза», свободный крой.",
    categoryHandle: "t-shirts",
    variants: [
      {
        title: "S / Чёрный",
        sku: "LONG-MED-S-BLK",
        options: { "Размер": "S", "Цвет": "Чёрный" },
        price: 1990,
      },
      {
        title: "M / Чёрный",
        sku: "LONG-MED-M-BLK",
        options: { "Размер": "M", "Цвет": "Чёрный" },
        price: 2190,
      },
    ],
  },
]

/**
 * Остатки демо-товаров по SKU. null — не создавать запись об остатке вовсе.
 * По умолчанию товары получают 10 единиц на складе.
 *
 * TEE-MED-M-BLK — КРИТИЧЕСКИЙ СЦЕНАРИЙ фасетной фильтрации (этап 3):
 * у футболки «Медуза» вариант Чёрный/M отсутствует, а Чёрный/S и Белый/M —
 * в наличии. Фильтр (цвет=Чёрный И размер=M И в наличии) НЕ должен находить
 * этот товар: комбинация существует только у отсутствующего варианта.
 */
const INVENTORY_OVERRIDES: Record<string, number | null> = {
  "MUG-MEDUSA": 0,
  "BOTTLE-750": null,
  "STICKER-PACK": 100,
  "TEE-MED-M-BLK": 0,
  "LONG-MED-M-BLK": 0,
}

const DEFAULT_STOCKED_QUANTITY = 10

// ── Демонстрационные характеристики (этап 3) ──────────────────────────────
//
// Универсальные характеристики каталога: тип данных и способ отображения
// фильтра независимы. Цвет и размер получают значения из штатных опций
// Medusa (option_title), остальные назначаются товарам вручную.

type DemoAttribute = {
  code: string
  name: string
  data_type: "text" | "number" | "boolean" | "select" | "multi_select"
  filter_type: "checkbox" | "select" | "radio" | "range" | "color" | "boolean"
  unit?: string
  searchable?: boolean
  position: number
  option_title?: string
  options?: Array<{ value: string; label: string }>
}

const DEMO_ATTRIBUTES: DemoAttribute[] = [
  {
    code: "brand",
    name: "Бренд",
    data_type: "select",
    filter_type: "checkbox",
    position: 1,
    options: [
      { value: "medusa-originals", label: "Medusa Originals" },
      { value: "deep-sea", label: "Deep Sea" },
      { value: "north-polar", label: "North Polar" },
      { value: "urban-basic", label: "Urban Basic" },
    ],
  },
  {
    code: "color",
    name: "Цвет",
    data_type: "select",
    filter_type: "color",
    position: 2,
    // Значения выводятся из штатной опции товара «Цвет».
    option_title: "Цвет",
    options: [
      { value: "Чёрный", label: "Чёрный" },
      { value: "Белый", label: "Белый" },
    ],
  },
  {
    code: "size",
    name: "Размер",
    data_type: "select",
    filter_type: "checkbox",
    position: 3,
    option_title: "Размер",
    options: ["S", "M", "L", "XL", "OS"].map((value) => ({ value, label: value })),
  },
  {
    code: "material",
    name: "Материал",
    data_type: "multi_select",
    filter_type: "checkbox",
    position: 4,
    options: [
      { value: "cotton", label: "Хлопок" },
      { value: "organic-cotton", label: "Органический хлопок" },
      { value: "polyester", label: "Полиэстер" },
      { value: "ceramics", label: "Керамика" },
      { value: "steel", label: "Нержавеющая сталь" },
    ],
  },
  {
    code: "rating",
    name: "Рейтинг",
    data_type: "number",
    filter_type: "range",
    position: 5,
  },
  {
    code: "eco",
    name: "Эко-линейка",
    data_type: "boolean",
    filter_type: "boolean",
    position: 6,
  },
]

/** Наборы характеристик по категориям: определяют состав фильтров каталога. */
const DEMO_CATEGORY_ATTRIBUTES: Record<string, string[]> = {
  "t-shirts": ["brand", "color", "size", "material", "rating", "eco"],
  hoodies: ["brand", "color", "size", "material", "eco"],
  accessories: ["brand", "color", "material", "rating", "eco"],
}

/**
 * Значения характеристик по товарам (handle → атрибут → значение/значения).
 * Цвет для товаров со штатной опцией «Цвет» НЕ назначается вручную —
 * индексатор выводит его из опции варианта.
 */
const DEMO_PRODUCT_ATTRIBUTES: Record<string, Record<string, string | number | boolean | string[]>> = {
  "futbolka-meduza": {
    brand: "medusa-originals",
    material: ["cotton"],
    rating: 4.6,
    eco: true,
  },
  "futbolka-kraken": { brand: "deep-sea", material: ["polyester"], rating: 4.1, eco: false },
  "futbolka-prostaya": { brand: "urban-basic", material: ["cotton"], rating: 4.3, eco: false },
  "hudi-meduza": {
    brand: "medusa-originals",
    material: ["cotton", "polyester"],
    rating: 4.8,
    eco: true,
  },
  "svitshot-atlantika": { brand: "deep-sea", material: ["polyester"], rating: 4.2, eco: false },
  "hudi-polyarnoe": {
    brand: "north-polar",
    material: ["polyester", "cotton"],
    rating: 4.7,
    eco: true,
  },
  "sumka-shopper": { brand: "urban-basic", material: ["cotton"], rating: 4.0, eco: false },
  "kruzhka-meduza": { brand: "medusa-originals", material: ["ceramics"], rating: 4.9, eco: true },
  "stikerpak-more": { brand: "deep-sea", material: ["polyester"], rating: 3.9, eco: false },
  "butylka-dlya-vody": { brand: "north-polar", material: ["steel"], rating: 4.4, eco: true },
  // Цвет назначается вручную: у шоппера нет штатной опции «Цвет».
  "sumka-shopper-eko": {
    brand: "urban-basic",
    color: "Чёрный",
    material: ["organic-cotton"],
    rating: 4.2,
    eco: true,
  },
  "longsliv-meduza": {
    brand: "medusa-originals",
    material: ["organic-cotton"],
    rating: 4.5,
    eco: true,
  },
}

/** Коллекции демо-каталога. */
const DEMO_COLLECTIONS = [
  { handle: "medusy", name: "Медузы" },
  { handle: "eko", name: "Эко-линейка" },
]

const COLLECTION_MEMBERS: Record<string, string[]> = {
  medusy: ["futbolka-meduza", "hudi-meduza", "kruzhka-meduza", "longsliv-meduza"],
  eko: [
    "futbolka-meduza",
    "hudi-meduza",
    "hudi-polyarnoe",
    "kruzhka-meduza",
    "butylka-dlya-vody",
    "longsliv-meduza",
    "sumka-shopper-eko",
  ],
}

/**
 * Синхронизирует publishable API key с корневым .env, чтобы storefront
 * получил ключ через переменную MEDUSA_PUBLISHABLE_KEY.
 */
function syncPublishableKeyWithEnvFile(
  logger: { info: (message: string) => void; warn: (message: string) => void },
  token: string
): void {
  // medusa exec запускается из директории backend/, поэтому корень
  // репозитория (и .env) — на один уровень выше.
  const envPath = path.resolve(process.cwd(), "..", ".env")
  const envValues = readEnvFile(envPath)

  if (envValues?.MEDUSA_PUBLISHABLE_KEY === token) {
    logger.info("MEDUSA_PUBLISHABLE_KEY уже актуален в .env")
    return
  }

  const result = upsertEnvValue(envPath, "MEDUSA_PUBLISHABLE_KEY", token)

  if (result === "missing-file") {
    logger.warn(
      `Файл .env не найден. Запишите ключ вручную: MEDUSA_PUBLISHABLE_KEY=${token}`
    )
    return
  }

  logger.info(
    result === "appended"
      ? `MEDUSA_PUBLISHABLE_KEY добавлен в корневой .env: ${token}`
      : `MEDUSA_PUBLISHABLE_KEY обновлен в корневом .env: ${token}`
  )
}

export default async function seedStore({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const storeService = container.resolve(Modules.STORE)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const regionService = container.resolve(Modules.REGION)
  const taxService = container.resolve(Modules.TAX)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const productService = container.resolve(Modules.PRODUCT)
  const inventoryService = container.resolve(Modules.INVENTORY)

  const storeName = process.env.STORE_NAME || "Demo Store"
  const currency = (process.env.STORE_CURRENCY || "rub").toLowerCase()
  const seedDemoData = (process.env.SEED_DEMO_DATA || "true") === "true"

  logger.info("Seeding sales channel...")
  const existingChannels = await salesChannelService.listSalesChannels()
  let salesChannel = existingChannels.find(
    (channel) => channel.name === SALES_CHANNEL_NAME
  )

  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          {
            name: SALES_CHANNEL_NAME,
            description: "Канал продаж веб-витрины",
          },
        ],
      },
    })
    salesChannel = result[0]
  }

  logger.info("Seeding stock location...")
  const existingLocations = await stockLocationService.listStockLocations({
    name: STOCK_LOCATION_NAME,
  })
  let stockLocation = existingLocations[0]
  let locationIsNew = false

  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION_NAME,
            address: {
              city: "Москва",
              country_code: COUNTRY,
              address_1: "",
            },
          },
        ],
      },
    })
    stockLocation = result[0]
    locationIsNew = true
  }

  logger.info("Seeding store...")
  const existingStores = await storeService.listStores()
  let store = existingStores[0]

  if (!store) {
    const { result } = await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: storeName,
            supported_currencies: [
              { currency_code: currency, is_default: true },
            ],
            default_sales_channel_id: salesChannel.id,
            default_location_id: stockLocation.id,
          },
        ],
      },
    })
    store = result[0]
  }

  // Приводим настройки магазина к целевому состоянию на каждом запуске —
  // операция идемпотентна.
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: storeName,
        default_sales_channel_id: salesChannel.id,
        default_location_id: stockLocation.id,
        supported_currencies: [{ currency_code: currency, is_default: true }],
      },
    },
  })

  logger.info("Seeding region...")
  const existingRegions = await regionService.listRegions()
  let region = existingRegions.find((item) => item.name === REGION_NAME)

  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: currency,
            countries: [COUNTRY],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
    region = result[0]
  }

  logger.info("Seeding tax region...")
  const existingTaxRegions = await taxService.listTaxRegions()

  if (
    !existingTaxRegions.some(
      (taxRegion) => taxRegion.country_code?.toLowerCase() === COUNTRY
    )
  ) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: COUNTRY, provider_id: "tp_system" }],
    })
  }

  // Профиль доставки создается миграцией Medusa, но подстраховываемся.
  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  let shippingProfileId: string | undefined = shippingProfiles[0]?.id

  if (!shippingProfileId) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: {
        data: [
          {
            name: "Профиль доставки по умолчанию",
            type: "default",
          },
        ],
      },
    })
    shippingProfileId = result[0]?.id
  }

  if (locationIsNew) {
    logger.info("Seeding fulfillment setup...")

    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: "manual_manual",
      },
    })

    const fulfillmentSet = await fulfillmentService.createFulfillmentSets({
      name: FULFILLMENT_SET_NAME,
      type: "shipping",
      service_zones: [
        {
          name: SERVICE_ZONE_NAME,
          geo_zones: [{ country_code: COUNTRY, type: "country" }],
        },
      ],
    })

    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_set_id: fulfillmentSet.id,
      },
    })

    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "Стандартная доставка",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: fulfillmentSet.service_zones[0].id,
          shipping_profile_id: shippingProfileId,
          type: {
            label: "Стандартная",
            description: "Доставка в течение 3–5 дней.",
            code: "standard",
          },
          prices: [
            { region_id: region.id, amount: 500 },
            { currency_code: currency, amount: 500 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
        {
          name: "Экспресс-доставка",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: fulfillmentSet.service_zones[0].id,
          shipping_profile_id: shippingProfileId,
          type: {
            label: "Экспресс",
            description: "Доставка в течение 24 часов.",
            code: "express",
          },
          prices: [
            { region_id: region.id, amount: 990 },
            { currency_code: currency, amount: 990 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })

    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: stockLocation.id,
        add: [salesChannel.id],
      },
    })
  }

  logger.info("Seeding publishable API key...")
  const { data: publishableKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "sales_channels.id"],
    filters: { type: "publishable" },
  })

  type PublishableKeyRow = {
    id: string
    title: string
    token: string
    sales_channels?: Array<{ id: string } | null> | null
  }
  const publishableKeyRows = publishableKeys as PublishableKeyRow[]

  // Ключ витрины определяется однозначно; произвольные publishable-ключи
  // seed не выбирает и не изменяет. Порядок разрешения:
  //   1. Явно заданный ключ — токен MEDUSA_PUBLISHABLE_KEY из корневого
  //      .env (эту переменную seed сам поддерживает актуальной); явное
  //      указание оператора перевешивает признаки витрины.
  //   2. Единственный ключ, связанный с каналом «Веб-витрина».
  //   3. Несколько связанных ключей, из которых ровно один со служебным
  //      заголовком Storefront (ключ самого seed).
  //   4. Единственный ключ со служебным заголовком Storefront (если
  //      связанных с каналом нет).
  //   5. При неоднозначности — остановка с диагностикой (см. ниже);
  //      при отсутствии подходящих ключей — создание одного раза.
  const envPath = path.resolve(process.cwd(), "..", ".env")
  const explicitToken = readEnvFile(envPath)?.MEDUSA_PUBLISHABLE_KEY || undefined
  const explicitKey = explicitToken
    ? publishableKeyRows.find((key) => key.token === explicitToken)
    : undefined
  if (explicitToken && !explicitKey) {
    logger.warn(
      "MEDUSA_PUBLISHABLE_KEY из корневого .env не найден среди publishable-ключей — выбор по признакам витрины"
    )
  }

  const channelLinkedKeys = publishableKeyRows.filter((key) =>
    key.sales_channels?.some((channel) => channel?.id === salesChannel.id)
  )
  const titledKeys = publishableKeyRows.filter(
    (key) => key.title === API_KEY_TITLE
  )

  let publishableKey: PublishableKeyRow | undefined

  if (explicitKey) {
    publishableKey = explicitKey
  } else if (channelLinkedKeys.length === 1) {
    publishableKey = channelLinkedKeys[0]
  } else if (channelLinkedKeys.length > 1) {
    const linkedTitled = channelLinkedKeys.filter(
      (key) => key.title === API_KEY_TITLE
    )
    if (linkedTitled.length === 1) {
      publishableKey = linkedTitled[0]
    }
  } else if (titledKeys.length === 1) {
    publishableKey = titledKeys[0]
  }

  // Неоднозначность не решается «произвольным» ключом: выбор среди
  // подходящих изменил бы конфигурацию ключа, принадлежность которого
  // витрине не подтверждена. Остановка до любых изменений связей.
  if (
    !publishableKey &&
    (channelLinkedKeys.length > 1 || titledKeys.length > 1)
  ) {
    const describe = (key: PublishableKeyRow): string => {
      const channels = (key.sales_channels ?? [])
        .map((channel) => channel?.id)
        .filter((id): id is string => Boolean(id))
        .join(", ")
      return `- ${key.id} («${key.title}», каналы: ${channels || "нет"})`
    }
    const candidates = [...new Set([...channelLinkedKeys, ...titledKeys])]
      .map(describe)
      .join("\n")
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Не удалось однозначно определить publishable-ключ витрины: найдено несколько подходящих ключей.\n${candidates}\nУкажите нужный ключ явно: запишите его полный токен (pk_…) в MEDUSA_PUBLISHABLE_KEY корневого .env и перезапустите make seed. Существующие ключи не изменены.`
    )
  }

  if (!publishableKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: API_KEY_TITLE,
            type: "publishable",
            created_by: "",
          },
        ],
      },
    })
    publishableKey = result[0]
  }

  const linkedChannelIds =
    publishableKey.sales_channels
      ?.map((channel) => channel?.id)
      .filter((id): id is string => Boolean(id)) ?? []

  // Ключ витрины должен быть связан только с каналом витрины: Medusa
  // требует явный sales_channel_id при создании корзины, если ключ
  // связан с несколькими каналами (аудит этапа 4.1). Сами каналы и их
  // связи с товарами/складами не затрагиваются.
  const addChannels = linkedChannelIds.includes(salesChannel.id)
    ? []
    : [salesChannel.id]
  const removeChannels = linkedChannelIds.filter((id) => id !== salesChannel.id)

  if (addChannels.length || removeChannels.length) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: publishableKey.id,
        ...(addChannels.length ? { add: addChannels } : {}),
        ...(removeChannels.length ? { remove: removeChannels } : {}),
      },
    })
  }

  syncPublishableKeyWithEnvFile(logger, publishableKey.token)

  if (!seedDemoData) {
    logger.info(
      "SEED_DEMO_DATA не равен true — пропускаю демо-каталог. Seed завершен."
    )
    return
  }

  logger.info("Seeding product categories...")
  const existingCategories = await productService.listProductCategories()
  const categoryByHandle = new Map(existingCategories.map((c) => [c.handle, c]))

  const missingCategories = DEMO_CATEGORIES.filter(
    (category) => !categoryByHandle.has(category.handle)
  )

  if (missingCategories.length) {
    await createProductCategoriesWorkflow(container).run({
      input: { product_categories: missingCategories },
    })
    // Перечитываем список после создания: результат workflow не
    // гарантированно содержит все поля DTO.
    const created = await productService.listProductCategories()
    for (const category of created) {
      categoryByHandle.set(category.handle, category)
    }
  }

  // Активируем существующие категории демо-каталога, если они неактивны.
  const categoriesToActivate = DEMO_CATEGORIES.map((c) => categoryByHandle.get(c.handle)).filter(
    (category): category is NonNullable<typeof category> =>
      !!category && !category.is_active
  )

  if (categoriesToActivate.length) {
    await productService.updateProductCategories(
      { id: categoriesToActivate.map((category) => category.id) },
      { is_active: true, is_internal: false }
    )
    for (const category of categoriesToActivate) {
      category.is_active = true
    }
  }

  logger.info("Seeding product options...")
  // В Medusa v2.23 опции товаров создаются на уровне магазина и переиспользуются
  // разными товарами.
  const requiredOptions = new Map<string, Set<string>>()

  for (const product of DEMO_PRODUCTS) {
    for (const variant of product.variants) {
      for (const [title, value] of Object.entries(variant.options)) {
        if (!requiredOptions.has(title)) {
          requiredOptions.set(title, new Set())
        }
        requiredOptions.get(title)!.add(value)
      }
    }
  }

  const existingOptions = await productService.listProductOptions(undefined, {
    relations: ["values"],
  })
  const optionByTitle = new Map(existingOptions.map((o) => [o.title, o]))

  const missingOptions = [...requiredOptions.entries()]
    .filter(([title]) => !optionByTitle.has(title))
    .map(([title, values]) => ({ title, values: [...values] }))

  if (missingOptions.length) {
    await createProductOptionsWorkflow(container).run({
      input: { product_options: missingOptions },
    })
    // Перечитываем список после создания: результат workflow не
    // гарантированно содержит все поля DTO.
    const created = await productService.listProductOptions(undefined, {
      relations: ["values"],
    })
    for (const option of created) {
      optionByTitle.set(option.title, option)
    }
  }

  // Дополняем существующие опции недостающими значениями
  // (например, «OS» у опции «Размер»).
  for (const [title, requiredValues] of requiredOptions.entries()) {
    const option = optionByTitle.get(title)
    if (!option) {
      continue
    }

    const currentValues = (option.values ?? []).map((value) => value.value)
    const missingValues = [...requiredValues].filter(
      (value) => !currentValues.includes(value)
    )

    if (missingValues.length) {
      const updated = await productService.updateProductOptions(option.id, {
        values: [...currentValues, ...missingValues],
      })
      optionByTitle.set(title, updated)
    }
  }

  logger.info("Seeding demo products...")
  const existingProducts = await productService.listProducts()
  const existingHandles = new Set(existingProducts.map((p) => p.handle))
  const productsToCreate = DEMO_PRODUCTS.filter(
    (product) => !existingHandles.has(product.handle)
  )

  if (productsToCreate.length) {
    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: productsToCreate.map((product) => ({
          title: product.title,
          handle: product.handle,
          description: product.description,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfileId,
          category_ids: [categoryByHandle.get(product.categoryHandle)!.id],
          images: product.images?.map((url) => ({ url })),
          options: [
            ...new Set(
              product.variants.flatMap((variant) => Object.keys(variant.options))
            ),
          ].map((title) => ({ id: optionByTitle.get(title)!.id })),
          variants: product.variants.map((variant) => ({
            title: variant.title,
            sku: variant.sku,
            options: variant.options,
            prices: [{ amount: variant.price, currency_code: currency }],
          })),
          sales_channels: [{ id: salesChannel.id }],
        })),
      },
    })
    logger.info(`Создано демо-товаров: ${result.length}`)
  } else {
    logger.info("Демо-товары уже существуют — пропускаю создание")
  }

  logger.info("Seeding inventory levels...")
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
  })

  const existingLevels = await inventoryService.listInventoryLevels({
    location_id: stockLocation.id,
  })
  const itemsWithLevel = new Set(
    existingLevels.map((level) => level.inventory_item_id)
  )

  const levelsToCreate: {
    location_id: string
    inventory_item_id: string
    stocked_quantity: number
  }[] = []

  for (const item of inventoryItems) {
    if (itemsWithLevel.has(item.id) || !item.sku) {
      continue
    }

    if (item.sku in INVENTORY_OVERRIDES) {
      const override = INVENTORY_OVERRIDES[item.sku]

      if (override === null) {
        continue
      }

      levelsToCreate.push({
        location_id: stockLocation.id,
        inventory_item_id: item.id,
        stocked_quantity: override,
      })
    } else {
      levelsToCreate.push({
        location_id: stockLocation.id,
        inventory_item_id: item.id,
        stocked_quantity: DEFAULT_STOCKED_QUANTITY,
      })
    }
  }

  if (levelsToCreate.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: levelsToCreate },
    })
    logger.info(`Создано записей об остатках: ${levelsToCreate.length}`)
  } else {
    logger.info("Остатки уже настроены — пропускаю")
  }

  // Демонстрационные товары с нулевым остатком (критический сценарий
  // фасетной фильтрации) приводятся к целевому состоянию и на повторных
  // запусках: seed «дозалечивает» конфигурацию (см. этап 1).
  const criticalSkus = Object.entries(INVENTORY_OVERRIDES)
    .filter(([, quantity]) => quantity === 0)
    .map(([sku]) => sku)

  const criticalUpdates: {
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
  }[] = []
  for (const item of inventoryItems) {
    if (!item.sku || !criticalSkus.includes(item.sku)) {
      continue
    }
    for (const level of existingLevels) {
      if (level.inventory_item_id === item.id && level.stocked_quantity !== 0) {
        criticalUpdates.push({
          inventory_item_id: item.id,
          location_id: level.location_id,
          stocked_quantity: 0,
        })
      }
    }
  }

  if (criticalUpdates.length) {
    await inventoryService.updateInventoryLevels(criticalUpdates)
    logger.info(
      `Обнулены остатки критических вариантов: ${criticalUpdates.length} (демонстрация фильтрации по наличию)`
    )
  }

  await seedCatalogAttributes({ container, logger, productService, categoryByHandle })

  logger.info("Seed завершен.")
}

/**
 * Идемпотентный seed демонстрационных характеристик, их значений и коллекций
 * (этап 3). Все операции проверяют существование данных перед созданием.
 */
async function seedCatalogAttributes({
  container,
  logger,
  productService,
  categoryByHandle,
}: {
  container: Parameters<typeof seedStore>[0]["container"]
  logger: { info: (message: string) => void; warn: (message: string) => void }
  productService: IProductModuleService
  categoryByHandle: Map<string, { id: string; handle: string }>
}): Promise<void> {
  const attributeService = container.resolve("catalog_attributes")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { updateProductsWorkflow } = await import("@medusajs/medusa/core-flows")

  type AttributeRow = { id: string; code: string }
  type OptionRow = { attribute_id: string; value: string }
  type ProductRow = {
    id: string
    handle: string
    collection_id?: string | null
    variants: Array<{ id: string; sku: string | null }>
  }

  logger.info("Seeding catalog attributes...")
  const existingAttributes = (await attributeService.listAttributes()) as AttributeRow[]
  const attributeByCode = new Map(existingAttributes.map((row) => [row.code, row]))

  const missingAttributes = DEMO_ATTRIBUTES.filter(
    (attribute) => !attributeByCode.has(attribute.code)
  )

  if (missingAttributes.length) {
    await attributeService.createAttributes(
      missingAttributes.map((attribute) => ({
        code: attribute.code,
        name: attribute.name,
        data_type: attribute.data_type,
        filter_type: attribute.filter_type,
        unit: attribute.unit ?? null,
        filterable: true,
        searchable: attribute.searchable ?? true,
        position: attribute.position,
        option_title: attribute.option_title ?? null,
      }))
    )
    for (const created of (await attributeService.listAttributes()) as AttributeRow[]) {
      attributeByCode.set(created.code, created)
    }
  }

  logger.info("Seeding attribute options...")
  const existingOptions = (await attributeService.listAttributeOptions()) as OptionRow[]
  const optionKey = (attributeId: string, value: string): string => `${attributeId}__${value}`
  const existingOptionKeys = new Set(
    existingOptions.map((row) => optionKey(row.attribute_id, row.value))
  )

  const optionsToCreate = DEMO_ATTRIBUTES.flatMap((attribute) => {
    const attributeRow = attributeByCode.get(attribute.code)
    if (!attributeRow || !attribute.options?.length) {
      return []
    }
    return attribute.options
      .filter((option) => !existingOptionKeys.has(optionKey(attributeRow.id, option.value)))
      .map((option, index) => ({
        attribute_id: attributeRow.id,
        value: option.value,
        label: option.label,
        position: index + 1,
      }))
  })

  if (optionsToCreate.length) {
    await attributeService.createAttributeOptions(optionsToCreate)
  }

  logger.info("Seeding category attribute bindings...")
  const existingBindings = (await attributeService.listCategoryAttributes()) as Array<{
    category_id: string
    attribute_id: string
  }>
  const bindingKey = (categoryId: string, attributeId: string): string => `${categoryId}__${attributeId}`
  const existingBindingKeys = new Set(
    existingBindings.map((row) => bindingKey(row.category_id, row.attribute_id))
  )

  const bindingsToCreate: Array<{
    category_id: string
    attribute_id: string
    position: number
  }> = []
  for (const [categoryHandle, codes] of Object.entries(DEMO_CATEGORY_ATTRIBUTES)) {
    const category = categoryByHandle.get(categoryHandle)
    if (!category) {
      continue
    }
    codes.forEach((code, index) => {
      const attribute = attributeByCode.get(code)
      if (!attribute || existingBindingKeys.has(bindingKey(category.id, attribute.id))) {
        return
      }
      bindingsToCreate.push({
        category_id: category.id,
        attribute_id: attribute.id,
        position: index + 1,
      })
    })
  }

  if (bindingsToCreate.length) {
    await attributeService.createCategoryAttributes(bindingsToCreate)
  }

  logger.info("Seeding product attribute values...")
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "collection_id", "variants.id", "variants.sku"],
  })
  const products = data as unknown as ProductRow[]
  const productByHandle = new Map(products.map((row) => [row.handle, row]))

  const valuePayloads: Array<{
    product_id: string
    variant_id?: string | null
    attribute_id: string
    value: string | number | boolean
  }> = []

  for (const [handle, values] of Object.entries(DEMO_PRODUCT_ATTRIBUTES)) {
    const product = productByHandle.get(handle)
    if (!product) {
      continue
    }
    for (const [code, rawValue] of Object.entries(values)) {
      const attribute = attributeByCode.get(code)
      if (!attribute) {
        continue
      }
      const singleValues = Array.isArray(rawValue) ? rawValue : [rawValue]
      for (const value of singleValues) {
        valuePayloads.push({
          product_id: product.id,
          attribute_id: attribute.id,
          value,
        })
      }
    }
  }

  if (valuePayloads.length) {
    await attributeService.setProductAttributeValues(valuePayloads)
    logger.info(`Назначено значений характеристик: ${valuePayloads.length}`)
  }

  logger.info("Seeding collections...")
  const existingCollections = await productService.listProductCollections()
  const collectionByHandle = new Map(
    existingCollections.map((row) => [row.handle ?? "", row])
  )

  const missingCollections = DEMO_COLLECTIONS.filter(
    (collection) => !collectionByHandle.has(collection.handle)
  )

  if (missingCollections.length) {
    await productService.createProductCollections(
      missingCollections.map((collection) => ({
        handle: collection.handle,
        title: collection.name,
      }))
    )
    for (const created of await productService.listProductCollections()) {
      collectionByHandle.set(created.handle ?? "", created)
    }
  }

  logger.info("Linking products to collections...")
  for (const [collectionHandle, handles] of Object.entries(COLLECTION_MEMBERS)) {
    const collection = collectionByHandle.get(collectionHandle)
    if (!collection) {
      continue
    }

    const productsToLink = handles
      .map((handle) => productByHandle.get(handle))
      .filter((product): product is ProductRow => Boolean(product))
      .filter((product) => product.collection_id !== collection.id)

    if (productsToLink.length) {
      await updateProductsWorkflow(container).run({
        input: {
          products: productsToLink.map((product) => ({
            id: product.id,
            collection_id: collection.id,
          })),
        },
      })
      logger.info(`Коллекция «${collectionHandle}»: добавлено товаров ${productsToLink.length}`)
    }
  }
}

import path from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
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
  },
  {
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
]

/**
 * Остатки демо-товаров по SKU. null — не создавать запись об остатке вовсе.
 * По умолчанию товары получают 10 единиц на складе.
 */
const INVENTORY_OVERRIDES: Record<string, number | null> = {
  "MUG-MEDUSA": 0,
  "BOTTLE-750": null,
  "STICKER-PACK": 100,
}

const DEFAULT_STOCKED_QUANTITY = 10

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

  let publishableKey:
    | {
        id: string
        token: string
        sales_channels?: Array<{ id: string } | null> | null
      }
    | undefined = publishableKeys[0]

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

  if (!linkedChannelIds.includes(salesChannel.id)) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: publishableKey.id,
        add: [salesChannel.id],
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

  logger.info("Seed завершен.")
}

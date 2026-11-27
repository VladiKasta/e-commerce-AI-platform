import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Интеграционные тесты штатного Store API Medusa 2.23: полный цикл
 * корзина → checkout → заказ (этап 4.3). Запускаются на РЕАЛЬНОЙ Medusa
 * через `make test` (ADMIN_EMAIL/ADMIN_PASSWORD передаются только в
 * одноразовый тестовый контейнер, как в admin-attributes.spec.ts).
 *
 * Утверждения сверены с фактическим поведением живого API (probe
 * 27.11.2026), а не с предполагаемыми ответами. Данные изолированы:
 * каждая корзина создается тестом; тестовые промокоды создаются через
 * Admin API в beforeAll и удаляются в afterAll. Побочный эффект:
 * полного гостевого checkout создает 1 заказ (API удаления заказов в
 * Medusa нет — задокументировано в docs/PROGRESS.md) и резерв 3 единиц
 * демо-варианта STICKER-PACK (остаток 100 единиц, seed).
 *
 * Для complete используется вариант с запасом остатка (STICKER-PACK,
 * 100 единиц): complete создает инвентарные резервирования. Рабочие
 * остатки и существующие заказы тесты не изменяют и не удаляют.
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

// ── Типы ответов Store API (docs/api.md, маршруты 28–39) ──────────────

interface Address {
  first_name: string | null
  last_name: string | null
  address_1: string | null
  city: string | null
  country_code: string | null
  postal_code: string | null
}

interface CartAdjustment {
  code: string
  amount: number
}

interface CartItem {
  id: string
  title: string
  quantity: number
  unit_price: number
  requires_shipping: boolean
  subtotal?: number | null
  discount_total?: number | null
  total?: number | null
  adjustments?: CartAdjustment[] | null
}

interface CartPromotionLink {
  code: string
}

interface Cart {
  id: string
  region_id: string
  sales_channel_id: string
  currency_code: string
  email: string | null
  items: CartItem[] | null
  promotions: CartPromotionLink[] | null
  shipping_address?: Address | null
  subtotal: number
  item_subtotal: number
  discount_total: number
  shipping_total: number
  tax_total: number
  total: number
}

interface CartResponse {
  cart: Cart
}

interface ShippingOption {
  id: string
  name: string
  amount: number
  provider_id: string
}

interface PaymentCollection {
  id: string
  amount: number
  currency_code: string
  status?: string
  payment_sessions: Array<{
    id: string
    provider_id: string
    status: string
    amount: number
  }> | null
}

interface OrderItem {
  title: string
  quantity: number
  unit_price: number
  subtotal: number
  total: number
}

interface Order {
  id: string
  display_id: number
  status: string
  email: string | null
  currency_code: string
  payment_status?: string
  subtotal: number
  item_subtotal: number
  shipping_total: number
  discount_total: number
  tax_total: number
  total: number
  items: OrderItem[] | null
}

interface ErrorBody {
  type?: string
  code?: string
  message?: string
}

type ApiResult<T> = { status: number; body: T | null }

async function rawFetch<T>(
  path: string,
  init?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  }
): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...(init?.body !== undefined
      ? { body: JSON.stringify(init.body) }
      : {}),
  })
  const body = (await res.json().catch(() => null)) as T | null
  return { status: res.status, body }
}

function storeFetch<T>(
  path: string,
  init?: {
    method?: string
    body?: unknown
    key?: string | null
    /** 5.2.1: подтвержденное право на гостевой заказ (docs/api.md №52). */
    guestProof?: string
  }
): Promise<ApiResult<T>> {
  const key = init?.key === undefined ? publishableKey : init.key
  const headers: Record<string, string> =
    key === null ? {} : { "x-publishable-api-key": key }
  if (init?.guestProof) {
    headers["x-cart-id"] = init.guestProof
  }
  return rawFetch<T>(path, {
    method: init?.method,
    body: init?.body,
    headers,
  })
}

let token = ""

function adminFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<ApiResult<T>> {
  return rawFetch<T>(path, {
    method: init?.method,
    body: init?.body,
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ── Состояние сквозного сценария ──────────────────────────────────────

let regionId = ""
let variantId = ""
let variantUnitPrice = 0
let zeroStockVariantId = ""

let activePromoId = ""
let activePromoCode = ""
let draftPromoId = ""
let draftPromoCode = ""

// Основная корзина сквозного сценария
let cartId = ""
let lineItemId = ""

// Заказы, созданные этим прогоном (для очистки резервов в afterAll)
const createdOrderIds: string[] = []

// Заказ основного сценария
let orderId = ""
let orderDisplayId = 0

const EMAIL = "guest-4-3@example.com"

// Явные fields для серверных сумм уровня позиции: в дефолтном ответе
// Medusa item.subtotal/total/discount_total равны null (проверено probe).
const ITEM_TOTALS_FIELDS = encodeURIComponent(
  "+items.subtotal,+items.discount_total,+items.total,+items.adjustments"
)

async function createCart(): Promise<string> {
  const res = await storeFetch<CartResponse>("/store/carts", {
    method: "POST",
    body: { region_id: regionId },
  })
  if (res.status !== 200 || !res.body) {
    throw new Error(`Не удалось создать корзину: HTTP ${res.status}`)
  }
  return res.body.cart.id
}

beforeAll(async () => {
  if (!publishableKey) {
    throw new Error(
      "Интеграционные тесты требуют publishable API key: задайте MEDUSA_PUBLISHABLE_KEY (или запускайте через `make test`)."
    )
  }
  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Тесты корзины требуют ADMIN_EMAIL/ADMIN_PASSWORD (передаются через `make test`) — промокоды создаются и удаляются через Admin API."
    )
  }

  // Аутентификация администратора (промокоды теста)
  const auth = await rawFetch<{ token?: string }>("/auth/user/emailpass", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  })
  if (!auth.body?.token) {
    throw new Error(
      `Не удалось аутентифицировать администратора: HTTP ${auth.status}`
    )
  }
  token = auth.body.token

  // Регион магазина
  const regions = await storeFetch<{
    regions: Array<{ id: string }>
  }>("/store/regions")
  regionId = regions.body?.regions[0]?.id ?? ""
  if (!regionId) {
    throw new Error("В магазине нет регионов")
  }

  // Вариант с достаточным остатком (STICKER-PACK, 100 единиц) — используется
  // всеми завершениями: complete резервирует инвентарь.
  const products = await storeFetch<{
    products: Array<{
      variants: Array<{
        id: string
        sku: string | null
        calculated_price?: { calculated_amount: number }
      }>
    }>
  }>(
    `/store/products?handle=stikerpak-more&region_id=${regionId}` +
      `&fields=${encodeURIComponent("+*variants.calculated_price")}`
  )
  const stickerVariant = products.body?.products[0]?.variants.find(
    (variant) => variant.sku === "STICKER-PACK"
  )
  if (!stickerVariant?.id || !stickerVariant.calculated_price) {
    throw new Error("Демо-товар «Стикерпак «Море»» (STICKER-PACK) не найден")
  }
  variantId = stickerVariant.id
  variantUnitPrice = stickerVariant.calculated_price.calculated_amount

  // Вариант с нулевым остатком (критический сценарий seed)
  const tees = await storeFetch<{
    products: Array<{
      variants: Array<{ id: string; sku: string | null }>
    }>
  }>(
    `/store/products?handle=futbolka-meduza&region_id=${regionId}` +
      `&fields=${encodeURIComponent("+variants.sku")}`
  )
  const zeroStock = tees.body?.products[0]?.variants.find(
    (variant) => variant.sku === "TEE-MED-M-BLK"
  )
  if (!zeroStock?.id) {
    throw new Error("Демо-вариант TEE-MED-M-BLK (нулевой остаток) не найден")
  }
  zeroStockVariantId = zeroStock.id

  // Тестовые промокоды: активный (скидка применяется) и draft (не должен
  // применяться). Уникальные коди — тесты можно запускать повторно.
  const suffix = `${Date.now()}`
  activePromoCode = `TEST43A${suffix}`
  draftPromoCode = `TEST43D${suffix}`
  const applicationMethod = {
    type: "percentage",
    value: 10,
    target_type: "items",
    allocation: "each",
    max_quantity: 5,
  }

  const activePromo = await adminFetch<{
    promotion: { id: string }
  }>("/admin/promotions", {
    method: "POST",
    body: {
      code: activePromoCode,
      status: "active",
      type: "standard",
      application_method: applicationMethod,
    },
  })
  if (activePromo.status !== 200 && activePromo.status !== 201) {
    throw new Error(
      `Не удалось создать активный промокод: HTTP ${activePromo.status}`
    )
  }
  activePromoId = activePromo.body?.promotion.id ?? ""

  const draftPromo = await adminFetch<{
    promotion: { id: string }
  }>("/admin/promotions", {
    method: "POST",
    body: {
      code: draftPromoCode,
      type: "standard",
      application_method: applicationMethod,
    },
  })
  if (draftPromo.status !== 200 && draftPromo.status !== 201) {
    throw new Error(
      `Не удалось создать draft-промокод: HTTP ${draftPromo.status}`
    )
  }
  draftPromoId = draftPromo.body?.promotion.id ?? ""
}, 120_000)

afterAll(async () => {
  // Тестовые промокоды удаляются; чужие промоушены не затрагиваются.
  for (const id of [activePromoId, draftPromoId]) {
    if (id) {
      await adminFetch(`/admin/promotions/${id}`, { method: "DELETE" })
    }
  }

  // Восстановление доступного остатка: complete резервирует инвентарь,
  // и без очистки каждый прогон уменьшал бы доступный остаток демо-
  // варианта. Удаляются ТОЛЬКО резервирования заказов этого прогона;
  // резервирования чужих (в т.ч. предыдущих) заказов не затрагиваются.
  // Сами заказы удалить нельзя (API удаления заказов в Medusa нет) —
  // побочный эффект зафиксирован в docs/PROGRESS.md. Очистка best-effort:
  // ее сбой не должен ронять тесты.
  for (const createdOrderId of createdOrderIds) {
    try {
      const detail = await adminFetch<{
        order: { items: Array<{ id: string }> | null }
      }>(`/admin/orders/${createdOrderId}`)
      for (const item of detail.body?.order.items ?? []) {
        const found = await adminFetch<{
          reservations: Array<{ id: string }>
        }>(`/admin/reservations?line_item_id=${item.id}`)
        for (const reservation of found.body?.reservations ?? []) {
          await adminFetch(`/admin/reservations/${reservation.id}`, {
            method: "DELETE",
          })
        }
      }
    } catch {
      // Очистка не удалась — остаток уменьшен, эффект документирован
    }
  }
}, 60_000)

describe("Корзина: создание, получение и обновление", () => {
  it(
    "создание корзины без sales_channel_id: канал подставляется из publishable key",
    async () => {
      const res = await storeFetch<CartResponse>("/store/carts", {
        method: "POST",
        body: { region_id: regionId },
      })

      expect(res.status).toBe(200)
      const cart = res.body!.cart
      cartId = cart.id
      expect(cart.id).toMatch(/^cart_/)
      expect(cart.sales_channel_id).toMatch(/^sc_/)
      expect(cart.region_id).toBe(regionId)
      expect(cart.currency_code).toBe("rub")
      expect(cart.items).toEqual([])
      expect(cart.total).toBe(0)
    },
    20_000
  )

  it("получение корзины по id", async () => {
    const res = await storeFetch<CartResponse>(`/store/carts/${cartId}`)

    expect(res.status).toBe(200)
    const cart = res.body!.cart
    expect(cart.id).toBe(cartId)
    expect(cart.email).toBeNull()
    expect(cart.items).toEqual([])
    expect(cart.subtotal).toBe(0)
    expect(cart.total).toBe(0)
  })

  it("обновление корзины: email сохраняется", async () => {
    const res = await storeFetch<CartResponse>(`/store/carts/${cartId}`, {
      method: "POST",
      body: { email: EMAIL },
    })

    expect(res.status).toBe(200)
    expect(res.body!.cart.email).toBe(EMAIL)
  })

  it("сохранение контактного адреса доставки", async () => {
    const res = await storeFetch<CartResponse>(`/store/carts/${cartId}`, {
      method: "POST",
      body: {
        shipping_address: {
          first_name: "Иван",
          last_name: "Гость",
          address_1: "ул. Тестовая, 1",
          city: "Москва",
          country_code: "ru",
          postal_code: "101000",
        },
      },
    })

    expect(res.status).toBe(200)
    const address = res.body!.cart.shipping_address
    expect(address?.first_name).toBe("Иван")
    expect(address?.last_name).toBe("Гость")
    expect(address?.address_1).toBe("ул. Тестовая, 1")
    expect(address?.city).toBe("Москва")
    expect(address?.country_code).toBe("ru")
    expect(address?.postal_code).toBe("101000")
  })
})

describe("Позиции: добавление, количество, удаление и серверные цены", () => {
  it(
    "добавление варианта: цена назначается сервером и равна calculated_price каталога",
    async () => {
      const res = await storeFetch<CartResponse>(
        `/store/carts/${cartId}/line-items`,
        {
          method: "POST",
          body: { variant_id: variantId, quantity: 2 },
        }
      )

      expect(res.status).toBe(200)
      const cart = res.body!.cart
      const item = cart.items![0]!
      lineItemId = item.id
      expect(item.title).toBe("Стикерпак «Море»")
      expect(item.quantity).toBe(2)
      expect(item.requires_shipping).toBe(true)
      // Цена серверная: совпадает с рассчитанной ценой каталога
      expect(item.unit_price).toBe(variantUnitPrice)
      // Итоги серверные: 2 × 390 = 780
      expect(cart.item_subtotal).toBe(variantUnitPrice * 2)
      expect(cart.subtotal).toBe(variantUnitPrice * 2)
      expect(cart.discount_total).toBe(0)
      expect(cart.shipping_total).toBe(0)
      expect(cart.total).toBe(variantUnitPrice * 2)
    },
    20_000
  )

  it(
    "изменение количества пересчитывает серверные итоги",
    async () => {
      const res = await storeFetch<CartResponse>(
        `/store/carts/${cartId}/line-items/${lineItemId}`,
        { method: "POST", body: { quantity: 3 } }
      )

      expect(res.status).toBe(200)
      const cart = res.body!.cart
      expect(cart.items![0]!.quantity).toBe(3)
      expect(cart.item_subtotal).toBe(variantUnitPrice * 3)
      expect(cart.subtotal).toBe(variantUnitPrice * 3)
      expect(cart.total).toBe(variantUnitPrice * 3)
    },
    20_000
  )

  it(
    "удаление позиции возвращает parent-корзину с обнуленными итогами",
    async () => {
      // Отдельная корзина: основная продолжает сценарий к checkout.
      const isolatedCart = await createCart()
      await storeFetch<CartResponse>(
        `/store/carts/${isolatedCart}/line-items`,
        { method: "POST", body: { variant_id: variantId, quantity: 1 } }
      )
      const isolatedLineId = await lineItemOf(isolatedCart)

      const res = await storeFetch<{
        id: string
        object: string
        deleted: boolean
        parent: Cart
      }>(`/store/carts/${isolatedCart}/line-items/${isolatedLineId}`, {
        method: "DELETE",
      })

      expect(res.status).toBe(200)
      expect(res.body!.object).toBe("line-item")
      expect(res.body!.deleted).toBe(true)
      expect(res.body!.parent.id).toBe(isolatedCart)
      expect(res.body!.parent.total).toBe(0)
    },
    20_000
  )
})

// Вспомогательная функция вынесена после describe для читаемости сценария.
async function lineItemOf(cart: string): Promise<string> {
  const res = await storeFetch<CartResponse>(`/store/carts/${cart}`)
  const item = res.body?.cart.items?.[0]
  if (!item) {
    throw new Error(`В корзине ${cart} нет позиций`)
  }
  return item.id
}

describe("Промокоды", () => {
  it(
    "применение активного промокода: серверная скидка и adjustments",
    async () => {
      const res = await storeFetch<CartResponse>(
        `/store/carts/${cartId}/promotions?fields=${ITEM_TOTALS_FIELDS}`,
        { method: "POST", body: { promo_codes: [activePromoCode] } }
      )

      expect(res.status).toBe(200)
      const cart = res.body!.cart
      // Промоушен привязан к корзине
      expect(
        cart.promotions?.some((promo) => promo.code === activePromoCode)
      ).toBe(true)

      const item = cart.items![0]!
      const subtotal = variantUnitPrice * 3
      const discount = Math.round(subtotal * 0.1) // 10% на каждую единицу
      expect(item.subtotal).toBe(subtotal)
      expect(item.discount_total).toBe(discount)
      expect(item.total).toBe(subtotal - discount)
      expect(item.adjustments![0]!.code).toBe(activePromoCode)
      expect(item.adjustments![0]!.amount).toBe(discount)

      expect(cart.discount_total).toBe(discount)
      expect(cart.total).toBe(subtotal - discount)
    },
    20_000
  )

  it(
    "неактивный (draft) промокод принимается без скидки; несуществующий код — 400",
    async () => {
      const isolatedCart = await createCart()
      await storeFetch<CartResponse>(
        `/store/carts/${isolatedCart}/line-items`,
        { method: "POST", body: { variant_id: variantId, quantity: 1 } }
      )

      // draft-промоушен: 200, но не привязывается и скидку не дает
      const draft = await storeFetch<CartResponse>(
        `/store/carts/${isolatedCart}/promotions`,
        { method: "POST", body: { promo_codes: [draftPromoCode] } }
      )
      expect(draft.status).toBe(200)
      expect(draft.body!.cart.promotions ?? []).toEqual([])
      expect(draft.body!.cart.discount_total).toBe(0)
      expect(draft.body!.cart.total).toBe(variantUnitPrice)

      // Несуществующий код отклоняется
      const invalid = await storeFetch<ErrorBody>(
        `/store/carts/${isolatedCart}/promotions`,
        { method: "POST", body: { promo_codes: ["NO_SUCH_CODE_43"] } }
      )
      expect(invalid.status).toBe(400)
      expect(invalid.body?.type).toBe("invalid_data")
      expect(invalid.body?.message).toContain("is invalid")
    },
    20_000
  )

  it(
    "удаление активного промокода снимает скидку (идемпотентно)",
    async () => {
      const res = await storeFetch<CartResponse>(
        `/store/carts/${cartId}/promotions`,
        { method: "DELETE", body: { promo_codes: [activePromoCode] } }
      )

      expect(res.status).toBe(200)
      const cart = res.body!.cart
      expect(cart.promotions ?? []).toEqual([])
      expect(cart.discount_total).toBe(0)
      expect(cart.total).toBe(variantUnitPrice * 3)

      // Повторное снятие не примененного кода — 200 (идемпотентность)
      const again = await storeFetch<CartResponse>(
        `/store/carts/${cartId}/promotions`,
        { method: "DELETE", body: { promo_codes: [activePromoCode] } }
      )
      expect(again.status).toBe(200)
      expect(again.body!.cart.discount_total).toBe(0)
    },
    20_000
  )
})

describe("Доставка и платежи", () => {
  it(
    "список способов доставки корзины: seed-опции с ценами",
    async () => {
      const res = await storeFetch<{
        shipping_options: ShippingOption[]
      }>(`/store/shipping-options?cart_id=${cartId}`)

      expect(res.status).toBe(200)
      const options = res.body!.shipping_options
      expect(options.length).toBe(2)
      const byName = new Map(options.map((option) => [option.name, option]))
      expect(byName.get("Стандартная доставка")?.amount).toBe(500)
      expect(byName.get("Экспресс-доставка")?.amount).toBe(990)
      for (const option of options) {
        expect(option.provider_id).toBe("manual_manual")
        expect(option.id).toMatch(/^so_/)
      }
    },
    20_000
  )

  it(
    "выбор способа доставки пересчитывает totals (subtotal включает доставку)",
    async () => {
      const options = (
        await storeFetch<{ shipping_options: ShippingOption[] }>(
          `/store/shipping-options?cart_id=${cartId}`
        )
      ).body!.shipping_options
      const standard = options.find(
        (option) => option.name === "Стандартная доставка"
      )!

      const res = await storeFetch<CartResponse>(
        `/store/carts/${cartId}/shipping-methods`,
        { method: "POST", body: { option_id: standard.id } }
      )

      expect(res.status).toBe(200)
      const cart = res.body!.cart
      expect(cart.shipping_total).toBe(500)
      // Особенность Medusa: subtotal = item_subtotal + shipping_subtotal
      expect(cart.item_subtotal).toBe(variantUnitPrice * 3)
      expect(cart.subtotal).toBe(variantUnitPrice * 3 + 500)
      expect(cart.total).toBe(variantUnitPrice * 3 + 500)
    },
    20_000
  )

  it(
    "payment collection и payment session через pp_system_default",
    async () => {
      // Провайдер региона доступен из коробки
      const providers = await storeFetch<{
        payment_providers: Array<{ id: string; is_enabled: boolean }>
      }>(`/store/payment-providers?region_id=${regionId}`)
      expect(providers.status).toBe(200)
      const systemDefault = providers.body!.payment_providers.find(
        (provider) => provider.id === "pp_system_default"
      )
      expect(systemDefault?.is_enabled).toBe(true)

      // Payment collection: сумма равна total корзины
      const collection = await storeFetch<{
        payment_collection: PaymentCollection
      }>("/store/payment-collections", {
        method: "POST",
        body: { cart_id: cartId },
      })
      expect(collection.status).toBe(200)
      const pc = collection.body!.payment_collection
      const cartTotal = variantUnitPrice * 3 + 500
      expect(pc.amount).toBe(cartTotal)
      expect(pc.currency_code).toBe("rub")

      // Payment session системного провайдера — pending
      const session = await storeFetch<{
        payment_collection: PaymentCollection
      }>(`/store/payment-collections/${pc.id}/payment-sessions`, {
        method: "POST",
        body: { provider_id: "pp_system_default" },
      })
      expect(session.status).toBe(200)
      const created = session.body!.payment_collection.payment_sessions![0]!
      expect(created.provider_id).toBe("pp_system_default")
      expect(created.status).toBe("pending")
      expect(created.amount).toBe(cartTotal)
    },
    20_000
  )
})

describe("Полный гостевой checkout: complete → заказ", () => {
  it(
    "complete создает заказ с серверными ценами и составом",
    async () => {
      const res = await storeFetch<{ type: string; order: Order }>(
        `/store/carts/${cartId}/complete`,
        { method: "POST", body: {} }
      )

      expect(res.status).toBe(200)
      expect(res.body!.type).toBe("order")
      const order = res.body!.order
      orderId = order.id
      orderDisplayId = order.display_id
      createdOrderIds.push(order.id)

      // Гостевой заказ: состав, стоимость и статус
      expect(order.id).toMatch(/^order_/)
      expect(order.display_id).toBeGreaterThan(0)
      expect(order.status).toBe("pending")
      expect(order.email).toBe(EMAIL)
      expect(order.currency_code).toBe("rub")

      const subtotal = variantUnitPrice * 3
      const total = subtotal + 500
      expect(order.item_subtotal).toBe(subtotal)
      expect(order.shipping_total).toBe(500)
      expect(order.discount_total).toBe(0)
      expect(order.tax_total).toBe(0)
      // subtotal заказа включает доставку (особенность Medusa)
      expect(order.subtotal).toBe(total)
      expect(order.total).toBe(total)

      const item = order.items![0]!
      expect(item.title).toBe("Стикерпак «Море»")
      expect(item.quantity).toBe(3)
      expect(item.unit_price).toBe(variantUnitPrice)
      expect(item.subtotal).toBe(subtotal)
      expect(item.total).toBe(subtotal)
    },
    30_000
  )

  it(
    "заказ читается по id: статус и payment_status authorized",
    async () => {
      // 5.2.1: голый order_id больше не авторизация — гостевой заказ
      // читается по подтвержденному праву (заголовок x-cart-id с id
      // корзины, из которой оформлен заказ; см. docs/api.md, маршрут 52).
      const res = await storeFetch<{ order: Order }>(
        `/store/orders/${orderId}`,
        { guestProof: cartId }
      )

      expect(res.status).toBe(200)
      const order = res.body!.order
      expect(order.id).toBe(orderId)
      expect(order.display_id).toBe(orderDisplayId)
      expect(order.status).toBe("pending")
      // pp_system_default авторизуется неявно при complete
      expect(order.payment_status).toBe("authorized")
      expect(order.total).toBe(variantUnitPrice * 3 + 500)
      expect(order.email).toBe(EMAIL)
    },
    20_000
  )

  it(
    "гостевой заказ недоступен по id без подтвержденного права (5.2.1)",
    async () => {
      const res = await storeFetch(`/store/orders/${orderId}`)
      expect(res.status).toBe(404)
      const wrongProof = await storeFetch(`/store/orders/${orderId}`, {
        guestProof: "cart_01M8WRONGPROOF",
      })
      expect(wrongProof.status).toBe(404)
    },
    20_000
  )

  it(
    "повторное завершение той же корзины не создает дублирующий заказ",
    async () => {
      const again = await storeFetch<{ type: string; order: Order }>(
        `/store/carts/${cartId}/complete`,
        { method: "POST", body: {} }
      )

      // Идемпотентность completeCartWorkflow: 200 с тем же заказом
      expect(again.status).toBe(200)
      expect(again.body!.type).toBe("order")
      expect(again.body!.order.id).toBe(orderId)

      // Заказ по этому id ровно один (дублей нет)
      const admin = await adminFetch<{ count: number }>(
        `/admin/orders?id=${orderId}&limit=20`
      )
      expect(admin.status).toBe(200)
      expect(admin.body!.count).toBe(1)

      // Детальный заказ Admin API: статус заказа и авторизация платежа
      // системного провайдера при complete. Guest-заказ не expose-ит
      // customer_id: Store API не возвращает его вовсе, а Admin API —
      // только с явным fields=+customer_id (Medusa создает для гостя
      // неявную запись customer с has_account=false, см. docs/api.md).
      const detail = await adminFetch<{
        order: { status: string; payment_status: string }
      }>(`/admin/orders/${orderId}`)
      expect(detail.status).toBe(200)
      expect(detail.body!.order.status).toBe("pending")
      expect(detail.body!.order.payment_status).toBe("authorized")
    },
    30_000
  )
})

describe("Конкурентное завершение (регрессия этапа 4.5)", () => {
  it(
    "два одновременных complete одной корзины создают ровно один заказ",
    async () => {
      const concurrentCart = await prepareCompletableCart()

      const [first, second] = await Promise.allSettled([
        storeFetch<{ type: string; order: Order }>(
          `/store/carts/${concurrentCart}/complete`,
          { method: "POST", body: {} }
        ),
        storeFetch<{ type: string; order: Order }>(
          `/store/carts/${concurrentCart}/complete`,
          { method: "POST", body: {} }
        ),
      ])

      // Оба запроса завершились успешно (второй дождался блокировки
      // и получил существующий заказ через идемпотентность workflow)
      expect(first.status).toBe("fulfilled")
      expect(second.status).toBe("fulfilled")
      const firstResult = (first as PromiseFulfilledResult<
        ApiResult<{ type: string; order: Order }>
      >).value
      const secondResult = (second as PromiseFulfilledResult<
        ApiResult<{ type: string; order: Order }>
      >).value
      expect(firstResult.status).toBe(200)
      expect(secondResult.status).toBe(200)
      expect(firstResult.body!.type).toBe("order")
      expect(secondResult.body!.type).toBe("order")

      // Один и тот же заказ — дубликата нет
      const concurrentOrderId = firstResult.body!.order.id
      expect(secondResult.body!.order.id).toBe(concurrentOrderId)
      createdOrderIds.push(concurrentOrderId)

      const admin = await adminFetch<{ count: number }>(
        `/admin/orders?id=${concurrentOrderId}&limit=20`
      )
      expect(admin.body!.count).toBe(1)
    },
    30_000
  )

  it(
    "разные корзины оформляются параллельно без взаимной блокировки",
    async () => {
      const [cartA, cartB] = await Promise.all([
        prepareCompletableCart(),
        prepareCompletableCart(),
      ])

      const [first, second] = await Promise.allSettled([
        storeFetch<{ type: string; order: Order }>(
          `/store/carts/${cartA}/complete`,
          { method: "POST", body: {} }
        ),
        storeFetch<{ type: string; order: Order }>(
          `/store/carts/${cartB}/complete`,
          { method: "POST", body: {} }
        ),
      ])

      expect(first.status).toBe("fulfilled")
      expect(second.status).toBe("fulfilled")
      const orderA = (first as PromiseFulfilledResult<
        ApiResult<{ type: string; order: Order }>
      >).value
      const orderB = (second as PromiseFulfilledResult<
        ApiResult<{ type: string; order: Order }>
      >).value
      expect(orderA.status).toBe(200)
      expect(orderB.status).toBe(200)
      expect(orderA.body!.order.id).not.toBe(orderB.body!.order.id)
      createdOrderIds.push(orderA.body!.order.id, orderB.body!.order.id)
    },
    30_000
  )

  it(
    "ошибка complete не оставляет блокировку: повторный запрос отвечает",
    async () => {
      const cart = await createCart()
      await storeFetch<CartResponse>(`/store/carts/${cart}/line-items`, {
        method: "POST",
        body: { variant_id: variantId, quantity: 1 },
      })
      await selectStandardShipping(cart)
      // Без payment collection: complete падает, но блокировка должна
      // освободиться — второй запрос не зависает и получает ответ.
      const first = await storeFetch<ErrorBody>(`/store/carts/${cart}/complete`, {
        method: "POST",
        body: {},
      })
      expect(first.status).toBe(400)

      const second = await storeFetch<ErrorBody>(`/store/carts/${cart}/complete`, {
        method: "POST",
        body: {},
      })
      expect(second.status).toBe(400)
      expect(second.body?.message).toContain(
        "Payment collection has not been initiated"
      )
    },
    30_000
  )
})

describe("Негативные проверки безопасности и валидации", () => {
  it("без publishable key → 400 not_allowed", async () => {
    const res = await storeFetch<ErrorBody>("/store/carts", {
      method: "POST",
      body: { region_id: regionId },
      key: null,
    })

    expect(res.status).toBe(400)
    expect(res.body?.type).toBe("not_allowed")
    expect(res.body?.message).toContain("Publishable API key required")
  })

  it("некорректный publishable key → 400 not_allowed", async () => {
    const res = await storeFetch<ErrorBody>("/store/carts", {
      method: "POST",
      body: { region_id: regionId },
      key: "pk_definitely_invalid_key_43",
    })

    expect(res.status).toBe(400)
    expect(res.body?.type).toBe("not_allowed")
    expect(res.body?.message).toContain("A valid publishable key is required")
  })

  it(
    "подмена unit_price → 400 invalid_data, цена не устанавливается клиентом",
    async () => {
      const cart = await createCart()
      const res = await storeFetch<ErrorBody>(
        `/store/carts/${cart}/line-items`,
        {
          method: "POST",
          body: { variant_id: variantId, quantity: 1, unit_price: 1 },
        }
      )

      expect(res.status).toBe(400)
      expect(res.body?.type).toBe("invalid_data")
      expect(res.body?.message).toContain("Unrecognized fields")
      expect(res.body?.message).toContain("unit_price")

      // Корзина осталась пустой — позиция не добавлена
      const after = await storeFetch<CartResponse>(`/store/carts/${cart}`)
      expect(after.body!.cart.items).toEqual([])
    },
    20_000
  )

  it(
    "отрицательное количество → 400 invalid_data",
    async () => {
      const cart = await createCart()
      const res = await storeFetch<ErrorBody>(
        `/store/carts/${cart}/line-items`,
        { method: "POST", body: { variant_id: variantId, quantity: -1 } }
      )

      expect(res.status).toBe(400)
      expect(res.body?.type).toBe("invalid_data")
      expect(res.body?.message).toContain("quantity")
    },
    20_000
  )

  it(
    "превышение доступного остатка → 400 insufficient_inventory",
    async () => {
      const cart = await createCart()
      const res = await storeFetch<ErrorBody>(
        `/store/carts/${cart}/line-items`,
        { method: "POST", body: { variant_id: variantId, quantity: 100000 } }
      )

      expect(res.status).toBe(400)
      expect(res.body?.code).toBe("insufficient_inventory")
      expect(res.body?.message).toContain(
        "does not have the required inventory"
      )

      const after = await storeFetch<CartResponse>(`/store/carts/${cart}`)
      expect(after.body!.cart.items).toEqual([])
    },
    20_000
  )

  it(
    "вариант с нулевым остатком (TEE-MED-M-BLK) → 400 insufficient_inventory",
    async () => {
      const cart = await createCart()
      const res = await storeFetch<ErrorBody>(
        `/store/carts/${cart}/line-items`,
        {
          method: "POST",
          body: { variant_id: zeroStockVariantId, quantity: 1 },
        }
      )

      expect(res.status).toBe(400)
      expect(res.body?.code).toBe("insufficient_inventory")
    },
    20_000
  )

  it(
    "отсутствующий вариант товара → 400 invalid_data",
    async () => {
      const cart = await createCart()
      const res = await storeFetch<ErrorBody>(
        `/store/carts/${cart}/line-items`,
        {
          method: "POST",
          body: { variant_id: "variant_does_not_exist_43", quantity: 1 },
        }
      )

      expect(res.status).toBe(400)
      expect(res.body?.type).toBe("invalid_data")
      expect(res.body?.message).toContain(
        "do not exist or belong to a product that is not published"
      )
    },
    20_000
  )

  it(
    "complete без payment collection → 400",
    async () => {
      const cart = await createCart()
      await storeFetch<CartResponse>(`/store/carts/${cart}/line-items`, {
        method: "POST",
        body: { variant_id: variantId, quantity: 1 },
      })
      await selectStandardShipping(cart)

      const res = await storeFetch<ErrorBody>(`/store/carts/${cart}/complete`, {
        method: "POST",
        body: {},
      })

      expect(res.status).toBe(400)
      expect(res.body?.type).toBe("invalid_data")
      expect(res.body?.message).toContain(
        "Payment collection has not been initiated"
      )
    },
    30_000
  )

  it(
    "complete без payment session (только collection) → 400",
    async () => {
      const cart = await createCart()
      await storeFetch<CartResponse>(`/store/carts/${cart}/line-items`, {
        method: "POST",
        body: { variant_id: variantId, quantity: 1 },
      })
      await selectStandardShipping(cart)
      const pc = await storeFetch<{
        payment_collection: PaymentCollection
      }>("/store/payment-collections", {
        method: "POST",
        body: { cart_id: cart },
      })
      expect(pc.status).toBe(200)

      const res = await storeFetch<ErrorBody>(`/store/carts/${cart}/complete`, {
        method: "POST",
        body: {},
      })

      expect(res.status).toBe(400)
      expect(res.body?.type).toBe("invalid_data")
      expect(res.body?.message).toContain(
        "Payment sessions are required to complete cart"
      )
    },
    30_000
  )

  it(
    "complete без способа доставки (позиции requires_shipping) → 400",
    async () => {
      const cart = await createCart()
      await storeFetch<CartResponse>(`/store/carts/${cart}/line-items`, {
        method: "POST",
        body: { variant_id: variantId, quantity: 1 },
      })
      const pc = await storeFetch<{
        payment_collection: PaymentCollection
      }>("/store/payment-collections", {
        method: "POST",
        body: { cart_id: cart },
      })
      expect(pc.status).toBe(200)
      const session = await storeFetch<CartResponse>(
        `/store/payment-collections/${pc.body!.payment_collection.id}/payment-sessions`,
        { method: "POST", body: { provider_id: "pp_system_default" } }
      )
      expect(session.status).toBe(200)

      const res = await storeFetch<ErrorBody>(`/store/carts/${cart}/complete`, {
        method: "POST",
        body: {},
      })

      expect(res.status).toBe(400)
      expect(res.body?.type).toBe("invalid_data")
      expect(res.body?.message).toContain("No shipping method selected")
    },
    30_000
  )
})

async function selectStandardShipping(cart: string): Promise<void> {
  const options = (
    await storeFetch<{ shipping_options: ShippingOption[] }>(
      `/store/shipping-options?cart_id=${cart}`
    )
  ).body!.shipping_options
  const standard = options.find(
    (option) => option.name === "Стандартная доставка"
  )
  if (!standard) {
    throw new Error("Способ доставки «Стандартная доставка» не найден")
  }
  const res = await storeFetch<CartResponse>(
    `/store/carts/${cart}/shipping-methods`,
    { method: "POST", body: { option_id: standard.id } }
  )
  if (res.status !== 200) {
    throw new Error(`Не удалось выбрать доставку: HTTP ${res.status}`)
  }
}

/**
 * Корзина, готовая к complete: позиция + доставка + payment collection
 * с сессией pp_system_default. Для конкурентных сценариев этапа 4.5.
 */
async function prepareCompletableCart(): Promise<string> {
  const cart = await createCart()

  const item = await storeFetch<CartResponse>(`/store/carts/${cart}/line-items`, {
    method: "POST",
    body: { variant_id: variantId, quantity: 1 },
  })
  if (item.status !== 200) {
    throw new Error(`Не удалось добавить позицию: HTTP ${item.status}`)
  }

  await selectStandardShipping(cart)

  const collection = await storeFetch<{
    payment_collection: PaymentCollection
  }>("/store/payment-collections", {
    method: "POST",
    body: { cart_id: cart },
  })
  if (collection.status !== 200) {
    throw new Error(`Не удалось создать payment collection: HTTP ${collection.status}`)
  }

  const session = await storeFetch<CartResponse>(
    `/store/payment-collections/${collection.body!.payment_collection.id}/payment-sessions`,
    { method: "POST", body: { provider_id: "pp_system_default" } }
  )
  if (session.status !== 200) {
    throw new Error(`Не удалось создать payment session: HTTP ${session.status}`)
  }

  return cart
}

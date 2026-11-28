import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Интеграционные тесты демонстрационных способов оплаты этапа 6.2
 * (живая Medusa; архитектура — решение №41 в docs/PROGRESS.md).
 *
 * Покрыто (минимальная регрессия; расширенная приемка — этап 6.5):
 * - список способов оплаты региона: pp_cod_cash и pp_demo_online доступны,
 *   служебный pp_system_default покупателю не предлагается;
 * - оплата при получении (COD): техническая авторизация при complete
 *   (payment_status authorized, captured_at null, paid_total 0 — НЕ «оплачено»),
 *   частичный/полный capture администратором, частичный/полный возврат
 *   (ручная финансовая операция), отмена неоплаченного заказа;
 * - тестовая онлайн-оплата (demo): success → authorized; decline → 400
 *   (заказ не создается); pending → заказ awaiting + асинхронное подтверждение
 *   подписанным webhook-ом (authorized → captured), повторная доставка
 *   идемпотентна, неверная подпись игнорируется, сумма сверх авторизованной
 *   не списывается, выбор несвязанного провайдера отвергается;
 * - переключение способа оплаты (замена сессии до complete).
 *
 * Изоляция: уникальные email на прогон; резервирования инвентаря созданных
 * заказов удаляются в afterAll (API удаления заказов нет — заказы остаются,
 * побочный эффект зафиксирован в PROGRESS.md, как у этапов 4–5).
 */

const baseUrl =
  process.env.NUXT_MEDUSA_URL ?? process.env.MEDUSA_URL ?? "http://localhost:9000"
const publishableKey =
  process.env.NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  process.env.MEDUSA_PUBLISHABLE_KEY
const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const webhookSecret = process.env.PAYMENT_DEMO_WEBHOOK_SECRET

type ApiResult<T> = { status: number; body: T | null }

async function rawFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> }
): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as T | null }
}
function storeFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<ApiResult<T>> {
  return rawFetch<T>(path, {
    method: init?.method,
    body: init?.body,
    headers: { "x-publishable-api-key": publishableKey! },
  })
}

let adminToken = ""
function adminFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<ApiResult<T>> {
  return rawFetch<T>(path, {
    method: init?.method,
    body: init?.body,
    headers: {
      "x-publishable-api-key": publishableKey!,
      Authorization: `Bearer ${adminToken}`,
    },
  })
}

// ── Типы ответов (локальные, только используемые поля) ─────────────────────
type PaymentCollection = {
  id: string
  amount: number
  payment_sessions?: Array<{ id: string; provider_id: string; status: string }>
}
type Order = {
  id: string
  display_id?: number
  payment_status: string
  total: number
  items?: Array<{ id: string }>
  summary?: { paid_total?: number }
}
type AdminPayment = {
  id: string
  captured_at: string | null
  canceled_at?: string | null
  captures?: Array<{ id: string; amount: number }>
  refunds?: Array<{ id: string; amount: number }>
}

// ── Состояние ──────────────────────────────────────────────────────────────
let regionId = ""
let variantId = ""
let shippingOptionId = ""
const createdOrderIds: string[] = []

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function guestCheckout(options: {
  provider: "pp_cod_cash" | "pp_demo_online"
  outcome?: "success" | "decline" | "pending"
  quantity?: number
  email: string
}): Promise<{
  cartId: string
  collectionId: string
  sessionId: string
  complete: ApiResult<{ type?: string; order?: Order }>
}> {
  const cart = await storeFetch<{ cart: { id: string } }>("/store/carts", {
    method: "POST",
    body: { region_id: regionId },
  })
  const cartId = cart.body!.cart.id
  await storeFetch(`/store/carts/${cartId}`, {
    method: "POST",
    body: {
      email: options.email,
      shipping_address: {
        first_name: "Аудит",
        last_name: "6.2",
        address_1: "ул. Тестовая, 1",
        city: "Москва",
        country_code: "ru",
        postal_code: "101000",
      },
    },
  })
  await storeFetch(`/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: { variant_id: variantId, quantity: options.quantity ?? 2 },
  })
  await storeFetch(`/store/carts/${cartId}/shipping-methods`, {
    method: "POST",
    body: { option_id: shippingOptionId },
  })
  const pc = await storeFetch<{ payment_collection: PaymentCollection }>(
    "/store/payment-collections",
    { method: "POST", body: { cart_id: cartId } }
  )
  const session = await storeFetch<{ payment_collection: PaymentCollection }>(
    `/store/payment-collections/${pc.body!.payment_collection.id}/payment-sessions`,
    {
      method: "POST",
      body: {
        provider_id: options.provider,
        ...(options.provider === "pp_demo_online" && options.outcome
          ? { data: { outcome: options.outcome } }
          : {}),
      },
    }
  )
  expect(session.status).toBe(200)
  const complete = await storeFetch<{ type?: string; order?: Order }>(
    `/store/carts/${cartId}/complete`,
    { method: "POST", body: {} }
  )
  if (complete.status === 200 && complete.body?.order?.id) {
    createdOrderIds.push(complete.body.order.id)
  }
  return {
    cartId,
    collectionId: pc.body!.payment_collection.id,
    sessionId: session.body!.payment_collection.payment_sessions![0]!.id,
    complete,
  }
}

async function readStoreOrder(cartId: string, orderId: string): Promise<Order | null> {
  const res = await rawFetch<{ order: Order }>(`/store/orders/${orderId}`, {
    headers: { "x-publishable-api-key": publishableKey!, "x-cart-id": cartId },
  })
  return res.body?.order ?? null
}

async function waitForStatus(
  cartId: string,
  orderId: string,
  predicate: (o: Order) => boolean,
  attempts = 12
): Promise<Order | null> {
  for (let i = 0; i < attempts; i++) {
    await sleep(1500)
    const order = await readStoreOrder(cartId, orderId)
    if (order && predicate(order)) return order
  }
  return await readStoreOrder(cartId, orderId)
}

async function orderPaymentId(orderId: string): Promise<string> {
  const res = await adminFetch<{
    order: { payment_collections: Array<{ payments: Array<AdminPayment> }> }
  }>(`/admin/orders/${orderId}?fields=*payment_collections.payments`, {})
  return res.body!.order.payment_collections[0]!.payments[0]!.id
}

async function signedWebhook(
  payload: Record<string, unknown>,
  options?: { signature?: string }
): Promise<number> {
  const { createHmac } = await import("node:crypto")
  const body = JSON.stringify(payload)
  const signature =
    options?.signature ??
    createHmac("sha256", webhookSecret!).update(body, "utf8").digest("hex")
  const res = await fetch(`${baseUrl}/hooks/payment/pp_demo_online`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-demo-signature": signature },
    body,
  })
  return res.status
}

// ── Настройка ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  expect(publishableKey, "MEDUSA_PUBLISHABLE_KEY обязателен").toBeTruthy()
  expect(adminEmail, "ADMIN_EMAIL передается через make test").toBeTruthy()
  expect(webhookSecret, "PAYMENT_DEMO_WEBHOOK_SECRET передается в тест-контейнер").toBeTruthy()

  const auth = await rawFetch<{ token?: string }>("/auth/user/emailpass", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  })
  expect(auth.status).toBe(200)
  adminToken = auth.body!.token!

  const regions = await storeFetch<{ regions: Array<{ id: string }> }>("/store/regions")
  regionId = regions.body!.regions[0]!.id

  const products = await storeFetch<{
    products: Array<{ variants: Array<{ id: string; sku?: string }> }>
  }>("/store/products?handle=stikerpak-more&limit=1")
  variantId = products.body!.products[0]!.variants[0]!.id

  // cart_id обязателен для списка опций: создаем пустую корзину
  const tmpCart = await storeFetch<{ cart: { id: string } }>("/store/carts", {
    method: "POST",
    body: { region_id: regionId },
  })
  const options = await storeFetch<{ shipping_options: Array<{ id: string }> }>(
    `/store/shipping-options?cart_id=${tmpCart.body!.cart.id}`
  )
  shippingOptionId = options.body!.shipping_options[0]!.id
}, 60_000)

afterAll(async () => {
  // Резервирования инвентаря тестовых заказов прогона (только свои).
  if (!createdOrderIds.length || !adminToken) return
  for (const orderId of createdOrderIds) {
    const order = await adminFetch<{ order: { items: Array<{ id: string }> } }>(
      `/admin/orders/${orderId}?fields=+items.*`,
      {}
    )
    const itemIds = (order.body?.order.items ?? []).map((i) => i.id)
    for (const itemId of itemIds) {
      const res = await adminFetch<{ reservations: Array<{ id: string }> }>(
        `/admin/reservations?line_item_id[]=${itemId}`,
        {}
      )
      for (const rv of res.body?.reservations ?? []) {
        await adminFetch(`/admin/reservations/${rv.id}`, { method: "DELETE" })
      }
    }
  }
})

// ── Тесты ───────────────────────────────────────────────────────────────────
describe("Способы оплаты региона (этап 6.2)", () => {
  it(
    "покупателю доступны pp_cod_cash и pp_demo_online; pp_system_default не предлагается",
    async () => {
      const res = await storeFetch<{
        payment_providers: Array<{ id: string; is_enabled: boolean }>
      }>(`/store/payment-providers?region_id=${regionId}`)
      expect(res.status).toBe(200)
      const ids = res.body!.payment_providers.map((p) => p.id)
      expect(ids).toContain("pp_cod_cash")
      expect(ids).toContain("pp_demo_online")
      expect(ids).not.toContain("pp_system_default")
      expect(res.body!.payment_providers.every((p) => p.is_enabled)).toBe(true)
    }
  )

  it(
    "выбор несвязанного провайдера (pp_system_default) отвергается",
    async () => {
      const cart = await storeFetch<{ cart: { id: string } }>("/store/carts", {
        method: "POST",
        body: { region_id: regionId },
      })
      const pc = await storeFetch<{ payment_collection: PaymentCollection }>(
        "/store/payment-collections",
        { method: "POST", body: { cart_id: cart.body!.cart.id } }
      )
      const res = await storeFetch(`/store/payment-collections/${pc.body!.payment_collection.id}/payment-sessions`, {
        method: "POST",
        body: { provider_id: "pp_system_default" },
      })
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_data" })
    }
  )
})

describe("Оплата при получении (pp_cod_cash)", () => {
  it(
    "техническая авторизация не означает получение денег: authorized, captured_at null, paid_total 0",
    async () => {
      const { cartId, complete } = await guestCheckout({
        provider: "pp_cod_cash",
        email: `cod-62-${Date.now()}@example.com`,
      })
      expect(complete.status).toBe(200)
      const order = complete.body!.order!
      // payment_status отсутствует в ответе complete (аудит 6.1) — читается Store API
      expect(order.id).toBeTruthy()

      const storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("authorized")
      expect(storeOrder!.summary?.paid_total).toBe(0)

      const paymentId = await orderPaymentId(order.id)
      const payment = await adminFetch<AdminPayment>(
        `/admin/payments/${paymentId}?fields=+canceled_at`,
        {}
      )
      expect(payment.body!.payment.captured_at).toBeNull()
    }
  )

  it(
    "подтверждение оплаты администратором: частичный и полный capture, возвраты",
    async () => {
      const { cartId, complete } = await guestCheckout({
        provider: "pp_cod_cash",
        email: `cod-62-cap-${Date.now()}@example.com`,
      })
      const order = complete.body!.order!
      const paymentId = await orderPaymentId(order.id)
      const half = Math.round(order.total / 2)

      const part = await adminFetch<{ payment: AdminPayment }>(
        `/admin/payments/${paymentId}/capture`,
        { method: "POST", body: { amount: half } }
      )
      expect(part.status).toBe(200)
      let storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("partially_captured")
      expect(storeOrder!.summary?.paid_total).toBe(half)

      const rest = await adminFetch<{ payment: AdminPayment }>(
        `/admin/payments/${paymentId}/capture`,
        { method: "POST", body: { amount: order.total - half } }
      )
      expect(rest.status).toBe(200)
      storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("captured")
      expect(storeOrder!.summary?.paid_total).toBe(order.total)

      const refundPart = await adminFetch<{ payment: AdminPayment }>(
        `/admin/payments/${paymentId}/refund`,
        { method: "POST", body: { amount: half } }
      )
      expect(refundPart.status).toBe(200)
      storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("partially_refunded")

      const refundRest = await adminFetch<{ payment: AdminPayment }>(
        `/admin/payments/${paymentId}/refund`,
        { method: "POST", body: { amount: order.total - half } }
      )
      expect(refundRest.status).toBe(200)
      storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("refunded")
    }
  )

  it(
    "отмена неоплаченного заказа отменяет платеж (canceled_at)",
    async () => {
      const { complete } = await guestCheckout({
        provider: "pp_cod_cash",
        quantity: 1,
        email: `cod-62-cancel-${Date.now()}@example.com`,
      })
      const order = complete.body!.order!
      const paymentId = await orderPaymentId(order.id)

      const cancel = await adminFetch(`/admin/orders/${order.id}/cancel`, {
        method: "POST",
        body: {},
      })
      expect(cancel.status).toBe(200)

      const payment = await adminFetch<AdminPayment>(
        `/admin/payments/${paymentId}?fields=+canceled_at`,
        {}
      )
      expect(payment.body!.payment.canceled_at).toBeTruthy()
    }
  )
})

describe("Тестовая онлайн-оплата (pp_demo_online)", () => {
  it(
    "success: заказ создается, payment_status authorized, деньги не списаны",
    async () => {
      const { cartId, complete } = await guestCheckout({
        provider: "pp_demo_online",
        outcome: "success",
        email: `demo-62-ok-${Date.now()}@example.com`,
      })
      expect(complete.status).toBe(200)
      const order = complete.body!.order!
      const storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("authorized")
      expect(storeOrder!.summary?.paid_total).toBe(0)
    }
  )

  it(
    "decline: complete завершается 400, заказ не создается",
    async () => {
      const { complete } = await guestCheckout({
        provider: "pp_demo_online",
        outcome: "decline",
        email: `demo-62-decline-${Date.now()}@example.com`,
      })
      expect(complete.status).toBe(400)
      expect(complete.body).toMatchObject({ type: "not_allowed" })
      expect(String((complete.body as { message?: string })?.message)).toMatch(
        /declined/
      )
    }
  )

  it(
    "pending → заказ awaiting; подписанный webhook: authorized → captured; повторная доставка идемпотентна",
    async () => {
      const { cartId, complete, sessionId } = await guestCheckout({
        provider: "pp_demo_online",
        outcome: "pending",
        email: `demo-62-pending-${Date.now()}@example.com`,
      })
      expect(complete.status).toBe(200)
      const order = complete.body!.order!
      let storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("awaiting")

      // Подтверждение подписанным webhook-ом (штатный маршрут + delay 1 c)
      expect(
        await signedWebhook({
          event_type: "authorized",
          session_id: sessionId,
          amount: order.total,
        })
      ).toBe(200)
      storeOrder = await waitForStatus(cartId, order.id, (o) => o.payment_status === "authorized")
      expect(storeOrder!.payment_status).toBe("authorized")

      expect(
        await signedWebhook({
          event_type: "captured",
          session_id: sessionId,
          amount: order.total,
        })
      ).toBe(200)
      storeOrder = await waitForStatus(cartId, order.id, (o) => o.payment_status === "captured")
      expect(storeOrder!.payment_status).toBe("captured")
      expect(storeOrder!.summary?.paid_total).toBe(order.total)

      // Повторная доставка того же события — дублей нет (штатная идемпотентность)
      expect(
        await signedWebhook({
          event_type: "captured",
          session_id: sessionId,
          amount: order.total,
        })
      ).toBe(200)
      await sleep(5000)
      const paymentId = await orderPaymentId(order.id)
      const payment = await adminFetch<AdminPayment>(
        `/admin/payments/${paymentId}`,
        {}
      )
      expect(payment.body!.payment.captures!.length).toBe(1)
      expect((await readStoreOrder(cartId, order.id))!.payment_status).toBe("captured")
    },
    90_000
  )

  it(
    "неверная подпись webhook-а игнорируется: состояние не меняется",
    async () => {
      const { cartId, complete, sessionId } = await guestCheckout({
        provider: "pp_demo_online",
        outcome: "pending",
        email: `demo-62-badsig-${Date.now()}@example.com`,
      })
      const order = complete.body!.order!

      expect(
        await signedWebhook(
          { event_type: "authorized", session_id: sessionId, amount: order.total },
          { signature: "deadbeef" }
        )
      ).toBe(200)
      await sleep(6000)
      // Сессия не подтверждена: заказ остается awaiting, платеж не создан
      const storeOrder = await readStoreOrder(cartId, order.id)
      expect(storeOrder!.payment_status).toBe("awaiting")
      const adminOrder = await adminFetch<{
        order: { payment_collections: Array<{ payments: unknown[] }> }
      }>(`/admin/orders/${order.id}?fields=*payment_collections.payments`, {})
      expect(adminOrder.body!.order.payment_collections[0]!.payments.length).toBe(0)
    },
    60_000
  )

  it(
    "webhook со сверх-суммой не списывает больше авторизованной (несоответствие суммы)",
    async () => {
      const { cartId, complete, sessionId } = await guestCheckout({
        provider: "pp_demo_online",
        outcome: "pending",
        email: `demo-62-amount-${Date.now()}@example.com`,
      })
      const order = complete.body!.order!

      expect(
        await signedWebhook({
          event_type: "authorized",
          session_id: sessionId,
          amount: order.total,
        })
      ).toBe(200)
      await waitForStatus(cartId, order.id, (o) => o.payment_status === "authorized")

      expect(
        await signedWebhook({
          event_type: "captured",
          session_id: sessionId,
          amount: order.total * 2,
        })
      ).toBe(200)
      await sleep(7000)
      const paymentId = await orderPaymentId(order.id)
      const payment = await adminFetch<AdminPayment>(`/admin/payments/${paymentId}`, {})
      expect(payment.body!.payment.captures!.length).toBe(0)
      expect((await readStoreOrder(cartId, order.id))!.payment_status).toBe("authorized")
    },
    60_000
  )

  it(
    "переключение способа оплаты: замена сессии demo → cod до complete",
    async () => {
      const cart = await storeFetch<{ cart: { id: string } }>("/store/carts", {
        method: "POST",
        body: { region_id: regionId },
      })
      const cartId = cart.body!.cart.id
      await storeFetch(`/store/carts/${cartId}`, {
        method: "POST",
        body: {
          email: `demo-62-switch-${Date.now()}@example.com`,
          shipping_address: {
            first_name: "Аудит",
            last_name: "6.2",
            address_1: "ул. Тестовая, 1",
            city: "Москва",
            country_code: "ru",
            postal_code: "101000",
          },
        },
      })
      await storeFetch(`/store/carts/${cartId}/line-items`, {
        method: "POST",
        body: { variant_id: variantId, quantity: 1 },
      })
      const shipping = await storeFetch<{ shipping_options: Array<{ id: string }> }>(
        `/store/shipping-options?cart_id=${cartId}`
      )
      await storeFetch(`/store/carts/${cartId}/shipping-methods`, {
        method: "POST",
        body: { option_id: shipping.body!.shipping_options[0]!.id },
      })
      const pc = await storeFetch<{ payment_collection: PaymentCollection }>(
        "/store/payment-collections",
        { method: "POST", body: { cart_id: cartId } }
      )
      const collectionId = pc.body!.payment_collection.id

      const demo = await storeFetch<{ payment_collection: PaymentCollection }>(
        `/store/payment-collections/${collectionId}/payment-sessions`,
        { method: "POST", body: { provider_id: "pp_demo_online", data: { outcome: "success" } } }
      )
      expect(demo.status).toBe(200)
      expect(demo.body!.payment_collection.payment_sessions![0]!.provider_id).toBe(
        "pp_demo_online"
      )

      const cod = await storeFetch<{ payment_collection: PaymentCollection }>(
        `/store/payment-collections/${collectionId}/payment-sessions`,
        { method: "POST", body: { provider_id: "pp_cod_cash" } }
      )
      expect(cod.status).toBe(200)
      expect(cod.body!.payment_collection.payment_sessions![0]!.provider_id).toBe(
        "pp_cod_cash"
      )

      const done = await storeFetch<{ order?: Order }>(
        `/store/carts/${cartId}/complete`,
        { method: "POST", body: {} }
      )
      expect(done.status).toBe(200)
      if (done.body?.order?.id) createdOrderIds.push(done.body.order.id)
    }
  )
})

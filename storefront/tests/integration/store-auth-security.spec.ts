import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Регрессионные тесты безопасности корзин и заказов (этап 5.2.1).
 * Запускаются на РЕАЛЬНОЙ Medusa через `make test` (как
 * store-cart-checkout.spec.ts; ADMIN_EMAIL/ADMIN_PASSWORD — только в
 * одноразовом тестовом контейнере).
 *
 * Закрепляют фактическое поведение защиты (middleware cart-access.ts /
 * order-access.ts поверх штатных маршрутов, решение №37 в
 * docs/PROGRESS.md):
 *
 * - гостевая корзина и гостевой checkout работают по модели Medusa
 *   (id = секрет), включая корзину с неявным покупателем (has_account:
 *   false назначается ядром при установке email);
 * - авторизованная корзина доступна только владельцу: посторонний
 *   покупатель и неавторизованный запрос получают контролируемый 404
 *   (неотличимый от несуществующей корзины) на чтение/изменение/
 *   завершение;
 * - claim: свою гостевую корзину привязать можно (позиции сохраняются),
 *   повторный claim своей идемпотентен, чужую авторизованную — 404,
 *   конкурентный claim двух покупателей — ровно один победитель;
 * - заказы: свои — по авторизации; заказ гостя — по подтвержденному
 *   праву (заголовок x-cart-id с id корзины заказа); чужие и без права —
 *   404 без раскрытия данных; список серверно фильтруется ядром;
 * - transfer: инициатор request/cancel — покупатель с email заказа,
 *   посторонний — 404; ответ с данными заказа только легитимному.
 *
 * Побочные эффекты: покупатели test-5-2-1-* и по одному заказу на
 * полный checkout не удаляются (API удаления нет, зафиксировано);
 * резервирования инвентаря созданных заказов удаляются в afterAll.
 */

const baseUrl =
  process.env.NUXT_MEDUSA_URL ??
  process.env.MEDUSA_URL ??
  "http://localhost:9000"

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD

const publishableKey =
  process.env.NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  process.env.MEDUSA_PUBLISHABLE_KEY

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
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const body = (await res.json().catch(() => null)) as T | null
  return { status: res.status, body }
}

function storeFetch<T>(
  path: string,
  init?: {
    method?: string
    body?: unknown
    bearer?: string | null
    guestProof?: string | null
  }
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "x-publishable-api-key": publishableKey,
  }
  if (init?.bearer) {
    headers.authorization = `Bearer ${init.bearer}`
  }
  if (init?.guestProof) {
    headers["x-cart-id"] = init.guestProof
  }
  return rawFetch<T>(path, {
    method: init?.method,
    body: init?.body,
    headers,
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
    headers: { Authorization: `Bearer ${adminToken}` },
  })
}

// ── Данные прогона ─────────────────────────────────────────────────────

let regionId = ""
let variantId = ""

const runStamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`
const password = `Spec-5-2-1-${runStamp}`
const emailA = `spec-521-a-${runStamp}@example.com`
const emailB = `spec-521-b-${runStamp}@example.com`
const emailGuest = `spec-521-guest-${runStamp}@example.com`

let jwtA = ""
let jwtB = ""

/** Заказы, созданные прогоном (для очистки резервирований в afterAll). */
const createdOrderIds: string[] = []

interface CartBody {
  cart: {
    id: string
    customer_id?: string | null
    email: string | null
    items: Array<{ id: string; quantity: number }> | null
    total: number
  }
}

interface OrderBody {
  order: {
    id: string
    display_id: number
    status: string
    email: string | null
    total: number
  }
}

async function createCart(bearer?: string): Promise<string> {
  const res = await storeFetch<CartBody>("/store/carts", {
    method: "POST",
    body: { region_id: regionId },
    bearer: bearer ?? null,
  })
  if (res.status !== 200 || !res.body) {
    throw new Error(`Не удалось создать корзину: HTTP ${res.status}`)
  }
  return res.body.cart.id
}

async function addItem(cartId: string, bearer?: string): Promise<ApiResult<CartBody>> {
  return storeFetch<CartBody>(`/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: { variant_id: variantId, quantity: 1 },
    bearer: bearer ?? null,
  })
}

/** Гостевой checkout: email → доставка → payment collection/session.
 * Для владелецкой корзины передается bearer владельца (защита 5.2.1
 * требует авторизации на всех шагах). */
async function prepareCheckout(cartId: string, email: string, bearer?: string): Promise<void> {
  await storeFetch(`/store/carts/${cartId}`, {
    method: "POST",
    body: {
      email,
      shipping_address: {
        first_name: "Спек",
        last_name: "Тестов",
        address_1: "ул. Тестовая, 5",
        city: "Москва",
        country_code: "ru",
      },
    },
    bearer: bearer ?? null,
  })
  await storeFetch(`/store/carts/${cartId}/shipping-methods`, {
    method: "POST",
    body: { option_id: shippingOptionId },
    bearer: bearer ?? null,
  })
  const pc = await storeFetch<{
    payment_collection: { id: string }
  }>("/store/payment-collections", {
    method: "POST",
    body: { cart_id: cartId },
    bearer: bearer ?? null,
  })
  await storeFetch(
    `/store/payment-collections/${pc.body?.payment_collection.id}/payment-sessions`,
    { method: "POST", body: { provider_id: "pp_system_default" }, bearer: bearer ?? null }
  )
}

let shippingOptionId = ""

async function completeCart(
  cartId: string,
  bearer?: string
): Promise<ApiResult<{ type: string } & OrderBody>> {
  return storeFetch(`/store/carts/${cartId}/complete`, {
    method: "POST",
    body: {},
    bearer: bearer ?? null,
  })
}

async function registerCustomer(email: string): Promise<string> {
  const reg = await rawFetch<{ token: string }>("/auth/customer/emailpass/register", {
    method: "POST",
    body: { email, password },
  })
  if (reg.status !== 200 || !reg.body?.token) {
    throw new Error(`Регистрация ${email}: HTTP ${reg.status}`)
  }
  await storeFetch("/store/customers", {
    method: "POST",
    body: { email, first_name: "Спек", last_name: "Безопасность" },
    bearer: reg.body.token,
  })
  const login = await rawFetch<{ token: string }>("/auth/customer/emailpass", {
    method: "POST",
    body: { email, password },
  })
  if (login.status !== 200 || !login.body?.token) {
    throw new Error(`Вход ${email}: HTTP ${login.status}`)
  }
  return login.body.token
}

// ── Прогон ─────────────────────────────────────────────────────────────

describe("5.2.1: защита корзин и заказов (Store API)", () => {
  beforeAll(async () => {
    const login = await rawFetch<{ token: string }>("/auth/user/emailpass", {
      method: "POST",
      body: { email: adminEmail, password: adminPassword },
    })
    if (login.status !== 200 || !login.body?.token) {
      throw new Error(`Вход администратора: HTTP ${login.status}`)
    }
    adminToken = login.body.token

    const regions = await storeFetch<{ regions: Array<{ id: string }> }>(
      "/store/regions"
    )
    regionId = regions.body?.regions[0]?.id ?? ""
    if (!regionId) {
      throw new Error("В магазине нет регионов")
    }

    // Вариант с достаточным остатком (STICKER-PACK, 100 единиц) — как в
    // store-cart-checkout.spec.ts: complete резервирует инвентарь.
    const products = await storeFetch<{
      products: Array<{
        variants: Array<{ id: string; sku: string | null }>
      }>
    }>(
      `/store/products?handle=stikerpak-more&region_id=${regionId}` +
        `&fields=${encodeURIComponent("+variants.sku")}`
    )
    const sticker = products.body?.products[0]?.variants.find(
      (variant) => variant.sku === "STICKER-PACK"
    )
    if (!sticker?.id) {
      throw new Error("Демо-вариант STICKER-PACK не найден")
    }
    variantId = sticker.id

    // cart_id=unknown даст пустой список; опции зависят от региона корзины,
    // поэтому берем seed-опцию через отдельную корзину.
    const probeCart = await createCart()
    const probeOptions = await storeFetch<{
      shipping_options: Array<{ id: string }>
    }>(`/store/shipping-options?cart_id=${probeCart}`)
    shippingOptionId = probeOptions.body?.shipping_options[0]?.id ?? ""
    if (!shippingOptionId) {
      throw new Error("Seed-опции доставки не найдены")
    }

    jwtA = await registerCustomer(emailA)
    jwtB = await registerCustomer(emailB)
  })

  afterAll(async () => {
    // Очистка резервирований созданных заказов (best-effort, как в 4.3).
    for (const orderId of createdOrderIds) {
      try {
        const detail = await adminFetch<{
          order: { items: Array<{ id: string }> | null }
        }>(`/admin/orders/${orderId}`)
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
  })

  // ── Гостевая модель не сломана ───────────────────────────────────────

  it("гостевая корзина читается и изменяется без авторизации", async () => {
    const cartId = await createCart()
    const added = await addItem(cartId)
    expect(added.status).toBe(200)
    expect(added.body?.cart.items?.length).toBe(1)
    const read = await storeFetch(`/store/carts/${cartId}`)
    expect(read.status).toBe(200)
    const updated = await storeFetch(`/store/carts/${cartId}`, {
      method: "POST",
      body: { email: emailGuest },
    })
    expect(updated.status).toBe(200)
  })

  it("claim без авторизации гостевой корзины отклоняется (401)", async () => {
    const cartId = await createCart()
    const res = await storeFetch(`/store/carts/${cartId}/customer`, {
      method: "POST",
      body: {},
    })
    expect(res.status).toBe(401)
  })

  // ── Claim и владелецская изоляция ───────────────────────────────────

  it("покупатель привязывает свою гостевую корзину; позиции сохраняются; повтор идемпотентен", async () => {
    const cartId = await createCart()
    await addItem(cartId)
    const claim = await storeFetch<CartBody>(`/store/carts/${cartId}/customer`, {
      method: "POST",
      body: {},
      bearer: jwtA,
    })
    expect(claim.status).toBe(200)
    expect(claim.body?.cart.customer_id).toBeTruthy()
    expect(claim.body?.cart.items?.length).toBe(1)
    const again = await storeFetch(`/store/carts/${cartId}/customer`, {
      method: "POST",
      body: {},
      bearer: jwtA,
    })
    expect(again.status).toBe(200)
  })

  it("посторонний покупатель не может присвоить авторизованную корзину (claim → 404)", async () => {
    const cartId = await createCart()
    await storeFetch(`/store/carts/${cartId}/customer`, {
      method: "POST",
      body: {},
      bearer: jwtA,
    })
    const steal = await storeFetch(`/store/carts/${cartId}/customer`, {
      method: "POST",
      body: {},
      bearer: jwtB,
    })
    expect(steal.status).toBe(404)
  })

  it("посторонний покупатель не может читать/изменять/завершать чужую корзину (404)", async () => {
    const cartId = await createCart()
    await storeFetch(`/store/carts/${cartId}/customer`, {
      method: "POST",
      body: {},
      bearer: jwtA,
    })
    const lineId = (await addItem(cartId, jwtA)).body?.cart.items?.[0]?.id ?? ""
    expect(lineId).toBeTruthy()

    // чтение
    expect(
      (await storeFetch(`/store/carts/${cartId}`, { bearer: jwtB })).status
    ).toBe(404)
    // изменение
    expect(
      (
        await storeFetch(`/store/carts/${cartId}`, {
          method: "POST",
          body: { email: emailB },
          bearer: jwtB,
        })
      ).status
    ).toBe(404)
    // позиции
    expect((await addItem(cartId, jwtB)).status).toBe(404)
    expect(
      (
        await storeFetch(`/store/carts/${cartId}/line-items/${lineId}`, {
          method: "POST",
          body: { quantity: 9 },
          bearer: jwtB,
        })
      ).status
    ).toBe(404)
    expect(
      (
        await storeFetch(`/store/carts/${cartId}/line-items/${lineId}`, {
          method: "DELETE",
          bearer: jwtB,
        })
      ).status
    ).toBe(404)
    // доставка
    expect(
      (
        await storeFetch(`/store/carts/${cartId}/shipping-methods`, {
          method: "POST",
          body: { option_id: shippingOptionId },
          bearer: jwtB,
        })
      ).status
    ).toBe(404)
    // завершение
    expect((await completeCart(cartId, jwtB)).status).toBe(404)
    // неавторизованный доступ
    expect((await storeFetch(`/store/carts/${cartId}`)).status).toBe(404)
    expect((await completeCart(cartId)).status).toBe(404)

    // владелец продолжает работать
    expect(
      (await storeFetch(`/store/carts/${cartId}`, { bearer: jwtA })).status
    ).toBe(200)
  })

  it("конкурентный claim двух покупателей: ровно один победитель", async () => {
    const cartId = await createCart()
    const fire = (token: string) =>
      storeFetch(`/store/carts/${cartId}/customer`, {
        method: "POST",
        body: {},
        bearer: token,
      })
    // Небольшой барьер: оба запроса стартуют одновременно.
    const [resA, resB] = await Promise.all([
      (async () => {
        await new Promise((r) => setTimeout(r, 25))
        return fire(jwtA)
      })(),
      (async () => {
        await new Promise((r) => setTimeout(r, 25))
        return fire(jwtB)
      })(),
    ]) as [ApiResult<CartBody>, ApiResult<CartBody>]
    const statuses = [resA.status, resB.status].sort()
    expect(statuses[0]).toBe(200)
    expect(statuses[1]).toBe(404)
    // Победитель может читать корзину, проигравший — нет (владелец
    // зафиксирован транзакцией workflow под advisory-локом).
    const winnerJwt = resA.status === 200 ? jwtA : jwtB
    const loserJwt = resA.status === 200 ? jwtB : jwtA
    expect(
      (await storeFetch(`/store/carts/${cartId}`, { bearer: winnerJwt })).status
    ).toBe(200)
    expect(
      (await storeFetch(`/store/carts/${cartId}`, { bearer: loserJwt })).status
    ).toBe(404)
  })

  // ── Авторизованный checkout и заказы ────────────────────────────────

  it("владелец завершает свою корзину и читает заказ; посторонние — нет", async () => {
    const cartId = await createCart(jwtA)
    await addItem(cartId, jwtA)
    await prepareCheckout(cartId, emailA, jwtA)
    const done = await completeCart(cartId, jwtA)
    expect(done.status).toBe(200)
    const orderId = done.body?.order.id
    expect(orderId).toBeTruthy()
    createdOrderIds.push(orderId)

    // свой заказ по id
    const own = await storeFetch<OrderBody>(`/store/orders/${orderId}`, {
      bearer: jwtA,
    })
    expect(own.status).toBe(200)
    // посторонний покупатель — 404
    expect(
      (await storeFetch(`/store/orders/${orderId}`, { bearer: jwtB })).status
    ).toBe(404)
    // неавторизованный — 404
    expect(
      (await storeFetch(`/store/orders/${orderId}`)).status
    ).toBe(404)
    // proof корзины не открывает заказ зарегистрированного покупателя
    expect(
      (
        await storeFetch(`/store/orders/${orderId}`, {
          guestProof: cartId,
        })
      ).status
    ).toBe(404)

    // история: у A заказ есть, у B нет (серверный фильтр ядра)
    const listA = await storeFetch<{ orders: Array<{ id: string }>; count: number }>(
      "/store/orders",
      { bearer: jwtA }
    )
    expect(listA.status).toBe(200)
    expect(
      (listA.body?.orders ?? []).some((o) => o.id === orderId)
    ).toBe(true)
    const listB = await storeFetch<{ orders: Array<{ id: string }> }>(
      "/store/orders",
      { bearer: jwtB }
    )
    expect(
      (listB.body?.orders ?? []).some((o) => o.id === orderId)
    ).toBe(false)
  })

  // ── Гостевой заказ: подтвержденное право доступа ─────────────────────

  it("гостевой checkout работает; заказ читается только по праву (x-cart-id)", async () => {
    const cartId = await createCart()
    await addItem(cartId)
    await prepareCheckout(cartId, emailGuest)
    const done = await completeCart(cartId)
    expect(done.status).toBe(200)
    const orderId = done.body?.order.id
    expect(orderId).toBeTruthy()
    createdOrderIds.push(orderId)

    // голый order_id больше не авторизация
    expect((await storeFetch(`/store/orders/${orderId}`)).status).toBe(404)
    // неверный proof
    expect(
      (await storeFetch(`/store/orders/${orderId}`, { guestProof: "cart_wrong" }))
        .status
    ).toBe(404)
    // посторонний авторизованный покупатель
    expect(
      (await storeFetch(`/store/orders/${orderId}`, { bearer: jwtB })).status
    ).toBe(404)
    // верный proof — доступ гостя
    const proved = await storeFetch<OrderBody>(`/store/orders/${orderId}`, {
      guestProof: cartId,
    })
    expect(proved.status).toBe(200)
    expect(proved.body?.order.email).toBe(emailGuest)
  })

  it("transfer: инициатор — только покупатель с email заказа", async () => {
    // гостевой заказ из предыдущего теста
    const guestCartId = await createCart()
    await addItem(guestCartId)
    await prepareCheckout(guestCartId, emailGuest)
    const done = await completeCart(guestCartId)
    const orderId = done.body?.order.id
    expect(orderId).toBeTruthy()
    createdOrderIds.push(orderId)

    // посторонний покупатель B: request/cancel — 404 без данных
    expect(
      (
        await storeFetch(`/store/orders/${orderId}/transfer/request`, {
          method: "POST",
          body: {},
          bearer: jwtB,
        })
      ).status
    ).toBe(404)
    expect(
      (
        await storeFetch(`/store/orders/${orderId}/transfer/cancel`, {
          method: "POST",
          body: {},
          bearer: jwtB,
        })
      ).status
    ).toBe(404)

    // покупатель с email заказа (легитимный инициатор)
    const jwtGuest = await registerCustomer(emailGuest)
    const request = await storeFetch(`/store/orders/${orderId}/transfer/request`, {
      method: "POST",
      body: { description: "мой заказ" },
      bearer: jwtGuest,
    })
    expect(request.status).toBe(200)
    const cancel = await storeFetch(`/store/orders/${orderId}/transfer/cancel`, {
      method: "POST",
      body: {},
      bearer: jwtGuest,
    })
    expect(cancel.status).toBe(200)
  })

  // ── Регрессия 4.5: конкурентное завершение ──────────────────────────

  it("два одновременных complete одной корзины по-прежнему создают один заказ", async () => {
    const cartId = await createCart()
    await addItem(cartId)
    await prepareCheckout(cartId, `spec-521-comp-${runStamp}@example.com`)
    const [r1, r2] = await Promise.all([
      (async () => {
        await new Promise((r) => setTimeout(r, 25))
        return completeCart(cartId)
      })(),
      (async () => {
        await new Promise((r) => setTimeout(r, 25))
        return completeCart(cartId)
      })(),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r1.body?.order.id).toBe(r2.body?.order.id)
    createdOrderIds.push(r1.body?.order.id)
  })
})

import { beforeAll, afterAll, describe, expect, it } from "vitest"

/**
 * Регрессионные тесты rate limiting маршрутов аутентификации (этап 5.2.2;
 * механизм и ограничения — решение №38 в docs/PROGRESS.md).
 *
 * Закрепляют фактическое поведение (middleware auth-rate-limit.ts):
 * - лимит по идентификатору (нормализованный email, HMAC-хеш в ключах
 *   Redis): 429 + Retry-After с <max>+1-й попытки; тело
 *   {"type":"rate_limited",...} не раскрывает email (перечисление
 *   невозможно; счетчик одинаков для существующих/несуществующих email —
 *   проверка до аутентификации);
 * - атомарность: параллельные запросы не обходят лимит;
 * - лимит актора на transfer request.
 *
 * Сознательно НЕ покрыто автотестами (проверено живыми пробами 27.11.2026,
 * см. PROGRESS.md — таблицу этапа 5.2.2): исчерпание IP-бакетов (общий IP
 * тест-контейнера дестабилизировало бы повторные прогоны), TTL-восстановление
 * (требует окна > минуты), fail-open при недоступности Redis.
 * Этап 5.2.3: тесты уведомлений (store-auth-notifications) выполняются
 * ДО этого файла (vitest sequence.sortTestsFiles) — они используют те же
 * маршруты и не пережили бы сознательно исчерпанные здесь IP-бакеты.
 *
 * Побочный эффект: тестовые покупатели/identity и один гостевой заказ
 * (transfer) не удаляются (API удаления нет — зафиксировано); резервирование
 * инвентаря заказа удаляется в afterAll. НЕ запускайте серию из 3+ полных
 * прогонов в течение минуты: IP-бакеты (30/60 с) рассчитаны на ≤2 прогонов.
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

type ApiResult<T> = { status: number; headers: Headers; body: T | null }

async function rawFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> }
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
  return { status: res.status, headers: res.headers, body }
}

function authFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<ApiResult<T>> {
  return rawFetch<T>(path, init)
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
  if (init?.bearer) headers.authorization = `Bearer ${init.bearer}`
  if (init?.guestProof) headers["x-cart-id"] = init.guestProof
  return rawFetch<T>(path, { method: init?.method, body: init?.body, headers })
}

let adminToken = ""
let regionId = ""
let variantId = ""
let shippingOptionId = ""

const runStamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`
const password = `Spec-5-2-2-${runStamp}`

interface CartBody {
  cart: { id: string; items: Array<{ id: string }> | null }
}

interface TokenBody {
  token: string
}

interface OrderBody {
  order: { id: string }
}

const createdOrderIds: string[] = []

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

describe("5.2.2: rate limiting маршрутов аутентификации", () => {
  beforeAll(async () => {
    const login = await rawFetch<TokenBody>("/auth/user/emailpass", {
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

    const probeCart = await storeFetch<CartBody>("/store/carts", {
      method: "POST",
      body: { region_id: regionId },
    })
    const options = await storeFetch<{
      shipping_options: Array<{ id: string }>
    }>(`/store/shipping-options?cart_id=${probeCart.body?.cart.id}`)
    shippingOptionId = options.body?.shipping_options[0]?.id ?? ""
    if (!shippingOptionId) {
      throw new Error("Seed-опции доставки не найдены")
    }
  })

  afterAll(async () => {
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
        // Очистка best-effort — эффект задокументирован
      }
    }
  })

  it("вход: лимит по идентификатору — 6-я попытка 429 + Retry-After, без раскрытия email", async () => {
    const email = `spec-522-login-${runStamp}@example.com`
    const statuses: number[] = []
    let last: ApiResult<unknown> | null = null
    for (let i = 0; i < 6; i++) {
      last = await authFetch("/auth/customer/emailpass", {
        method: "POST",
        body: { email, password: "wrong" },
      })
      statuses.push(last.status)
    }
    // Дефолт AUTH_RATE_LIMIT_LOGIN_ID=5/900: первые 5 — штатный 401
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
    expect(last?.headers.get("retry-after")).toBeTruthy()
    expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0)
    // Тело 429: type=rate_limited, персональные данные не раскрываются
    const body = JSON.stringify(last?.body)
    expect(body).toContain("rate_limited")
    expect(body).not.toContain(email)
    expect(body).not.toContain("wrong")
  })

  it("вход: несуществующий email ограничивается на той же попытке (перечисление невозможно)", async () => {
    const email = `spec-522-ghost-${runStamp}@example.com`
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await authFetch("/auth/customer/emailpass", {
        method: "POST",
        body: { email, password: "x" },
      })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
  })

  it("регистрация: лимит по идентификатору — 6-я попытка 429", async () => {
    const email = `spec-522-reg-${runStamp}@example.com`
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await authFetch("/auth/customer/emailpass/register", {
        method: "POST",
        body: { email, password },
      })
      statuses.push(res.status)
    }
    // Штатная семантика ядра 2.23: повторный register с тем же email и тем
    // же паролем ДО создания профиля идемпотентно возвращает существующую
    // identity (resume-режим); 6-я попытка — 429 (лимит идентификатора 5/3600)
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
  })

  it("сброс пароля: 4-я попытка 429; одинаково для существующего и несуществующего email", async () => {
    const existing = `spec-522-reset-ex-${runStamp}@example.com`
    const reg = await authFetch<TokenBody>("/auth/customer/emailpass/register", {
      method: "POST",
      body: { email: existing, password },
    })
    expect(reg.status).toBe(200)

    const forExisting: number[] = []
    for (let i = 0; i < 4; i++) {
      const res = await authFetch("/auth/customer/emailpass/reset-password", {
        method: "POST",
        body: { identifier: existing },
      })
      forExisting.push(res.status)
    }
    // Дефолт AUTH_RATE_LIMIT_RESET_ID=3/3600
    expect(forExisting).toEqual([201, 201, 201, 429])

    const ghost = `spec-522-reset-ghost-${runStamp}@example.com`
    const forGhost: number[] = []
    for (let i = 0; i < 4; i++) {
      const res = await authFetch("/auth/customer/emailpass/reset-password", {
        method: "POST",
        body: { identifier: ghost },
      })
      forGhost.push(res.status)
    }
    expect(forGhost).toEqual([201, 201, 201, 429])
  })

  it("параллельные запросы не обходят лимит (атомарность счетчика)", async () => {
    const identifier = `spec-522-burst-${runStamp}@example.com`
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        authFetch("/auth/customer/emailpass/reset-password", {
          method: "POST",
          body: { identifier },
        })
      )
    )
    const statuses = results.map((r) => r.status).sort()
    // Ровно 3 прошли (лимит 3), остальные — 429
    expect(statuses.filter((s) => s === 201).length).toBe(3)
    expect(statuses.filter((s) => s === 429).length).toBe(2)
  })

  it("transfer request: лимит актора — 11-я попытка 429; штатный flow не сломан", async () => {
    // Гостевой заказ с email, совпадающим с email покупателя (легитимный
    // инициатор переноса — семантика 5.2.1).
    const email = `spec-522-transfer-${runStamp}@example.com`
    const cart = await storeFetch<CartBody>("/store/carts", {
      method: "POST",
      body: { region_id: regionId },
    })
    const cartId = cart.body?.cart.id ?? ""
    expect(cartId).toBeTruthy()
    await storeFetch(`/store/carts/${cartId}`, {
      method: "POST",
      body: {
        email,
        shipping_address: {
          first_name: "Спек",
          last_name: "Лимитов",
          address_1: "ул. Тестовая, 5",
          city: "Москва",
          country_code: "ru",
        },
      },
    })
    await storeFetch(`/store/carts/${cartId}/line-items`, {
      method: "POST",
      body: { variant_id: variantId, quantity: 1 },
    })
    await storeFetch(`/store/carts/${cartId}/shipping-methods`, {
      method: "POST",
      body: { option_id: shippingOptionId },
    })
    const pc = await storeFetch<{ payment_collection: { id: string } }>(
      "/store/payment-collections",
      { method: "POST", body: { cart_id: cartId } }
    )
    await storeFetch(
      `/store/payment-collections/${pc.body?.payment_collection.id}/payment-sessions`,
      { method: "POST", body: { provider_id: "pp_system_default" } }
    )
    const done = await storeFetch<OrderBody & { type: string }>(
      `/store/carts/${cartId}/complete`,
      { method: "POST", body: {} }
    )
    const orderId = done.body?.order.id
    expect(orderId).toBeTruthy()
    createdOrderIds.push(orderId)

    const reg = await authFetch<TokenBody>("/auth/customer/emailpass/register", {
      method: "POST",
      body: { email, password },
    })
    await storeFetch("/store/customers", {
      method: "POST",
      body: { email, first_name: "Спек" },
      bearer: reg.body?.token,
    })
    const login = await authFetch<TokenBody>("/auth/customer/emailpass", {
      method: "POST",
      body: { email, password },
    })
    expect(login.status).toBe(200)
    const jwt = login.body?.token ?? ""

    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await storeFetch(`/store/orders/${orderId}/transfer/request`, {
        method: "POST",
        body: {},
        bearer: jwt,
      })
      statuses.push(res.status)
    }
    // 1-я — 200 (создает transfer change), 2–10-я — штатный 400
    // "already has an active transfer request", 11-я — 429 (лимит актора 10/3600)
    expect(statuses[0]).toBe(200)
    expect(statuses.slice(1, 10)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400, 400,
    ])
    expect(statuses[10]).toBe(429)
  })
})

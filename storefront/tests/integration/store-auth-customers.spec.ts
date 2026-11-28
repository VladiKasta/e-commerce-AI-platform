import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Интеграционные тесты штатного Auth и Customer API Medusa 2.23 (этап 5.3).
 * Запускаются на РЕАЛЬНОЙ Medusa через `make test` (как
 * store-auth-security.spec.ts; ADMIN_EMAIL/ADMIN_PASSWORD — только в
 * одноразовом тестовом контейнере).
 *
 * Матрица 5.3 сознательно не дублирует уже покрытое этапами 5.2.1–5.2.3:
 * - guards корзин/заказов, конкурентные claim/complete, proof x-cart-id,
 *   transfer request/cancel посторонним — store-auth-security.spec.ts;
 * - rate limiting (429/Retry-After/атомарность) — store-auth-ratelimit.spec.ts;
 * - письма, одноразовость reset-/transfer-токенов, delivery уведомлений —
 *   store-auth-notifications.spec.ts.
 *
 * Здесь — остальной контракт штатного API:
 * - регистрация в два шага и повторная регистрация (401/422/resume);
 * - вход (верные/неверные креды, отсутствие перечисления email);
 * - me (Bearer), сессия (cookie HttpOnly, logout отзывает только сессию),
 *   refresh, разграничение Customer/Admin API, недействительные токены;
 * - профиль (чтение/изменение, email неизменяем этим маршрутом);
 * - адреса (CRUD, дефолты shipping/billing, чужие адреса — 404);
 * - авто-привязка новой корзины под Bearer; конкурентное изменение корзины
 *   во время claim (позиции не теряются);
 * - гостевые заказы не наследуются при регистрации; штатный transfer
 *   закрывает гостевой доступ (x-cart-id больше не открывает заказ).
 *
 * Побочные эффекты: покупатели/identity spec-53-* и два заказа (гостевой
 * checkout + перенос) не удаляются (API удаления нет — зафиксировано);
 * резервирования инвентаря заказов удаляются в afterAll.
 *
 * Просроченный JWT не тестируется: для его изготовления нужен секрет
 * подписи (в тестовый контейнер не передается), ожидание 24 ч недетерминировано.
 * Зафиксировано в docs/PROGRESS.md (ограничение этапа).
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
  return { status: res.status, headers: res.headers, body }
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
const password = `Spec-53-${runStamp}`

/** Основной покупатель (профиль, адреса, корзины). */
const emailA = `spec-53-a-${runStamp}@example.com`
/** Покупатель для повторной регистрации (семантика 401/resume/422). */
const emailC = `spec-53-c-${runStamp}@example.com`
/** Гостевой email: заказ до регистрации + штатный transfer. */
const emailGuest = `spec-53-guest-${runStamp}@example.com`

let jwtA = ""
let customerIdA = ""

/** Гость с заказом до регистрации (перенос — отдельным тестом ниже). */
let jwtGuest = ""
/** Корзина, породившая гостевой заказ (proof x-cart-id). */
let guestOrderCartId = ""

/** Заказы прогона (очистка резервирований в afterAll). */
const createdOrderIds: string[] = []

interface CartBody {
  cart: {
    id: string
    customer_id?: string | null
    email: string | null
    items: Array<{ id: string; quantity: number }> | null
  }
}

interface CustomerBody {
  customer: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    phone: string | null
    has_account: boolean
    addresses: Array<{
      id: string
      city: string | null
      is_default_shipping: boolean
      is_default_billing: boolean
    }>
  }
}

interface TokenBody {
  token: string
}

/** Регистрация покупателя (два шага) + вход; возвращает login JWT. */
async function registerCustomer(
  email: string,
  firstName: string
): Promise<{ jwt: string; customerId: string }> {
  const reg = await rawFetch<TokenBody>("/auth/customer/emailpass/register", {
    method: "POST",
    body: { email, password },
  })
  if (reg.status !== 200 || !reg.body?.token) {
    throw new Error(`Регистрация ${email}: HTTP ${reg.status}`)
  }
  const profile = await storeFetch<CustomerBody>("/store/customers", {
    method: "POST",
    body: { email, first_name: firstName, last_name: "Спек" },
    bearer: reg.body.token,
  })
  if (profile.status !== 200 || !profile.body?.customer) {
    throw new Error(`Профиль ${email}: HTTP ${profile.status}`)
  }
  const login = await rawFetch<TokenBody>("/auth/customer/emailpass", {
    method: "POST",
    body: { email, password },
  })
  if (login.status !== 200 || !login.body?.token) {
    throw new Error(`Вход ${email}: HTTP ${login.status}`)
  }
  return { jwt: login.body.token, customerId: profile.body.customer.id }
}

async function createGuestCart(): Promise<string> {
  const res = await storeFetch<CartBody>("/store/carts", {
    method: "POST",
    body: { region_id: regionId },
  })
  if (res.status !== 200 || !res.body) {
    throw new Error(`Не удалось создать корзину: HTTP ${res.status}`)
  }
  return res.body.cart.id
}

// ── Прогон ─────────────────────────────────────────────────────────────

describe("5.3: авторизация, профиль покупателя и заказы (Store/Auth API)", () => {
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
    if (!regionId) throw new Error("В магазине нет регионов")

    // STICKER-PACK (остаток 100) — как в остальных спеках: complete
    // резервирует инвентарь, afterAll удаляет только свои резервирования.
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
    if (!sticker?.id) throw new Error("Демо-вариант STICKER-PACK не найден")
    variantId = sticker.id
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

  // ── Авторизация: регистрация и вход ──────────────────────────────────

  it("регистрация в два шага: identity (actorless JWT) → профиль покупателя", async () => {
    const reg = await rawFetch<TokenBody>("/auth/customer/emailpass/register", {
      method: "POST",
      body: { email: emailA, password },
    })
    expect(reg.status).toBe(200)
    expect(reg.body?.token).toBeTruthy()

    const profile = await storeFetch<CustomerBody>("/store/customers", {
      method: "POST",
      body: { email: emailA, first_name: "Анна", last_name: "Спек" },
      bearer: reg.body?.token,
    })
    expect(profile.status).toBe(200)
    expect(profile.body?.customer.has_account).toBe(true)
    expect(profile.body?.customer.email).toBe(emailA)
    customerIdA = profile.body?.customer.id ?? ""

    // actorless JWT не является авторизацией покупателя: me требует actor_id
    const meWithActorless = await storeFetch<CustomerBody>(
      "/store/customers/me",
      { bearer: reg.body?.token }
    )
    expect(meWithActorless.status).toBe(401)
  })

  it("повторная регистрация: другой пароль → 401; тот же до профиля → resume 200; после профиля → 401; дубль профиля → 422", async () => {
    const first = await rawFetch<TokenBody>(
      "/auth/customer/emailpass/register",
      { method: "POST", body: { email: emailC, password } }
    )
    expect(first.status).toBe(200)

    const otherPassword = await rawFetch<{ message?: string }>(
      "/auth/customer/emailpass/register",
      { method: "POST", body: { email: emailC, password: `${password}-X` } }
    )
    expect(otherPassword.status).toBe(401)
    expect(otherPassword.body?.message).toContain(
      "Identity with email already exists"
    )

    const resume = await rawFetch<TokenBody>(
      "/auth/customer/emailpass/register",
      { method: "POST", body: { email: emailC, password } }
    )
    expect(resume.status).toBe(200)

    const profile = await storeFetch<CustomerBody>("/store/customers", {
      method: "POST",
      body: { email: emailC, first_name: "Сессия", last_name: "Повторов" },
      bearer: resume.body?.token,
    })
    expect(profile.status).toBe(200)

    const afterProfile = await rawFetch<TokenBody>(
      "/auth/customer/emailpass/register",
      { method: "POST", body: { email: emailC, password } }
    )
    expect(afterProfile.status).toBe(401)

    const duplicateProfile = await storeFetch<CustomerBody>(
      "/store/customers",
      {
        method: "POST",
        body: { email: emailC, first_name: "Дубль" },
        bearer: resume.body?.token,
      }
    )
    expect(duplicateProfile.status).toBe(422)
    expect(duplicateProfile.body?.type).toBe("duplicate_error")
  })

  it("вход: верные креды → 200; неверный пароль и несуществующий email — одинаковый 401", async () => {
    const login = await rawFetch<TokenBody>("/auth/customer/emailpass", {
      method: "POST",
      body: { email: emailA, password },
    })
    expect(login.status).toBe(200)
    expect(login.body?.token).toBeTruthy()
    jwtA = login.body?.token ?? ""

    const wrongPassword = await rawFetch<{ message?: string }>(
      "/auth/customer/emailpass",
      { method: "POST", body: { email: emailA, password: "wrong-password" } }
    )
    expect(wrongPassword.status).toBe(401)

    const nonexistent = await rawFetch<{ message?: string }>(
      "/auth/customer/emailpass",
      {
        method: "POST",
        body: { email: `spec-53-ghost-${runStamp}@example.com`, password },
      }
    )
    expect(nonexistent.status).toBe(401)
    // Одинаковый ответ — перечисление email невозможно
    expect(nonexistent.body?.message).toBe(wrongPassword.body?.message)
  })

  it("текущий покупатель: Bearer → 200; без авторизации, мусорный и искаженный токен → 401", async () => {
    const me = await storeFetch<CustomerBody>("/store/customers/me", {
      bearer: jwtA,
    })
    expect(me.status).toBe(200)
    expect(me.body?.customer.email).toBe(emailA)

    expect((await storeFetch("/store/customers/me")).status).toBe(401)
    expect(
      (await storeFetch("/store/customers/me", { bearer: "garbage.token" }))
        .status
    ).toBe(401)
    // Искаженная подпись/полезная нагрузка валидного JWT
    expect(
      (await storeFetch("/store/customers/me", { bearer: `${jwtA}x` })).status
    ).toBe(401)
  })

  it("сессия: cookie HttpOnly работает; logout отзывает сессию, JWT остается рабочим", async () => {
    const session = await rawFetch<unknown>("/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwtA}` },
    })
    expect(session.status).toBe(200)
    const setCookie = session.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("connect.sid=")
    expect(setCookie).toContain("HttpOnly")
    const cookie = setCookie.split(";")[0]

    // Cookie идентифицирует покупателя без Bearer (сырой запрос: storeFetch
    // не передает cookie)
    const meRaw = await rawFetch<CustomerBody>("/store/customers/me", {
      headers: {
        "x-publishable-api-key": publishableKey,
        cookie,
      },
    })
    expect(meRaw.status).toBe(200)
    expect(meRaw.body?.customer.email).toBe(emailA)

    const logout = await rawFetch<unknown>("/auth/session", {
      method: "DELETE",
      headers: { cookie },
    })
    expect(logout.status).toBe(200)

    expect(
      (
        await rawFetch("/store/customers/me", {
          headers: {
            "x-publishable-api-key": publishableKey,
            cookie,
          },
        })
      ).status
    ).toBe(401)

    // JWT stateless: после выхода сессии продолжает работать до истечения
    const meByJwt = await storeFetch<CustomerBody>("/store/customers/me", {
      bearer: jwtA,
    })
    expect(meByJwt.status).toBe(200)
  })

  it("refresh: новый JWT выпускается и работает; без токена → 401", async () => {
    const refresh = await rawFetch<TokenBody>("/auth/token/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwtA}` },
    })
    expect(refresh.status).toBe(200)
    expect(refresh.body?.token).toBeTruthy()
    // Примечание: refresh в ту же секунду может вернуть байт-идентичный
    // JWT (одинаковые iat/exp/payload → та же подпись) — контракт в
    // работоспособности выпущенного токена, а не в отличии байтов

    const meByNew = await storeFetch<CustomerBody>("/store/customers/me", {
      bearer: refresh.body?.token,
    })
    expect(meByNew.status).toBe(200)
    expect(meByNew.body?.customer.email).toBe(emailA)

    const noToken = await rawFetch<unknown>("/auth/token/refresh", {
      method: "POST",
    })
    expect(noToken.status).toBe(401)
  })

  it("разграничение Customer/Admin API: customer JWT → /admin 401; admin JWT → /store/customers/me 401", async () => {
    const adminRouteByCustomer = await rawFetch("/admin/customers", {
      headers: { Authorization: `Bearer ${jwtA}` },
    })
    expect(adminRouteByCustomer.status).toBe(401)

    const customerRouteByAdmin = await storeFetch<CustomerBody>(
      "/store/customers/me",
      { bearer: adminToken }
    )
    expect(customerRouteByAdmin.status).toBe(401)
  })

  // ── Профиль и адреса ────────────────────────────────────────────────

  it("профиль: изменение имени/телефона; email неизменяем этим маршрутом (400)", async () => {
    const update = await storeFetch<CustomerBody>("/store/customers/me", {
      method: "POST",
      body: { first_name: "Анна-Мария", phone: "+7 900 000-00-00" },
      bearer: jwtA,
    })
    expect(update.status).toBe(200)
    expect(update.body?.customer.first_name).toBe("Анна-Мария")
    expect(update.body?.customer.phone).toBe("+7 900 000-00-00")

    // Попытка смены email отвергается валидатором ядра — профиль
    // идентифицирует transfer-семантику, email менять так нельзя
    const emailChange = await storeFetch<CustomerBody>("/store/customers/me", {
      method: "POST",
      body: { email: `hijack-${runStamp}@example.com` },
      bearer: jwtA,
    })
    expect(emailChange.status).toBe(400)
    expect(emailChange.body?.type).toBe("invalid_data")

    const me = await storeFetch<CustomerBody>("/store/customers/me", {
      bearer: jwtA,
    })
    expect(me.body?.customer.email).toBe(emailA)
  })

  it("адреса: CRUD и дефолты shipping/billing; удаленный адрес → 404", async () => {
    const addressBody = {
      first_name: "Анна",
      last_name: "Спек",
      address_1: "ул. Тестовая, 5",
      city: "Москва",
      country_code: "ru",
      postal_code: "101000",
    }

    const shipping = await storeFetch<CustomerBody>(
      "/store/customers/me/addresses",
      {
        method: "POST",
        body: { ...addressBody, is_default_shipping: true },
        bearer: jwtA,
      }
    )
    expect(shipping.status).toBe(200)
    const shippingAddress = shipping.body?.customer.addresses.find(
      (address) => address.is_default_shipping
    )
    expect(shippingAddress).toBeTruthy()

    const billing = await storeFetch<CustomerBody>(
      "/store/customers/me/addresses",
      {
        method: "POST",
        body: { ...addressBody, city: "Санкт-Петербург", is_default_billing: true },
        bearer: jwtA,
      }
    )
    expect(billing.status).toBe(200)
    const billingAddress = billing.body?.customer.addresses.find(
      (address) => address.is_default_billing
    )
    expect(billingAddress).toBeTruthy()
    expect(billingAddress?.id).not.toBe(shippingAddress?.id)

    // Список — только свои адреса (фильтр по auth context ядра)
    const list = await storeFetch<{
      addresses: Array<{ id: string }>
      count: number
    }>("/store/customers/me/addresses", { bearer: jwtA })
    expect(list.status).toBe(200)
    expect(list.body?.count).toBe(2)

    // Чтение одного адреса
    const one = await storeFetch<{ address: { id: string; city: string | null } }>(
      `/store/customers/me/addresses/${shippingAddress?.id}`,
      { bearer: jwtA }
    )
    expect(one.status).toBe(200)
    expect(one.body?.address.id).toBe(shippingAddress?.id)

    // Изменение
    const updated = await storeFetch<CustomerBody>(
      `/store/customers/me/addresses/${shippingAddress?.id}`,
      {
        method: "POST",
        body: { city: "Казань", postal_code: "420000" },
        bearer: jwtA,
      }
    )
    expect(updated.status).toBe(200)
    const updatedAddress = updated.body?.customer.addresses.find(
      (address) => address.id === shippingAddress?.id
    )
    expect(updatedAddress?.city).toBe("Казань")

    // Смена дефолтного адреса доставки: новый флаг снимает старый
    const newDefault = await storeFetch<CustomerBody>(
      "/store/customers/me/addresses",
      {
        method: "POST",
        body: { ...addressBody, city: "Владивосток", is_default_shipping: true },
        bearer: jwtA,
      }
    )
    expect(newDefault.status).toBe(200)
    const defaults = newDefault.body?.customer.addresses.filter(
      (address) => address.is_default_shipping
    )
    expect(defaults?.length).toBe(1)
    expect(defaults?.[0]?.city).toBe("Владивосток")
    const newDefaultId = defaults?.[0]?.id ?? ""

    // Удаление
    const removed = await storeFetch<Record<string, unknown>>(
      `/store/customers/me/addresses/${newDefaultId}`,
      { method: "DELETE", bearer: jwtA }
    )
    expect(removed.status).toBe(200)
    expect(removed.body?.deleted).toBe(true)

    const gone = await storeFetch(`/store/customers/me/addresses/${newDefaultId}`, {
      bearer: jwtA,
    })
    expect(gone.status).toBe(404)
  })

  it("чужой адрес недоступен: чтение/изменение/удаление → 404, владелец продолжает работать", async () => {
    const B = await registerCustomer(
      `spec-53-b-${runStamp}@example.com`,
      "Борис"
    )
    const created = await storeFetch<CustomerBody>(
      "/store/customers/me/addresses",
      {
        method: "POST",
        body: {
          first_name: "Борис",
          last_name: "Спек",
          address_1: "ул. Чужая, 1",
          city: "Пермь",
          country_code: "ru",
        },
        bearer: B.jwt,
      }
    )
    expect(created.status).toBe(200)
    const bAddress = created.body?.customer.addresses[0]?.id ?? ""
    expect(bAddress).toBeTruthy()

    const strangerRead = await storeFetch(
      `/store/customers/me/addresses/${bAddress}`,
      { bearer: jwtA }
    )
    expect(strangerRead.status).toBe(404)

    const strangerUpdate = await storeFetch(
      `/store/customers/me/addresses/${bAddress}`,
      { method: "POST", body: { city: "Взлом" }, bearer: jwtA }
    )
    expect(strangerUpdate.status).toBe(404)

    const strangerDelete = await storeFetch(
      `/store/customers/me/addresses/${bAddress}`,
      { method: "DELETE", bearer: jwtA }
    )
    expect(strangerDelete.status).toBe(404)

    const ownerRead = await storeFetch<{ address: { id: string; city: string | null } }>(
      `/store/customers/me/addresses/${bAddress}`,
      { bearer: B.jwt }
    )
    expect(ownerRead.status).toBe(200)
    expect(ownerRead.body?.address.city).toBe("Пермь")
  })

  // ── Корзина и заказы ────────────────────────────────────────────────

  it("новая корзина под Bearer привязывается автоматически (customer_id из auth context)", async () => {
    const cart = await storeFetch<CartBody>("/store/carts", {
      method: "POST",
      body: { region_id: regionId },
      bearer: jwtA,
    })
    expect(cart.status).toBe(200)
    expect(cart.body?.cart.customer_id).toBe(customerIdA)
  })

  it("конкурентное изменение корзины во время claim: позиции не теряются, владелец зафиксирован", async () => {
    const cartId = await createGuestCart()
    const first = await storeFetch<CartBody>(
      `/store/carts/${cartId}/line-items`,
      { method: "POST", body: { variant_id: variantId, quantity: 1 } }
    )
    expect(first.status).toBe(200)

    // claim (под advisory-локом) и гостевое добавление позиции стартуют
    // одновременно; add после фиксации владельца получит 404 — это
    // корректный guard, важна целостность состояния
    const [claim, add] = await Promise.all([
      storeFetch<CartBody>(`/store/carts/${cartId}/customer`, {
        method: "POST",
        body: {},
        bearer: jwtA,
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return storeFetch<CartBody>(`/store/carts/${cartId}/line-items`, {
          method: "POST",
          body: { variant_id: variantId, quantity: 2 },
        })
      })(),
    ])

    expect(claim.status).toBe(200)
    expect(claim.body?.cart.customer_id).toBe(customerIdA)
    expect([200, 404]).toContain(add.status)

    const final = await storeFetch<CartBody>(`/store/carts/${cartId}`, {
      bearer: jwtA,
    })
    expect(final.status).toBe(200)
    expect(final.body?.cart.customer_id).toBe(customerIdA)
    const quantity = (final.body?.cart.items ?? []).reduce(
      (sum, item) => sum + item.quantity,
      0
    )
    // Позиция, существовавшая до claim, сохранена; конкурентная — по
    // результату гонки (add 200 → +2, add 404 → без нее)
    expect(quantity).toBe(add.status === 200 ? 3 : 1)
  })

  it("гостевые заказы не наследуются при регистрации; гостевой доступ по x-cart-id сохраняется до transfer", async () => {
    // Гостевой checkout с email будущего покупателя
    const cartId = await createGuestCart()
    guestOrderCartId = cartId
    await storeFetch(`/store/carts/${cartId}`, {
      method: "POST",
      body: {
        email: emailGuest,
        shipping_address: {
          first_name: "Гость",
          last_name: "Спек",
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
    const options = await storeFetch<{
      shipping_options: Array<{ id: string }>
    }>(`/store/shipping-options?cart_id=${cartId}`)
    await storeFetch(`/store/carts/${cartId}/shipping-methods`, {
      method: "POST",
      body: { option_id: options.body?.shipping_options[0]?.id },
    })
    const pc = await storeFetch<{ payment_collection: { id: string } }>(
      "/store/payment-collections",
      { method: "POST", body: { cart_id: cartId } }
    )
    await storeFetch(
      `/store/payment-collections/${pc.body?.payment_collection.id}/payment-sessions`,
      { method: "POST", body: { provider_id: "pp_demo_online" } }
    )
    const done = await storeFetch<{ order: { id: string } }>(
      `/store/carts/${cartId}/complete`,
      { method: "POST", body: {} }
    )
    expect(done.status).toBe(200)
    const orderId = done.body?.order.id
    expect(orderId).toBeTruthy()
    createdOrderIds.push(orderId)

    // До регистрации: голый id — 404, верный proof — 200
    expect((await storeFetch(`/store/orders/${orderId}`)).status).toBe(404)
    const proved = await storeFetch<{ order: { email: string | null } }>(
      `/store/orders/${orderId}`,
      { guestProof: cartId }
    )
    expect(proved.status).toBe(200)
    expect(proved.body?.order.email).toBe(emailGuest)

    // Регистрация с тем же email НЕ наследует гостевой заказ
    const guest = await registerCustomer(emailGuest, "Гость")
    jwtGuest = guest.jwt
    const history = await storeFetch<{ orders: Array<{ id: string }>; count: number }>(
      "/store/orders",
      { bearer: jwtGuest }
    )
    expect(history.status).toBe(200)
    expect(
      (history.body?.orders ?? []).some((order) => order.id === orderId)
    ).toBe(false)

    // ...и не закрывает гостевой доступ (перенос — только transfer)
    const provedStill = await storeFetch(`/store/orders/${orderId}`, {
      guestProof: cartId,
    })
    expect(provedStill.status).toBe(200)
  })

  it("transfer: accept переносит заказ покупателю и закрывает гостевой доступ (x-cart-id)", async () => {
    // Гостевой заказ из предыдущего теста; proof — его собственная корзина
    const guestOrder = createdOrderIds[createdOrderIds.length - 1]
    expect(guestOrder).toBeTruthy()
    expect(guestOrderCartId).toBeTruthy()
    expect(jwtGuest).toBeTruthy()

    // Легитимный инициатор — покупатель с email заказа (guard 5.2.1)
    const request = await storeFetch(`/store/orders/${guestOrder}/transfer/request`, {
      method: "POST",
      body: {},
      bearer: jwtGuest,
    })
    expect(request.status).toBe(200)

    // Токен подтверждения — одноразовый UUID в order change action (в
    // Store API-ответе его нет); витрина получает его письмом (5.2.3),
    // тест извлекает его штатным Admin API (order_changes → actions)
    const changes = await adminFetch<{
      order_changes: Array<{
        id: string
        status: string
        actions: Array<{ details: { token?: string } | null }>
      }>
    }>(`/admin/orders/${guestOrder}/changes`)
    expect(changes.status).toBe(200)
    const change = changes.body?.order_changes.find((entry) =>
      (entry.actions ?? []).some((action) => action.details?.token)
    )
    const token: string =
      change?.actions.map((action) => action.details?.token).find(Boolean) ?? ""
    expect(token).toBeTruthy()
    // Токен не попадает в Store API-ответ request
    expect(JSON.stringify(request.body)).not.toContain(token)

    const accept = await storeFetch(`/store/orders/${guestOrder}/transfer/accept`, {
      method: "POST",
      body: { token },
    })
    expect(accept.status).toBe(200)

    // Заказ у правильного покупателя
    const history = await storeFetch<{ orders: Array<{ id: string }> }>(
      "/store/orders",
      { bearer: jwtGuest }
    )
    expect(
      (history.body?.orders ?? []).some((order) => order.id === guestOrder)
    ).toBe(true)

    // Гостевой proof больше не открывает заказ: после transfer это заказ
    // зарегистрированного покупателя (доступ — только владельцу)
    const provedAfter = await storeFetch(`/store/orders/${guestOrder}`, {
      guestProof: guestOrderCartId,
    })
    expect(provedAfter.status).toBe(404)

    // Владелец читает по JWT, посторонний — 404
    const ownerRead = await storeFetch(`/store/orders/${guestOrder}`, {
      bearer: jwtGuest,
    })
    expect(ownerRead.status).toBe(200)
    const strangerRead = await storeFetch(`/store/orders/${guestOrder}`, {
      bearer: jwtA,
    })
    expect(strangerRead.status).toBe(404)
  })
})

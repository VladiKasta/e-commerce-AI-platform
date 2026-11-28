import { beforeAll, afterAll, describe, expect, it } from "vitest"

/**
 * Интеграционные тесты email-уведомлений через штатный Notification Module
 * (этап 5.2.3; архитектура — решение №39 в docs/PROGRESS.md).
 *
 * Живое окружение: Medusa Store API + Mailpit (SMTP-ящик, MAILPIT_HOST).
 * Письма читаются из Mailpit API; reset-/transfer-токены извлекаются и
 * используются, но НЕ печатаются в вывод тестов (console.log токенов нет).
 *
 * Покрыто:
 * - сброс пароля: письмо в Mailpit (HTML + plain text, русский, название
 *   магазина, ссылка на будущую страницу витрины без жестко заданного
 *   домена), одноразовость токена, вход с новым паролем, старый не работает;
 * - несуществующий email: письма нет (событие эмитится только для
 *   существующих identity — перечисление email невозможно);
 * - перенос заказа: письмо на email заказа (не инициатору), токен не
 *   раскрывается в API-ответе, accept переносит заказ правильному
 *   покупателю;
 * - ровно одно письмо на сценарий (идемпотентность доставки).
 *
 * Сознательно НЕ покрыто автотестами (проверено живыми пробами 27.11.2026,
 * см. PROGRESS.md — таблицу этапа 5.2.3): недоступность SMTP (нельзя
 * останавливать контейнер Mailpit из теста) и scheduled job повторной
 * доставки (окно cron больше времени теста).
 *
 * Побочный эффект: тестовые покупатели/identity, один гостевой заказ и
 * строки notification не удаляются (API удаления нет — зафиксировано в
 * PROGRESS.md); резервирование инвентаря заказа удаляется в afterAll.
 */

const mailpitUrl =
  process.env.MAILPIT_HOST ?? process.env.MAILPIT_URL ?? ""

const baseUrl =
  process.env.NUXT_MEDUSA_URL ??
  process.env.MEDUSA_URL ??
  "http://localhost:9000"

const publishableKey =
  process.env.NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  process.env.MEDUSA_PUBLISHABLE_KEY

type ApiResult<T> = { status: number; body: T | null }

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
  return { status: res.status, body }
}

function storeFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; bearer?: string | null }
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "x-publishable-api-key": publishableKey,
  }
  if (init?.bearer) headers.authorization = `Bearer ${init.bearer}`
  return rawFetch<T>(path, { method: init?.method, body: init?.body, headers })
}

// ── Mailpit API ────────────────────────────────────────────────────────────

type MailpitMessage = {
  ID: string
  To: Array<{ Address: string }>
  Subject: string
}

async function mailpitJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${mailpitUrl}${path}`)
  if (!res.ok) return null
  return (await res.json()) as T
}

/** Письма получателю (только его — чужие письма в ящике игнорируются). */
async function lettersTo(address: string): Promise<string[]> {
  const data = await mailpitJson<{ messages: MailpitMessage[] }>(
    "/api/v1/messages?limit=100"
  )
  return (data?.messages ?? [])
    .filter((message) => message.To.some((to) => to.Address === address))
    .map((message) => message.ID)
}

/** Полное письмо (HTML/Text) по id. */
async function letterBody(
  id: string
): Promise<{ Subject: string; Text: string; HTML: string } | null> {
  return mailpitJson<{ Subject: string; Text: string; HTML: string }>(
    `/api/v1/message/${id}`
  )
}

/** Ждет письмо получателю (доставка асинхронная), выдает его id. */
async function waitForLetter(
  address: string,
  minimumCount = 1
): Promise<string[]> {
  const deadline = Date.now() + 15_000
  let ids: string[] = []
  while (Date.now() < deadline) {
    ids = await lettersTo(address)
    if (ids.length >= minimumCount) return ids
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return ids
}

/** Токен из письма (без печати в вывод теста). */
function extractToken(html: string, pagePath: string): { token: string; link: string } {
  const match = new RegExp(`href="([^"]*${pagePath}\\?[^"]*)"`).exec(html)
  if (!match) throw new Error(`Ссылка на ${pagePath} не найдена в письме`)
  const link = match[1].replaceAll("&amp;", "&")
  const token = new RegExp("token=([^&\\s]+)").exec(link)?.[1] ?? ""
  if (!token) throw new Error("token не найден в ссылке письма")
  return { token: decodeURIComponent(token), link }
}

const runStamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`
const storeName = "Demo Store"

interface CartBody {
  cart: { id: string }
}

interface TokenBody {
  token: string
}

interface OrderBody {
  order: { id: string }
}

describe.skipIf(!mailpitUrl)(
  "5.2.3: email-уведомления (Notification Module + Mailpit)",
  () => {
    const adminEmail = process.env.ADMIN_EMAIL
    const adminPassword = process.env.ADMIN_PASSWORD
    let adminToken = ""
    let regionId = ""
    let variantId = ""
    let shippingOptionId = ""
    const createdOrderIds: string[] = []

    beforeAll(async () => {
      expect(mailpitUrl, "MAILPIT_HOST обязателен для этих тестов").toBeTruthy()
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

      const probeCart = await storeFetch<CartBody>("/store/carts", {
        method: "POST",
        body: { region_id: regionId },
      })
      const options = await storeFetch<{
        shipping_options: Array<{ id: string }>
      }>(`/store/shipping-options?cart_id=${probeCart.body?.cart.id}`)
      shippingOptionId = options.body?.shipping_options[0]?.id ?? ""
      if (!shippingOptionId) throw new Error("Seed-опции доставки не найдены")
    })

    afterAll(async () => {
      for (const orderId of createdOrderIds) {
        try {
          const detail = await rawFetch<{
            order: { items: Array<{ id: string }> | null }
          }>(`/admin/orders/${orderId}`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          })
          for (const item of detail.body?.order.items ?? []) {
            const found = await rawFetch<{
              reservations: Array<{ id: string }>
            }>(`/admin/reservations?line_item_id=${item.id}`, {
              headers: { Authorization: `Bearer ${adminToken}` },
            })
            for (const reservation of found.body?.reservations ?? []) {
              await rawFetch(`/admin/reservations/${reservation.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${adminToken}` },
              })
            }
          }
        } catch {
          // Очистка best-effort — эффект задокументирован
        }
      }
    })

    it("сброс пароля: письмо (HTML+text, русский, магазин, ссылка витрины), смена пароля, вход, одноразовость", async () => {
      const email = `spec-523-reset-${runStamp}@example.com`
      const oldPassword = `Spec-523-old-${runStamp}`
      const newPassword = `Spec-523-new-${runStamp}`

      const register = await rawFetch<TokenBody>(
        "/auth/customer/emailpass/register",
        { method: "POST", body: { email, password: oldPassword } }
      )
      expect(register.status).toBe(200)

      const reset = await rawFetch<unknown>(
        "/auth/customer/emailpass/reset-password",
        { method: "POST", body: { identifier: email } }
      )
      expect(reset.status).toBe(201)
      expect(reset.body).toBeNull()

      const letters = await waitForLetter(email)
      expect(letters.length).toBe(1)
      const letter = (await letterBody(letters[0]))!
      expect(letter.Subject).toContain(storeName)

      const { token, link } = extractToken(letter.HTML, "/reset-password")
      expect(link).toContain(`email=${encodeURIComponent(email)}`)
      expect(link.startsWith("http")).toBe(true)

      // Plain text с той же ссылкой и ограничением срока действия.
      expect(letter.Text).toContain("одноразовая")
      expect(letter.Text).toContain("15 минут")
      expect(letter.Text).toContain(token)

      const update = await rawFetch<{ success?: boolean }>(
        "/auth/customer/emailpass/update",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: { password: newPassword },
        }
      )
      expect(update.status).toBe(200)
      expect(update.body?.success).toBe(true)

      const loginNew = await rawFetch<TokenBody>(
        "/auth/customer/emailpass",
        { method: "POST", body: { email, password: newPassword } }
      )
      expect(loginNew.status).toBe(200)

      const loginOld = await rawFetch<TokenBody>(
        "/auth/customer/emailpass",
        { method: "POST", body: { email, password: oldPassword } }
      )
      expect(loginOld.status).toBe(401)

      const reuse = await rawFetch<unknown>(
        "/auth/customer/emailpass/update",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: { password: "Spec-523-reuse-Aa!" },
        }
      )
      expect(reuse.status).toBe(401)

      // Ровно одно письмо на сценарий (дублей от повторной обработки нет).
      const finalLetters = await lettersTo(email)
      expect(finalLetters.length).toBe(1)
    }, 30_000)

    it("сброс пароля: несуществующий email — письма нет (перечисление невозможно)", async () => {
      const ghost = `spec-523-ghost-${runStamp}@example.com`
      const reset = await rawFetch<unknown>(
        "/auth/customer/emailpass/reset-password",
        { method: "POST", body: { identifier: ghost } }
      )
      expect(reset.status).toBe(201)

      const letters = await waitForLetter(ghost)
      expect(letters.length).toBe(0)
    }, 25_000)

    it("перенос заказа: письмо на email заказа, токен не в API-ответе, accept переносит заказ покупателю", async () => {
      const email = `spec-523-transfer-${runStamp}@example.com`
      const password = `Spec-523-tr-${runStamp}`

      // Гостевой заказ с email, совпадающим с email будущего покупателя
      // (легитимный инициатор переноса — семантика 5.2.1).
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
            last_name: "Уведомлений",
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
        { method: "POST", body: { provider_id: "pp_demo_online" } }
      )
      const done = await storeFetch<OrderBody>(
        `/store/carts/${cartId}/complete`,
        { method: "POST", body: {} }
      )
      const orderId = done.body?.order.id
      expect(orderId).toBeTruthy()
      createdOrderIds.push(orderId)

      // Покупатель с тем же email → легитимный инициатор.
      const register = await rawFetch<TokenBody>(
        "/auth/customer/emailpass/register",
        { method: "POST", body: { email, password } }
      )
      expect(register.status).toBe(200)
      await storeFetch("/store/customers", {
        method: "POST",
        body: { email, first_name: "Спек" },
        bearer: register.body?.token,
      })
      const login = await rawFetch<TokenBody>("/auth/customer/emailpass", {
        method: "POST",
        body: { email, password },
      })
      const bearer = login.body?.token ?? ""

      const request = await storeFetch<Record<string, unknown>>(
        `/store/orders/${orderId}/transfer/request`,
        { method: "POST", body: {}, bearer }
      )
      expect(request.status).toBe(200)

      const letters = await waitForLetter(email)
      expect(letters.length).toBe(1)
      const letter = (await letterBody(letters[0]))!
      expect(letter.Subject).toContain(storeName)

      const { token, link } = extractToken(
        letter.HTML,
        "/account/order-transfer"
      )
      expect(link).toContain(`order_id=${encodeURIComponent(orderId)}`)
      expect(letter.Text).toContain("одноразовая")

      // Токен не раскрывается API-ответом request — только письмом.
      expect(JSON.stringify(request.body)).not.toContain(token)

      const accept = await storeFetch<Record<string, unknown>>(
        `/store/orders/${orderId}/transfer/accept`,
        { method: "POST", body: { token } }
      )
      expect(accept.status).toBe(200)

      // Заказ появляется у правильного покупателя.
      const history = await storeFetch<{
        orders: Array<{ id: string }>
      }>("/store/orders", { bearer })
      expect(history.body?.orders.some((order) => order.id === orderId)).toBe(
        true
      )

      // Повторный accept тем же токеном отклоняется (одноразовость).
      const reuse = await storeFetch<Record<string, unknown>>(
        `/store/orders/${orderId}/transfer/accept`,
        { method: "POST", body: { token } }
      )
      expect(reuse.status).toBe(400)

      const finalLetters = await lettersTo(email)
      expect(finalLetters.length).toBe(1)
    }, 30_000)
  }
)

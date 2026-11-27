import type { NotificationTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Реестр email-шаблонов SMTP-провайдера (этап 5.2.3).
 *
 * Контракт: подписчики передают логическое имя шаблона (template) и данные
 * (data); провайдер рендерит тему, HTML и plain text. Русский язык —
 * по умолчанию; название магазина и адрес витрины приходят из корневого .env
 * (STORE_NAME, NUXT_PUBLIC_SITE_URL) через опции провайдера — жестко заданного
 * домена нет.
 *
 * Переопределение шаблона или добавление нового (например, «заказ оформлен»):
 * измените/добавьте функцию в TEMPLATES и поместите имя в TEMPLATE_NAMES —
 * подписчики и инфраструктура не меняются (см. docs/notifications.md).
 * Визуальный редактор шаблонов сознательно не реализуется.
 */

/** Контекст рендера из опций провайдера (medusa-config.ts ← .env). */
export type TemplateRenderContext = {
  store_name: string
  site_url: string
}

export type RenderedEmail = {
  subject: string
  text: string
  html: string
}

type TemplateData = Record<string, unknown>

/** Экранирование пользовательских данных в HTML (XSS/разрыв разметки). */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function str(data: TemplateData, key: string): string {
  const value = data[key]
  if (typeof value !== "string" || value === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Шаблону не хватает данных: "${key}"`
    )
  }
  return value
}

/** Ссылка с токеном: токен экранируется для URL, URL — для HTML-атрибута. */
function link(siteUrl: string, path: string, params: Array<[string, string]>): string {
  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")
  return `${siteUrl.replace(/\/$/, "")}${path}?${query}`
}

/** Каркас письма: единый минимальный стиль без внешних ресурсов. */
function wrapHtml(storeName: string, title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td style="padding-bottom:8px;font-size:14px;color:#71717a;">${escapeHtml(storeName)}</td></tr>
      <tr><td style="padding-bottom:16px;font-size:20px;font-weight:600;">${escapeHtml(title)}</td></tr>
      <tr><td style="padding-bottom:24px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
      <tr><td style="font-size:13px;color:#a1a1aa;">Это автоматическое письмо магазина «${escapeHtml(storeName)}». Не отвечайте на него.</td></tr>
    </table>
  </td></tr></table>
</body>
</html>`
}

/** Кнопка-ссылка + дублирующая ссылка текстом (если клик запрещен). */
function actionLink(url: string): string {
  const htmlUrl = escapeHtml(url)
  return `<p style="padding-bottom:16px;"><a href="${htmlUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;">Открыть ссылку</a></p>
<p style="padding-bottom:16px;font-size:13px;color:#71717a;word-break:break-all;">Или скопируйте ссылку в адресную строку:<br>${htmlUrl}</p>`
}

// ── Шаблон: восстановление пароля ───────────────────────────────────────────
// data: { token, email } — из события auth.password_reset (email = entity_id,
// событие эмитится только для существующих identity).

function renderPasswordReset(
  data: TemplateData,
  ctx: TemplateRenderContext
): RenderedEmail {
  const email = str(data, "email")
  const token = str(data, "token")
  const url = link(ctx.site_url, "/reset-password", [
    ["token", token],
    ["email", email],
  ])
  const subject = `Сброс пароля — ${ctx.store_name}`
  const text = [
    "Здравствуйте!",
    "",
    `Вы запросили сброс пароля в магазине «${ctx.store_name}» для аккаунта ${email}.`,
    "",
    "Откройте ссылку и задайте новый пароль:",
    url,
    "",
    "Ссылка одноразовая и действует 15 минут.",
    "Если вы не запрашивали сброс пароля, проигнорируйте это письмо — пароль останется прежним.",
  ].join("\n")
  const html = wrapHtml(
    ctx.store_name,
    "Сброс пароля",
    `<p>Вы запросили сброс пароля для аккаунта <strong>${escapeHtml(email)}</strong>.</p>
${actionLink(url)}
<p>Ссылка одноразовая и действует 15 минут. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо — пароль останется прежним.</p>`
  )
  return { subject, text, html }
}

// ── Шаблон: подтверждение переноса заказа ───────────────────────────────────
// data: { token, email, display_id, order_id } — из события
// order.transfer_requested (получатель — email заказа, не инициатор).

function renderOrderTransfer(
  data: TemplateData,
  ctx: TemplateRenderContext
): RenderedEmail {
  const email = str(data, "email")
  const token = str(data, "token")
  const displayId = str(data, "display_id")
  const orderId = str(data, "order_id")
  const url = link(ctx.site_url, "/account/order-transfer", [
    ["token", token],
    ["order_id", orderId],
  ])
  const subject = `Подтверждение переноса заказа №${displayId} — ${ctx.store_name}`
  const text = [
    "Здравствуйте!",
    "",
    `Поступил запрос на перенос заказа №${displayId} в магазине «${ctx.store_name}» на аккаунт покупателя ${email}.`,
    "",
    "Если это ваш заказ и вы хотите перенести его в свой аккаунт, подтвердите перенос по ссылке:",
    url,
    "",
    "Ссылка одноразовая. Если вы не инициировали перенос, проигнорируйте это письмо — заказ останется без изменений.",
  ].join("\n")
  const html = wrapHtml(
    ctx.store_name,
    `Перенос заказа №${escapeHtml(displayId)}`,
    `<p>Поступил запрос на перенос заказа <strong>№${escapeHtml(displayId)}</strong> на аккаунт покупателя <strong>${escapeHtml(email)}</strong>.</p>
${actionLink(url)}
<p>Если вы не инициировали перенос, проигнорируйте это письмо — заказ останется без изменений.</p>`
  )
  return { subject, text, html }
}

const TEMPLATES: Record<
  string,
  (data: TemplateData, ctx: TemplateRenderContext) => RenderedEmail
> = {
  "customer-password-reset": renderPasswordReset,
  "order-transfer-request": renderOrderTransfer,
}

/** Имена шаблонов (для диагностики неизвестного template). */
export const TEMPLATE_NAMES = Object.keys(TEMPLATES)

export function renderTemplate(
  notification: NotificationTypes.ProviderSendNotificationDTO,
  ctx: TemplateRenderContext
): RenderedEmail | null {
  const render = TEMPLATES[notification.template]
  if (!render) {
    return null
  }
  return render((notification.data as TemplateData) ?? {}, ctx)
}

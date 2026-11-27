import SmtpNotificationService from "./service"

/**
 * Регистрация SMTP-провайдера для штатного Notification Module Medusa.
 * Разрешение в medusa-config.ts (этап 5.2.3):
 *
 *   modules: [
 *     {
 *       resolve: "@medusajs/medusa/notification",
 *       options: {
 *         providers: [
 *           {
 *             resolve: "./src/modules/notification-smtp/providers/smtp",
 *             id: "smtp",
 *             options: { channels: ["email"], host: ..., from_email: ... },
 *           },
 *         ],
 *       },
 *     },
 *   ]
 *
 * Провайдер обслуживает канал email; замена SMTP-сервера — переменные .env,
 * замена провайдера (например, на SendGrid) — запись в providers без
 * изменения подписчиков и шаблонов. См. docs/notifications.md.
 */
export default {
  services: [SmtpNotificationService],
}

import DemoOnlinePaymentProvider from "./service"

/**
 * Регистрация провайдера «Тестовая онлайн-оплата» для штатного Payment
 * Module Medusa (этап 6.2, решение №41 в docs/PROGRESS.md):
 *
 *   modules: [
 *     {
 *       resolve: "@medusajs/medusa/payment",
 *       options: {
 *         providers: [
 *           {
 *             resolve: "./src/modules/payment-demo-online/providers/demo",
 *             id: "online",
 *             options: { webhook_secret: process.env.PAYMENT_DEMO_WEBHOOK_SECRET },
 *           },
 *         ],
 *       },
 *     },
 *   ]
 *
 * Итоговый id провайдера — `pp_demo_online` (pp_{identifier}_{id}).
 * Провайдер фиктивен (денег не двигает) и предназначен только для
 * development/test: в production регистрация исключена условием в
 * medusa-config.ts, а static validateOptions провайдера блокирует
 * регистрацию принудительно. Webhook-секрет — только backend
 * (PAYMENT_DEMO_WEBHOOK_SECRET, корневой .env). Контракт, исходы
 * (success/decline/pending), HMAC-подпись и тестовые сценарии —
 * docs/payments.md.
 */
export default {
  services: [DemoOnlinePaymentProvider],
}

import CodPaymentProvider from "./service"

/**
 * Регистрация провайдера «Оплата при получении» для штатного Payment Module
 * Medusa (этап 6.2, решение №41 в docs/PROGRESS.md):
 *
 *   modules: [
 *     {
 *       resolve: "@medusajs/medusa/payment",
 *       options: {
 *         providers: [
 *           { resolve: "./src/modules/payment-cod/providers/cod", id: "cash" },
 *         ],
 *       },
 *     },
 *   ]
 *
 * Итоговый id провайдера — `pp_cod_cash` (pp_{identifier}_{id}). Провайдер
 * доступен во всех окружениях, включая production: платеж принимается
 * офлайн при вручении заказа, подтверждение — штатный Capture в Medusa
 * Admin. Семантика статусов и сценарии — docs/payments.md.
 */
export default {
  services: [CodPaymentProvider],
}

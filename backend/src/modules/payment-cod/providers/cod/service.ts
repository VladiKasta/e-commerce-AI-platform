import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"

/**
 * Оплата при получении (cash on delivery) — демонстрационный провайдер
 * этапа 6.2 на штатном контракте AbstractPaymentProvider (решение №41 в
 * docs/PROGRESS.md). Провайдер не создает собственного платежного модуля
 * и таблиц: жизненный цикл, статусы, ограничения сумм и идемпотентность —
 * штатные механизмы Payment Module Medusa 2.23.
 *
 * Семантика (docs/payments.md):
 *
 * - `authorizePayment` всегда возвращает "authorized" — это ТЕХНИЧЕСКАЯ
 *   авторизация платежной сессии, обязательная для completeCartWorkflow.
 *   Она НЕ означает получение денег: платеж создается с `captured_at: null`,
 *   заказ — с `payment_status: "authorized"` (не captured) и
 *   `summary.paid_total: 0` (подтверждено живой пробой этапа 6.1).
 * - Получение денег подтверждает администратор штатным Capture в Medusa
 *   Admin (`POST /admin/payments/:id/capture`): заказ переходит в captured.
 * - `capturePayment` — фиксация ручного получения наличных при вручении
 *   заказа; списание сумм и границы (≤ авторизованной суммы) контролирует
 *   ядро.
 * - `refundPayment` — фиксация РУЧНОЙ финансовой операции (возврат наличных
 *   из кассы); провайдер ничего не отправляет покупателю автоматически.
 * - `cancelPayment` — отмена неоплаченного заказа отменяет uncaptured
 *   платеж штатным workflow отмены заказа.
 * - Webhook-и не поддерживаются: способ офлайн, `not_supported`.
 *
 * Провайдер доступен во всех окружениях, включая production (опций нет,
 * валидация окружения не требуется).
 */
export class CodPaymentProvider extends AbstractPaymentProvider {
  static identifier = "cod"

  constructor(
    _cradle: Record<string, unknown>,
    _options?: Record<string, unknown>
  ) {
    super(_cradle, _options)
  }

  async initiatePayment(
    _input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    return { id: randomUUID(), data: {} }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    return { status: "authorized", data: input.data ?? {} }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    // Сумма и границы списания контролирует Payment Module (≤ авторизованной
    // суммы, идемпотентность после полного capture) — здесь только фиксация.
    return { data: input.data ?? {} }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    // Ручная финансовая операция (возврат наличных) — см. докстринг класса.
    return { data: input.data ?? {} }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data ?? {} }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async getPaymentStatus(
    _input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    return { status: "authorized" }
  }

  async getWebhookActionAndData(): Promise<WebhookActionResult> {
    // Офлайн-способ: событий эквайринга нет, ядро игнорирует not_supported.
    return { action: "not_supported" }
  }
}

export default CodPaymentProvider

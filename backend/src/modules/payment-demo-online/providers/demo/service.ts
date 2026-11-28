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
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
} from "@medusajs/framework/utils"
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

/** Исходы тестовой оплаты; выбираются данными сессии (для тестов). */
export const DEMO_OUTCOMES = ["success", "decline", "pending"] as const
export type DemoOutcome = (typeof DEMO_OUTCOMES)[number]

/** Заголовок HMAC-подписи webhook-а (hex, HMAC-SHA256 над raw body). */
export const DEMO_WEBHOOK_SIGNATURE_HEADER = "x-demo-signature"

/** Поддерживаемые действия webhook-а. */
const DEMO_WEBHOOK_ACTIONS = ["authorized", "captured"] as const
type DemoWebhookAction = (typeof DEMO_WEBHOOK_ACTIONS)[number]

export type DemoOnlineProviderOptions = {
  /** Секрет HMAC webhook-а; только backend (PAYMENT_DEMO_WEBHOOK_SECRET). */
  webhook_secret: string
}

type DemoSessionData = {
  id?: string
  outcome?: DemoOutcome
  client?: Record<string, unknown>
}

/** Валидация исхода: произвольные клиентские данные не принимаются молча. */
export function parseDemoOutcome(
  value: unknown,
  fallback: DemoOutcome = "success"
): DemoOutcome {
  if (value === undefined || value === null || value === "") {
    return fallback
  }
  if (typeof value === "string" && (DEMO_OUTCOMES as readonly string[]).includes(value)) {
    return value as DemoOutcome
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Unknown demo payment outcome: ${String(value)}. Expected one of: ${DEMO_OUTCOMES.join(", ")}`
  )
}

/**
 * Тестовая онлайн-оплата — демонстрационный провайдер этапа 6.2 на штатном
 * контракте AbstractPaymentProvider (решение №41 в docs/PROGRESS.md).
 * ЗАМЕНА реального эквайринга; денег не двигает.
 *
 * **Production-защита (двойная):** провайдер не регистрируется в
 * medusa-config.ts при NODE_ENV=production, а `static validateOptions`
 * (вызывается загрузчиком при регистрации) бросает ошибку в production —
 * зарегистрировать фиктивную онлайн-оплату нельзя даже вручную (fail-fast
 * старта, по образцу MAILPIT_ENABLED, этап 5.2.3).
 *
 * Детерминированные исходы (для тестов 6.5) выбираются полем `outcome`
 * в данных сессии (`data` при создании либо `client_data` при обновлении
 * через штатные Store-маршруты) и валидируются строгим списком:
 * - `success` (по умолчанию) — authorizePayment → "authorized";
 * - `decline` — authorizePayment бросает MedusaError → complete падает
 *   штатной ошибкой авторизации платежа («отказ в оплате»);
 * - `pending` — authorizePayment → "pending_authorization": заказ
 *   создается со `payment_status: "awaiting"` (штатная отложенная
 *   авторизация), подтверждение — подписанный webhook (см. ниже).
 *
 * Webhook (штатный маршрут `POST /hooks/payment/pp_demo_online`):
 * тело `{event_type: "authorized"|"captured", session_id, amount}`,
 * подпись — HMAC-SHA256 (hex) над raw body в заголовке `x-demo-signature`
 * секретом из backend-опций. Подпись проверяется timing-safe; неверная
 * подпись/формат → `not_supported` (событие игнорируется, состояние не
 * меняется).
 *
 * Подтверждение отложенной сессии — штатный механизм Medusa: webhook
 * возвращает действие `authorized`/`captured`, ядро повторно вызывает
 * `authorizePayment`, и провайдер подтверждает сессию. Поэтому провайдер
 * хранит минимальное состояние «банка» — in-memory набор подтвержденных
 * session_id (штатный `context.idempotency_key` = id сессии): подписанный
 * webhook помечает сессию подтвержденной, следующий authorizePayment
 * возвращает "authorized". Ограничения (сознательные, документированы в
 * docs/payments.md): состояние в памяти процесса — перезапуск стирает
 * неподтвержденные переводы (как реальный банк без подтверждения),
 * мультиинстансность не поддерживается (демо-провайдер; реальный
 * провайдер хранит состояние у себя в API). Повторная доставка webhook-а
 * идемпотентна штатными механизмами (authorize/capture).
 *
 * Дальнейшие проверки — штатные: сумма capture из webhook ограничена
 * авторизованной суммой сессии (ядро), валюта платежа — валюта сессии
 * (заявки webhook-а о валюте игнорируются), событие без session_id ядро
 * отбрасывает. Провайдер не обращается к БД: несуществующая сессия
 * приводит к безопасному провалу штатного workflow без изменений
 * состояния (подтверждено аудитом 6.1).
 *
 * Суммы, статусы, идемпотентность (повторный authorize/capture, refund по
 * idempotency_key), ограничения операций — исключительно штатные механизмы
 * Payment Module; провайдер собственной платежной бизнес-логики не дублирует.
 */
class DemoOnlinePaymentProvider extends AbstractPaymentProvider<DemoOnlineProviderOptions> {
  static identifier = "demo"

  static validateOptions(options: Record<string, unknown>): void {
    if (process.env.NODE_ENV === "production") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Demo online payment provider (payment-demo-online) must not be registered in production: fictitious online payments are forbidden (решение №41). Remove the provider from medusa-config.ts for NODE_ENV=production."
      )
    }
    const secret =
      typeof options?.webhook_secret === "string" && options.webhook_secret
        ? options.webhook_secret
        : null
    if (!secret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "webhook_secret is required for the demo online payment provider (PAYMENT_DEMO_WEBHOOK_SECRET in .env)."
      )
    }
  }

  constructor(
    cradle: Record<string, unknown>,
    options: DemoOnlineProviderOptions
  ) {
    super(cradle, options)
  }

  /**
   * Состояние «банка»: session_id, подтвержденные подписанным webhook-ом.
   * Ключ — штатный `context.idempotency_key` (модуль передает id сессии
   * в каждом вызове провайдера). См. докстринг класса.
   */
  private confirmedSessions = new Set<string>()

  private readOutcome(data: unknown): DemoOutcome {
    return parseDemoOutcome((data as DemoSessionData | undefined)?.outcome)
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as DemoSessionData
    const outcome = parseDemoOutcome(data.outcome)
    // data публична витрине (контракт): секретов здесь нет и быть не может.
    return { id: randomUUID(), data: { ...data, outcome } }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = (input.data ?? {}) as DemoSessionData
    const outcome = parseDemoOutcome(data.outcome)
    return { data: { ...data, outcome } }
  }

  async deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as DemoSessionData
    const outcome = parseDemoOutcome(data.outcome)
    // Подтвержденная подписанным webhook-ом сессия авторизуется при
    // повторном вызове (штатный deferred-механизм: ядро вызывает
    // authorizePayment из processPaymentWorkflow / admin Check status).
    const sessionId = input.context?.idempotency_key
    if (sessionId && this.confirmedSessions.has(sessionId)) {
      this.confirmedSessions.delete(sessionId)
      return { status: "authorized", data: { ...data, outcome } }
    }
    if (outcome === "decline") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Demo payment declined (outcome=decline)"
      )
    }
    return {
      status: outcome === "pending" ? "pending_authorization" : "authorized",
      data: { ...data, outcome },
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
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
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const outcome = this.readOutcome(input.data)
    if (outcome === "pending") {
      return { status: "pending" }
    }
    if (outcome === "decline") {
      return { status: "error" }
    }
    return { status: "authorized" }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const notSupported: WebhookActionResult = { action: "not_supported" }

    const signature = this.readHeaderSignature(payload.headers)
    if (!signature) {
      return notSupported
    }
    if (!this.verifySignature(payload.rawData, signature)) {
      return notSupported
    }

    const event = this.parseWebhookBody(payload.rawData)
    if (!event) {
      return notSupported
    }
    if (!event.session_id) {
      // Без session_id штатный подписчик игнорирует событие (guard ядра).
      return notSupported
    }
    // Подписанное событие подтверждает сессию «банка» (см. докстринг класса):
    // ядро затем повторно вызовет authorizePayment, который вернет authorized.
    this.confirmedSessions.add(event.session_id)
    return {
      action: event.event_type,
      // Сумма — заявочная: реальную сумму списания ограничивает ядро
      // (≤ авторизованной суммы сессии); валюта — всегда валюта сессии.
      data: {
        session_id: event.session_id,
        amount: new BigNumber(event.amount ?? 0),
      },
    }
  }

  private readHeaderSignature(headers: ProviderWebhookPayload["payload"]["headers"]): string | null {
    const raw =
      (headers as Record<string, unknown> | undefined)?.[DEMO_WEBHOOK_SIGNATURE_HEADER] ??
      (headers as Record<string, unknown> | undefined)?.[DEMO_WEBHOOK_SIGNATURE_HEADER.toUpperCase()]
    if (typeof raw !== "string" || raw.length === 0) {
      return null
    }
    return raw
  }

  private verifySignature(rawData: ProviderWebhookPayload["payload"]["rawData"], signature: string): boolean {
    // Базовый класс хранит опции в protected readonly config (второй
    // аргумент конструктора), а не в options_.
    const secret = this.config?.webhook_secret
    if (!secret) {
      return false
    }
    const body =
      typeof rawData === "string"
        ? Buffer.from(rawData, "utf8")
        : Buffer.isBuffer(rawData)
          ? rawData
          : Buffer.from(String(rawData ?? ""))
    const expected = createHmac("sha256", secret).update(body).digest("hex")
    const given = Buffer.from(signature, "utf8")
    if (given.length !== expected.length) {
      return false
    }
    return timingSafeEqual(given, Buffer.from(expected, "utf8"))
  }

  private parseWebhookBody(
    rawData: ProviderWebhookPayload["payload"]["rawData"]
  ): { event_type: DemoWebhookAction; session_id?: string; amount?: number } | null {
    const body =
      typeof rawData === "string"
        ? rawData
        : Buffer.isBuffer(rawData)
          ? rawData.toString("utf8")
          : null
    if (!body) {
      return null
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      return null
    }
    const eventType = parsed.event_type
    if (
      typeof eventType !== "string" ||
      !(DEMO_WEBHOOK_ACTIONS as readonly string[]).includes(eventType)
    ) {
      return null
    }
    const amount =
      typeof parsed.amount === "number"
        ? parsed.amount
        : typeof parsed.amount === "string" && parsed.amount !== ""
          ? Number(parsed.amount)
          : undefined
    if (amount !== undefined && !Number.isFinite(amount)) {
      return null
    }
    return {
      event_type: eventType as DemoWebhookAction,
      session_id: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
      amount,
    }
  }
}

export default DemoOnlinePaymentProvider

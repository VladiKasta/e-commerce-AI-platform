import type { Logger, NotificationTypes } from "@medusajs/framework/types"
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import nodemailer from "nodemailer"
import { renderTemplate, TEMPLATE_NAMES } from "./templates"

type InjectedDependencies = { logger: Logger }

export type SmtpProviderOptions = {
  /** Хост SMTP-сервера (обязателен). */
  host: string
  /** Порт SMTP (по умолчанию 587). */
  port?: number
  /** TLS с момента соединения (порт 465). По умолчанию false — STARTTLS. */
  secure?: boolean
  /** Логин SMTP; пусто — без аутентификации (локальный Mailpit). */
  user?: string
  /** Пароль SMTP. */
  password?: string
  /** Адрес отправителя (обязателен). */
  from_email: string
  /** Имя отправителя; по умолчанию — пусто (только адрес). */
  from_name?: string
  /** Название магазина (STORE_NAME) — контекст шаблонов. */
  store_name?: string
  /** Публичный URL витрины (NUXT_PUBLIC_SITE_URL) — контекст шаблонов. */
  site_url?: string
  /** Каналы, обслуживаемые провайдером (регистрируются в medusa-config.ts). */
  channels?: string[]
}

/**
 * SMTP-провайдер для штатного Notification Module Medusa (этап 5.2.3).
 *
 * Medusa 2.23 не поставляет SMTP-провайдера (встроены только notification-local
 * и notification-sendgrid), поэтому провайдер реализует штатный контракт
 * AbstractNotificationProviderService: единственный метод send получает
 * notification (template + data) и отправляет письмо.
 *
 * Шаблоны рендерятся на стороне провайдера — по контракту CreateNotificationDTO
 * «template — имя шаблона в системе провайдера» (как template id у SendGrid).
 * Реестр шаблонов — ./templates.ts; переопределение существующего или
 * добавление нового шаблона — правка реестра без изменения подписчиков
 * (см. docs/notifications.md).
 *
 * Безопасность: токены/пароли не логируются — в лог попадает только имя
 * шаблона и текст ошибки транспорта (SMTP-ответы не содержат тело письма).
 */
class SmtpNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-smtp"

  protected logger_: Logger
  protected options_: SmtpProviderOptions
  protected transport: nodemailer.Transporter

  constructor({ logger }: InjectedDependencies, options: SmtpProviderOptions) {
    super()

    if (!options?.host) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Провайдер notification-smtp требует опцию host (SMTP_HOST)"
      )
    }
    if (!options?.from_email) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Провайдер notification-smtp требует опцию from_email (SMTP_FROM_EMAIL)"
      )
    }

    this.logger_ = logger
    this.options_ = options
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port ?? 587,
      secure: options.secure ?? false,
      // Отсутствие user означает «без аутентификации» (локальный Mailpit).
      ...(options.user
        ? { auth: { user: options.user, pass: options.password } }
        : {}),
    })
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    const content = renderTemplate(notification, {
      store_name: this.options_.store_name || "Магазин",
      site_url: this.options_.site_url || "http://localhost:3000",
    })

    if (!content) {
      // Неизвестный шаблон — почтовый канал один, рассылать «сырые» данные
      // нельзя; notification фиксируется модулем как FAILURE.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Неизвестный шаблон уведомления: "${notification.template}". Поддерживаемые: ${TEMPLATE_NAMES.join(", ")}. Добавьте шаблон в backend/src/modules/notification-smtp/providers/smtp/templates.ts`
      )
    }

    const from = this.options_.from_name
      ? `"${this.options_.from_name}" <${this.options_.from_email}>`
      : this.options_.from_email

    try {
      const info = await this.transport.sendMail({
        from,
        to: notification.to,
        subject: content.subject,
        text: content.text,
        html: content.html,
      })
      return { id: info.messageId }
    } catch (error) {
      // Токены/получатели не логируются: только шаблон и ошибка транспорта.
      const message = error instanceof Error ? error.message : String(error)
      this.logger_.error(
        `SMTP: ошибка отправки уведомления (шаблон ${notification.template}): ${message}`
      )
      throw error
    }
  }
}

export default SmtpNotificationService

import type { ScheduledJobHandler } from "@medusajs/framework/jobs"
import type {
  ILockingModule,
  Logger,
  MedusaContainer,
  NotificationTypes,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"
import { notificationsEnabled } from "../utils/notifications"

/**
 * Scheduled job: повторная доставка неудачных email-уведомлений (этап 5.2.3).
 *
 * Ядро Medusa эмитит auth.password_reset и order.transfer_requested через
 * emitEventStep без attempts — штатных ретраев СОБЫТИЯ на шине нет (1 попытка;
 * падение подписчика = warn). Подписчики ошибок не бросают: письмо фиксируется
 * штатным Notification Module как FAILURE с idempotency_key, но повторить
 * отправку некому — это и делает данный job.
 *
 * Механизм — штатная идемпотентность Notification Module: повторный вызов
 * createNotifications с тем же idempotency_key при status=FAILURE повторяет
 * отправку той же строки (без дублей). Окно ограничено (по умолчанию 15 минут
 * ≈ TTL reset-токена): мертвые ссылки не рассылаются, «неконтролируемой
 * рассылки» нет — фиксированный получатель, фиксированное тело, счет попыток
 * ограничен окном/расписанием. Перенос заказа токеном TTL не ограничен, но
 * окно то же — пользователь может запросить перенос повторно.
 *
 * Параллельные запуски исключены штатным Locking Module (прием 3.6.2):
 * race «два воркера читают FAILURE одновременно → оба отправляют» (известный
 * TODO ядра) закрыт пропуском запуска при занятом lock-е.
 *
 * Расписание — NOTIFICATION_RETRY_CRON (по умолчанию раз в 5 минут),
 * окно — NOTIFICATION_RETRY_WINDOW_MINUTES (по умолчанию 15).
 */

const LOCK_KEY = "notification-retry-job"
const LOCK_EXPIRE_SECONDS = 240

export const config = {
  name: "notification-retry",
  schedule: process.env.NOTIFICATION_RETRY_CRON || "*/5 * * * *",
}

type NotificationService = NotificationTypes.INotificationModuleService

/**
 * Строка уведомления с idempotency_key: в Medusa 2.23 колонка модели есть и
 * возвращается сервисом в рантайме (доказано живым ретраем 27.11.2026), но
 * NotificationDTO публичного контракта ее не экспонирует — локальное
 * расширение типа вместо any.
 */
type NotificationRow = NotificationTypes.NotificationDTO & {
  idempotency_key?: string | null
}

async function retryFailedNotifications(
  container: MedusaContainer,
  logger: Logger
): Promise<{ retried: number; sent: number }> {
  const notificationService = container.resolve<NotificationService>(
    Modules.NOTIFICATION
  )

  const windowMinutes = Number.parseInt(
    process.env.NOTIFICATION_RETRY_WINDOW_MINUTES || "15",
    10
  )
  const since = new Date(Date.now() - windowMinutes * 60_000)

  // Статусного фильтра в публичном контракте FilterableNotificationProps нет,
  // поэтому фильтрация по статусу выполняется в памяти по свежему окну.
  const recent = (await notificationService.listNotifications(
    { created_at: { $gte: since.toISOString() } },
    { order: { created_at: "ASC" }, take: 100 }
  )) as NotificationRow[]
  const failed = recent.filter(
    (notification) =>
      notification.status === "failure" &&
      notification.idempotency_key !== null &&
      notification.idempotency_key !== undefined
  )
  if (!failed.length) {
    return { retried: 0, sent: 0 }
  }

  let sent = 0
  for (const notification of failed) {
    try {
      // Тот же idempotency_key: SUCCESS-строки модуль пропускает, FAILURE —
      // повторяет. Восстанавливаем исходный DTO из хранимой строки.
      await notificationService.createNotifications({
        to: notification.to,
        from: notification.from ?? undefined,
        channel: notification.channel,
        template: notification.template ?? undefined,
        data: notification.data ?? undefined,
        trigger_type: notification.trigger_type ?? undefined,
        resource_id: notification.resource_id ?? undefined,
        resource_type: notification.resource_type ?? undefined,
        receiver_id: notification.receiver_id ?? undefined,
        idempotency_key: notification.idempotency_key ?? undefined,
      })
      sent += 1
    } catch (error) {
      // Ожидаемо при по-прежнему недоступном SMTP: строка остается FAILURE
      // и будет повторена в следующем запуске, пока не истечет окно.
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`[Notification retry] повтор не удался: ${message}`)
    }
  }
  return { retried: failed.length, sent }
}

const notificationRetry: ScheduledJobHandler = async (container) => {
  if (!notificationsEnabled()) {
    return
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const ownerId = `notification-retry-${randomUUID()}`
  try {
    await locking.acquire(LOCK_KEY, { ownerId, expire: LOCK_EXPIRE_SECONDS })
  } catch {
    logger.info(
      "[Notification retry] Пропущен: предыдущий запуск еще выполняется"
    )
    return
  }

  try {
    const summary = await retryFailedNotifications(container, logger)
    if (summary.retried > 0) {
      logger.info(
        `[Notification retry] повторных доставок: ${summary.sent} из ${summary.retried} неудачных за окно`
      )
    }
  } finally {
    await locking.release(LOCK_KEY, { ownerId }).catch(() => {
      // Истекший expire освободит строку автоматически.
    })
  }
}

export default notificationRetry

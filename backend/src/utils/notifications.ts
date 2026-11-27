import { createHash } from "node:crypto"
import type { Logger, NotificationTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/**
 * Общий слой подписчиков уведомлений (этап 5.2.3).
 *
 * Тонкие подписчики событий (auth.password_reset, order.transfer_requested)
 * собирают CreateNotificationDTO и отдают их штатному Notification Module —
 * официальный паттерн Medusa для доставки одноразовых токенов. Собственной
 * рассылки/очереди/Event Bus здесь нет.
 *
 * Правила безопасности (решение №39 в docs/PROGRESS.md):
 *  - NOTIFICATION_ENABLED=false полностью выключает создание уведомлений;
 *  - ошибки создания НЕ бросаются наружу (как у штатного configurable-
 *    notifications ядра): сбой SMTP не ломает штатные сценарии — запрос
 *    reset/transfer отвечает своим обычным кодом, notification остается
 *    в статусе FAILURE и подхватывается job-ом notification-retry;
 *  - токены и адреса получателей не логируются (в лог — только шаблон и
 *    текст ошибки).
 */

type NotificationModuleService = NotificationTypes.INotificationModuleService
type MedusaContainer = { resolve: <T>(key: string) => T }

export function notificationsEnabled(): boolean {
  return process.env.NOTIFICATION_ENABLED !== "false"
}

/** Стабильный идемпотентный ключ: SHA-256 по уникальной части токена. */
export function idempotencyKey(prefix: string, secret: string): string {
  return `${prefix}:${createHash("sha256").update(secret).digest("hex")}`
}

/**
 * Создание уведомления через штатный Notification Module.
 * Ошибки логируются, но не бросаются (см. выше).
 */
export async function createNotification(
  logger: Logger,
  container: MedusaContainer,
  input: NotificationTypes.CreateNotificationDTO
): Promise<void> {
  if (!notificationsEnabled()) {
    return
  }
  try {
    const notificationService =
      container.resolve<NotificationModuleService>(Modules.NOTIFICATION)
    await notificationService.createNotifications(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(
      `Не удалось создать уведомление (шаблон ${input.template ?? "-"}): ${message}`
    )
  }
}

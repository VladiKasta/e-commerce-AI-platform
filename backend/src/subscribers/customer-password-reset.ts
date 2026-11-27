import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework/subscribers"
import { AuthWorkflowEvents, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createNotification,
  idempotencyKey,
  notificationsEnabled,
} from "../utils/notifications"

/**
 * Доставка одноразового reset-токена (этап 5.2.3).
 *
 * Workflow generateResetPasswordTokenWorkflow эмитит
 * auth.password_reset с payload { entity_id, actor_type, token, metadata }
 * ТОЛЬКО для существующих identity (createPasswordResetToken бросает ошибку
 * для несуществующих — шаг падает, emitEventStep не выполняется), поэтому
 * получатель всегда реальный email зарегистрированной identity: получатель
 * определяется сервером, перечисление email невозможно.
 *
 * Обрабатываются только покупатели (actor_type "customer"); сброс пароля
 * администратора (actor_type "user") на этом этапе письмом не доставляется.
 * Штатная генерация/поглощение токена не изменяется (одноразовость и TTL
 * 15 минут — на стороне Auth Module).
 */
export default async function customerPasswordReset({
  event,
  container,
}: SubscriberArgs<{
  entity_id: string
  actor_type: string
  token: string
  metadata?: Record<string, unknown>
}>) {
  if (!notificationsEnabled()) {
    return
  }

  const { entity_id, actor_type, token } = event.data
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (actor_type !== "customer" || !entity_id || !token) {
    // Чужие actor_type (пользователи admin) не обрабатываются.
    return
  }

  await createNotification(logger, container, {
    to: entity_id,
    channel: "email",
    template: "customer-password-reset",
    data: {
      token,
      email: entity_id,
    },
    trigger_type: AuthWorkflowEvents.PASSWORD_RESET,
    resource_type: "customer",
    // Новый reset-токен аннулирует предыдущие (ядро), поэтому ключ — по
    // токену: каждый токен доставляется ровно один раз, повторная доставка
    // события дублей не создает.
    idempotency_key: idempotencyKey("password-reset", token),
  })
}

export const config: SubscriberConfig = {
  event: AuthWorkflowEvents.PASSWORD_RESET,
  context: { subscriberId: "customer-password-reset-notification" },
}

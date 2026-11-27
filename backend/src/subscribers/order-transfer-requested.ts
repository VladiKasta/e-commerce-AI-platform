import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework/subscribers"
import {
  ChangeActionType,
  ContainerRegistrationKeys,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"
import {
  createNotification,
  idempotencyKey,
  notificationsEnabled,
} from "../utils/notifications"

type TransferRequestedPayload = { id: string; order_change_id: string }

/**
 * Форма результата Query API: запрошенные поля order_change (штатный тип
 * OrderChange неточен для soft-связей — details не типизирован, display_id
 * типизирован иначе; форма гарантирована запрошенными fields).
 */
type OrderChangeQueryResult = {
  data: Array<{
    id: string
    actions: Array<{
      action: string
      details: {
        token?: string
        original_email?: string
        new_email?: string
      }
    }>
    order: { email: string; display_id: string | number }
  }>
}

/**
 * Доставка подтверждения переноса заказа (этап 5.2.3).
 *
 * requestOrderTransferWorkflow эмитит order.transfer_requested с payload
 * { id, order_change_id } — токен в событии ОТСТУТСТВУЕТ: UUID лежит в
 * order_change_action.details.token. Подписчик резолвит токен, email заказа
 * и номер через штатный Query API; получатель — email заказа (не инициатор),
 * определяется сервером.
 */
export default async function orderTransferRequested({
  event,
  container,
}: SubscriberArgs<TransferRequestedPayload>) {
  if (!notificationsEnabled()) {
    return
  }

  const { id: order_id, order_change_id } = event.data
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (!order_id || !order_change_id) {
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_change",
    fields: [
      "id",
      "actions.action",
      "actions.details",
      "order.email",
      "order.display_id",
    ],
    filters: { id: order_change_id },
  })
  const change = (data as unknown as OrderChangeQueryResult["data"])[0]
  const transferAction = change?.actions?.find(
    (action) => action.action === ChangeActionType.TRANSFER_CUSTOMER
  )
  const token = transferAction?.details?.token
  const email = change?.order?.email
  const displayId = change?.order?.display_id

  if (!token || !email || !displayId) {
    logger.error(
      `order.transfer_requested(${order_change_id}): не удалось резолвить токен/email заказа — уведомление не создано`
    )
    return
  }

  await createNotification(logger, container, {
    to: email,
    channel: "email",
    template: "order-transfer-request",
    data: {
      token,
      email,
      display_id: String(displayId),
      order_id,
    },
    trigger_type: OrderWorkflowEvents.TRANSFER_REQUESTED,
    resource_id: order_id,
    resource_type: "order",
    // Один order change = одно письмо; повторная доставка события дублей
    // не создает, новый request после cancel дает новый order_change_id.
    idempotency_key: idempotencyKey("order-transfer", order_change_id),
  })
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.TRANSFER_REQUESTED,
  context: { subscriberId: "order-transfer-requested-notification" },
}

import type {
  AuthContext,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

/** См. примечание в cart-access.ts: auth_context опционален. */
type AccessRequest = MedusaRequest & { auth_context?: AuthContext }

/**
 * Защита заказов (этап 5.2.1).
 *
 * Штатный `GET /store/orders/:id` в Medusa 2.23.0 намеренно не требует
 * авторизации: комментарий ядра прямо называет id заказа механизмом
 * аутентификации и ссылается на официальный гайд «Restrict Order
 * Retrieval» (docs.medusajs.com/resources/commerce-modules/order/
 * secure-order-retrieval). Аудит 5.1 подтвердил: чужой заказ (в том
 * числе заказ авторизованного покупателя) читается по известному id
 * кем угодно с publishable API key; ответ `transfer/request` также
 * возвращал полные данные чужого заказа.
 *
 * Реализация следует ОФИЦИАЛЬНОМУ гайду Medusa (Medusa First):
 * `authenticate("customer", ["session","bearer"], { allowUnauthenticated:
 * true })` + собственный middleware, который решает, что может читать
 * неавторизованный запрос. Схема доступа:
 *
 * - авторизованный покупатель — только собственные заказы
 *   (`order.customer_id === auth_context.actor_id`); список `/store/orders`
 *   уже серверно фильтруется ядром по тому же признаку;
 * - заказ зарегистрированного покупателя недоступен никому, кроме
 *   владельца (и неавторизованным запросам в том числе);
 * - ГСТЕВОЙ заказ (владелец — неявная запись customer `has_account:
 *   false`, создается ядром при complete) больше не читается по голому
 *   order_id: требуется подтвержденное право доступа — заголовок
 *   `x-cart-id` c id корзины, из которой заказ оформлен. Связь
 *   order↔cart создается ядром при completeCartWorkflow и проверяется
 *   штатным Query API (link order_cart). Право possession-типа: cart_id
 *   — тот же непредсказуемый секрет Medusa, который витрина обязана
 *   хранить серверно (httpOnly cookie, docs/checkout.md); риск утечки
 *   ниже, чем у order_id, т.к. id корзины не показывается пользователю
 *   и не попадает в URL. Ограничения механизма — в docs/checkout.md
 *   («Доступ к гостевому заказу»); усиление (код на email) — этап 5.2.3;
 * - любой отказ — контролируемый 404 `not_found` с текстом штатного
 *   ответа о несуществующем заказе: не раскрывает ни существование
 *   заказа, ни персональные данные.
 *
 * Защита transfer (штатный механизм сохранен): `transfer/request` и
 * `transfer/cancel` доступны только покупателю, чей email совпадает с
 * email заказа (легитимный сценарий Medusa: «оформил гостем со своим
 * email — забираю в аккаунт»). Это закрывает найденную аудитом утечку
 * (чужой покупатель получал полные данные заказа в ответе request) и
 * спам change-запросами. `transfer/accept|decline` остаются штатными:
 * подтверждение — одноразовый токен, доставляемый на email заказа
 * (доставка — этап 5.2.3).
 */

const GUEST_CART_PROOF_HEADER = "x-cart-id"

type OrderAccessRecord = {
  id: string
  customer_id: string | null
  email: string | null
}

type CustomerAccessRecord = { id: string; email: string; has_account: boolean }

async function queryOne<T>(
  scope: AccessRequest["scope"],
  entity: string,
  fields: string[],
  filters: Record<string, unknown>
): Promise<T | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity, fields, filters })
  return (data[0] as T | undefined) ?? null
}

/** Контролируемый отказ: контракт неотличим от несуществующего заказа. */
function orderNotFound(orderId: string): MedusaError {
  return new MedusaError(
    MedusaError.Types.NOT_FOUND,
    `Order with id: ${orderId} was not found`
  )
}

/**
 * `GET /store/orders/:id` — доступ к заказу по подтвержденному праву:
 * владение (авторизация) либо possession секрета корзины (гость).
 * Регистрируется после `authenticate(..., { allowUnauthenticated: true })`
 * согласно официальному гайду.
 */
export async function ensureOrderAccess(
  req: AccessRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const orderId = req.params?.id
  if (typeof orderId !== "string" || orderId.length === 0) {
    next()
    return
  }

  const order = await queryOne<OrderAccessRecord>(req.scope, "order", [
    "id",
    "customer_id",
  ], { id: orderId })
  if (!order) {
    // Несуществующий заказ — штатный 404 отдает сам маршрут.
    next()
    return
  }

  const actorId = req.auth_context?.actor_id
  if (actorId) {
    // Авторизованный покупатель читает только собственные заказы.
    // Гостевой заказ (неявный customer) ему недоступен до завершения
    // штатного transfer — тогда customer_id станет его.
    if (order.customer_id === actorId) {
      next() // свой заказ
      return
    }
    next(orderNotFound(orderId))
    return
  }

  // Неавторизованный запрос: только гостевой заказ и только с proof.
  if (order.customer_id != null) {
    const owner = await queryOne<CustomerAccessRecord>(
      req.scope,
      "customer",
      ["id", "has_account"],
      { id: order.customer_id }
    )
    if (owner?.has_account) {
      // Заказ зарегистрированного покупателя гостю недоступен.
      next(orderNotFound(orderId))
      return
    }
  }
  if (await guestProof(req, order.id)) {
    next() // право подтверждено секретом корзины гостя
    return
  }
  next(orderNotFound(orderId))
}

/** Проверка права гостя: знание id корзины, породившей заказ (link order_cart). */
async function guestProof(
  req: AccessRequest,
  orderId: string
): Promise<boolean> {
  const proofCartId = req.header?.(GUEST_CART_PROOF_HEADER)
  if (typeof proofCartId !== "string" || proofCartId.length === 0) {
    return false
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    filters: { order_id: orderId, cart_id: proofCartId },
  })
  return data.length > 0
}

/**
 * `POST /store/orders/:id/transfer/request` и `transfer/cancel` —
 * инициатором переноса может быть только покупатель, чей email совпадает
 * с email заказа (штатная семантика переноса гостевого заказа). Чужой
 * покупатель получает тот же 404, что и для несуществующего заказа, —
 * без раскрытия данных. Ответ маршрута (полный заказ) при совпадении
 * email легитимен: инициатор — автор заказа, оформленного на его email.
 */
export async function ensureTransferInitiator(
  req: AccessRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const orderId = req.params?.id
  if (typeof orderId !== "string" || orderId.length === 0) {
    next()
    return
  }
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    // Штатный authenticate маршрута уже отвечает 401; страховка.
    next(new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized"))
    return
  }

  const [order, customer] = await Promise.all([
    queryOne<OrderAccessRecord>(req.scope, "order", ["id", "email"], {
      id: orderId,
    }),
    queryOne<CustomerAccessRecord>(req.scope, "customer", ["id", "email"], {
      id: actorId,
    }),
  ])
  if (!order || !customer) {
    next() // несуществующий заказ/покупатель — штатные ошибки маршрута
    return
  }
  if (order.email != null && order.email === customer.email) {
    next()
    return
  }
  next(orderNotFound(orderId))
}

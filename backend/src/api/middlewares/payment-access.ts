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
import { cartNotFound, loadCartAccess } from "./cart-access"

/** См. примечание в cart-access.ts: auth_context опционален. */
type AccessRequest = MedusaRequest & { auth_context?: AuthContext }

/**
 * Защита платежных коллекций и сессий (этап 5.3.1).
 *
 * Находка 5.3 (docs/PROGRESS.md): штатные Store-маршруты платежей
 * Medusa 2.23.0 — `POST /store/payment-collections` (тело `{cart_id}`),
 * `POST /store/payment-collections/:id/payment-sessions`,
 * `POST /store/payment-collections/:id/payment-sessions/:session_id` —
 * не требуют авторизации и не проверяют принадлежность корзины (guard 5.2.1
 * стоит только на `/store/carts/:id*`). Знающий `cart_id` чужой
 * авторизованной корзины мог создать для нее payment collection (ответ
 * раскрывал сумму корзины) и добавить payment-сессию.
 *
 * Модель доступа — зеркалирует 5.2.1 для корзин, право на платежную
 * коллекцию наследуется от права на её корзину:
 *
 * - коллекция гостевой корзины (владелец `null` или неявный покупатель
 *   `has_account: false`) — гостевая модель Medusa (id = секрет) без
 *   изменений: гостевой checkout этапа 4 работает как раньше;
 * - коллекция авторизованной корзины — только владелец: посторонний
 *   покупатель и неавторизованный запрос получают контролируемый 404,
 *   неотличимый от несуществующего ресурса (без раскрытия суммы);
 * - знание `payment_collection_id` / `payment_session_id` права не дает:
 *   сессии адресуются только через id коллекции, а право на коллекцию
 *   определяется состоянием её корзины, а не знанием id;
 * - после claim гостевой корзины коллекция наследует защиту владельца
 *   (проверка stateless на каждом запросе): конкурентный claim не дает
 *   постоянного обхода — операции, начатые до фиксации владельца,
 *   соответствуют гостевой модели (как и операции самой корзины, 5.3),
 *   сумма коллекции пересчитывается ядром при каждом изменении состава,
 *   повторное создание сессии пересоздает её, complete владельца не
 *   затрагивается.
 *
 * Реализация — штатный middleware-контракт на маршрутах ядра (как 4.5 и
 * 5.2.1): ядро не изменяется, платежный модуль не создается. Не
 * затрагиваются: Admin API (`/admin/*`), внутренние workflows ядра
 * (complete обновляет коллекции в обход HTTP), блокировки 4.5/claim,
 * будущие webhook-маршруты платежных провайдеров (матчеры — только эти
 * три store-маршрута).
 *
 * Резолв коллекция→корзина: link `cart_payment_collection` ядра через
 * штатный Query API (обратный фильтр по `payment_collection_id` проверен
 * живой пробой `medusa exec` — прием 5.2.1). Коллекция без связи с
 * корзиной (например, уже ордерная) пропускается — штатный обработчик
 * отвечает свои ошибки.
 */

const CART_ID_BODY_MAX_LENGTH = 256

function paymentCollectionNotFound(collectionId: string): MedusaError {
  return new MedusaError(
    MedusaError.Types.NOT_FOUND,
    `Payment collection with id: ${collectionId} was not found`
  )
}

/**
 * `POST /store/payment-collections` — создание коллекции по `cart_id`:
 * пропуск для гостевой корзины и владельца; посторонним и
 * неавторизованным авторизованная корзина неотличима от несуществующей.
 */
export async function guardPaymentCollectionCreate(
  req: AccessRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const body = req.body as { cart_id?: unknown } | undefined
  const cartId =
    typeof body?.cart_id === "string" && body.cart_id.length > 0
      ? body.cart_id.slice(0, CART_ID_BODY_MAX_LENGTH)
      : null
  if (!cartId) {
    // Без cart_id / неверный тип — штатная strict-валидация ответит 400.
    next()
    return
  }

  const cart = await loadCartAccess(req.scope, cartId)
  if (!cart) {
    // Несуществующая корзина — штатную ошибку отдаст workflow.
    next()
    return
  }
  if (cart.customerId == null || !cart.registered) {
    // Гостевая корзина — модель Medusa (id = секрет).
    next()
    return
  }
  if (req.auth_context?.actor_id === cart.customerId) {
    next() // владелец
    return
  }
  next(cartNotFound(cartId))
}

/** Резолв корзины платежной коллекции через link (Query API ядра). */
async function resolveCollectionCartId(
  scope: AccessRequest["scope"],
  paymentCollectionId: string
): Promise<string | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id"],
    filters: { payment_collection_id: paymentCollectionId },
  })
  return (data[0] as { cart_id?: string } | undefined)?.cart_id ?? null
}

/**
 * `POST /store/payment-collections/:id/payment-sessions` и
 * `POST /store/payment-collections/:id/payment-sessions/:session_id` —
 * операции над коллекцией (создание/обновление сессии): право наследуется
 * от корзины коллекции; отказ — штатный формат not_found ядра.
 */
export async function guardPaymentSessionsAccess(
  req: AccessRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const collectionId = req.params?.id
  if (typeof collectionId !== "string" || collectionId.length === 0) {
    next()
    return
  }

  const cartId = await resolveCollectionCartId(req.scope, collectionId)
  if (!cartId) {
    // Коллекция не связана с корзиной — штатный not_found обработчика.
    next()
    return
  }
  const cart = await loadCartAccess(req.scope, cartId)
  if (!cart) {
    next()
    return
  }
  if (cart.customerId == null || !cart.registered) {
    next() // гостевая корзина — модель Medusa
    return
  }
  if (req.auth_context?.actor_id === cart.customerId) {
    next() // владелец
    return
  }
  next(paymentCollectionNotFound(collectionId))
}

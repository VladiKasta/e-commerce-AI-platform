import type {
  AuthContext,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

/**
 * auth_context заполняется штатными middleware аутентификации (или
 * глобальным optional-парсингом Store API) и может отсутствовать —
 * типизирован опционально, как AuditRequest ядра.
 */
type AccessRequest = MedusaRequest & { auth_context?: AuthContext }

/**
 * Защита корзин покупателей (этап 5.2.1).
 *
 * Аудит 5.1 (см. docs/PROGRESS.md, решение №36) подтвердил дефекты модели
 * Medusa 2.23.0 «непредсказуемый id = авторизация» применительно к
 * авторизованным корзинам: любой, знающий id, мог читать/изменять/
 * завершать чужую корзину, а `POST /store/carts/:id/customer` (claim)
 * переносил ЛЮБУЮ корзину — включая уже принадлежащую другому
 * покупателю — любому авторизованному покупателю
 * (`transferCartCustomerWorkflow` не проверяет прежнего владельца).
 *
 * Правила доступа (к маршрутам `/store/carts/:id*`, создание корзины
 * `/store/carts` не затрагивается):
 *
 * - гостевая корзина — без владельца (`customer_id = null`) или с неявным
 *   покупателем (`has_account: false`; ядро Medusa назначает его корзине
 *   при установке email) — модель Medusa без изменений: id является
 *   секретом, доступ по publishable API key (гостевой checkout этапа 4
 *   работает без регрессий);
 * - авторизованная корзина (владелец зарегистрирован, `has_account:
 *   true`) — только владелец: прочие покупатели и неавторизованные
 *   запросы получают контролируемый 404 `not_found`, неотличимый от
 *   несуществующей корзины (без раскрытия факта существования и данных);
 * - claim (`POST /store/carts/:id/customer`) — привязать можно гостевую
 *   корзину (в т.ч. с неявным покупателем) или свою собственную
 *   (повторный claim идемпотентен); присвоение чужой авторизованной
 *   корзины — 404.
 *
 * Проверка claim выполняется ПОД межпроцессной блокировкой и повторяется
 * после ее захвата: ключ тот же, что у сериализации complete (этап 4.5),
 * поэтому конкурентные claim/claim и claim/complete одной корзины
 * сериализуются (победитель фиксирует владельца в транзакции workflow,
 * конкурент после освобождения лока видит уже занятую корзину → 404).
 * Транзакционный advisory-лок PostgreSQL (Locking Module, провайдер
 * locking-postgres) гарантированно освобождается при коммите/откате/обрыве
 * соединения.
 *
 * Реализация — штатный middleware-контракт Medusa на маршрутах ядра
 * (как в этапе 4.5): ядро не изменяется, бизнес-логика корзины не
 * дублируется, обход прямым вызовом Store API невозможен. Данные
 * корзины читаются штатным remote query (Query API), как это делают
 * собственные helpers ядра (refetchCart).
 */

/** Тот же ключ, что у сериализации complete (4.5) — единая очередь на корзину. */
const CART_REQUEST_LOCK_KEY_PREFIX = "complete-cart-request:"
const LOCK_TIMEOUT_SECONDS = 30

type CartAccessRecord = {
  /** Владелец корзины: null (без покупателя) | id неявного гостя | id покупателя. */
  customerId: string | null
  /** true — владелец зарегистрирован (has_account); false — неявный гость/нет владельца. */
  registered: boolean
}

/** Запись entity через Query API (первый элемент или null). */
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

/**
 * Владелец корзины и его статус. Неявный покупатель (has_account: false)
 * создается ядром для гостевой корзины при назначении email — такую корзину
 * обслуживает гостевая модель Medusa (id = секрет), а не владелецская.
 *
 * Используется также guard-ом платежных коллекций (5.3.1, payment-access.ts):
 * платежная коллекция связана с корзиной link-ом cart_payment_collection,
 * право доступа к ней наследуется от права доступа к её корзине.
 */
export async function loadCartAccess(
  scope: AccessRequest["scope"],
  cartId: string
): Promise<CartAccessRecord | null> {
  const cart = await queryOne<{ id: string; customer_id: string | null }>(
    scope,
    "cart",
    ["id", "customer_id"],
    { id: cartId }
  )
  if (!cart) {
    return null
  }
  if (cart.customer_id == null) {
    return { customerId: null, registered: false }
  }
  const owner = await queryOne<{ id: string; has_account: boolean }>(
    scope,
    "customer",
    ["id", "has_account"],
    { id: cart.customer_id }
  )
  return { customerId: cart.customer_id, registered: !!owner?.has_account }
}

/**
 * Контролируемый отказ без раскрытия: тот же контракт, что у штатного
 * ответа ядра на несуществующую корзину. Переиспользуется guard-ом
 * платежных коллекций (5.3.1) — отказ для чужой авторизованной корзины
 * неотличим от несуществующей.
 */
export function cartNotFound(cartId: string): MedusaError {
  return new MedusaError(
    MedusaError.Types.NOT_FOUND,
    `Cart with id '${cartId}' not found`
  )
}

/**
 * Проверка принадлежности корзины для всех маршрутов `/store/carts/:id*`
 * кроме claim (у него собственная защищенная проверка): чтение, изменение,
 * позиции, промокоды, доставка, налоги, complete.
 *
 * Владелец определяется по `customer_id` корзины и `auth_context.actor_id`
 * (глобальный optional-парсинг авторизации Store API уже заполняет
 * auth_context при наличии JWT/сессии — тот же механизм, которым ядро
 * авто-привязывает корзину при создании, см. аудит 5.1, проверка №13).
 */
export async function guardCartAccess(
  req: AccessRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const cartId = req.params?.id
  if (typeof cartId !== "string" || cartId.length === 0) {
    next()
    return
  }

  const cart = await loadCartAccess(req.scope, cartId)
  if (!cart) {
    // Несуществующая корзина — штатный 404 отдает сам маршрут.
    next()
    return
  }

  if (cart.customerId == null || !cart.registered) {
    // Гостевая корзина (без владельца или с неявным гостем) — модель
    // Medusa (id = секрет), без изменений.
    next()
    return
  }

  if (req.auth_context?.actor_id === cart.customerId) {
    next() // владелец
    return
  }

  next(cartNotFound(cartId))
}

/**
 * Защита claim (`POST /store/carts/:id/customer`): проверка принадлежности
 * выполняется под advisory-локом той же очереди, что и complete (4.5), и
 * повторяется после захвата лока — закрывает гонку «оба запроса прочитали
 * `customer_id = null`, оба переназначили владельца». Лок держится до
 * окончания ответа (коммит transferCartCustomerWorkflow внутри обработчика).
 */
export async function guardCartClaim(
  req: AccessRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const cartId = req.params?.id
  if (typeof cartId !== "string" || cartId.length === 0) {
    next()
    return
  }
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    // Штатный authenticate маршрута уже отвечает 401; страховка на случай
    // изменения порядка middleware.
    next(
      new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
    )
    return
  }

  const locking = req.scope.resolve(Modules.LOCKING)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    await locking.execute(`${CART_REQUEST_LOCK_KEY_PREFIX}${cartId}`, async () => {
      const cart = await loadCartAccess(req.scope, cartId)
      if (!cart) {
        // Несуществующая корзина — штатный 404 маршрута.
        next()
        return
      }
      // Гостевую корзину (без владельца или с неявным гостем) может
      // привязать любой авторизованный покупатель (первый занявший
      // выигрывает), свою зарегистрированную — повторно (идемпотентно).
      const allowed =
        cart.customerId == null ||
        !cart.registered ||
        cart.customerId === actorId
      if (!allowed) {
        next(cartNotFound(cartId))
        return
      }
      // Держим лок до конца ответа: коммит workflow обработчика происходит
      // до "finish" (тот же прием, что в serializeCartCompletion 4.5).
      await new Promise<void>((resolve) => {
        res.once("finish", () => resolve())
        next()
      })
    }, { timeout: LOCK_TIMEOUT_SECONDS })
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Timed-out acquiring lock")
    ) {
      // Тот же контракт, что у complete (4.5): корзина занята дольше окна.
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Cart is already being completed by another request"
      )
    }
    logger.warn(
      `Не удалось сериализовать claim корзины ${cartId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    throw error
  }
}

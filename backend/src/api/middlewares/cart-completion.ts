import type {
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
 * Сериализация завершения корзины (этап 4.5).
 *
 * Дефект (найден приемкой 4.4, Medusa 2.23.0): два ОДНОВРЕМЕННЫХ
 * `POST /store/carts/:id/complete` создают два заказа. Гонка живет в
 * `completeCartWorkflow`: шаг `releaseLockStep` снимает внутренний лок
 * (строка в таблице `locking`, ключ = id корзины) ДО коммита транзакции
 * workflow, поэтому конкурентный запуск успевает прочитать «у корзины
 * нет заказа» до того, как заказ первого запроса станет видимым.
 *
 * Решение — штатный маршрут + штатный middleware-контракт Medusa
 * (defineMiddlewares применяется и к маршрутам ядра: загрузчик
 * регистрирует middleware с тем же matcher-ом ПЕРЕД обработчиком
 * маршрута). Middleware держит транзакционный advisory-лок PostgreSQL
 * (`pg_advisory_xact_lock`, метод `execute` Locking Module, провайдер
 * locking-postgres) по ключу корзины на протяжении ВСЕГО запроса —
 * включая проверку состояния корзины, выполнение workflow и коммит —
 * и освобождает его только после отправки ответа:
 *
 * - второй конкурентный запрос ожидает лок (до LOCK_TIMEOUT_SECONDS) и
 *   после освобождения получает тот же заказ через штатную
 *   идемпотентность completeCartWorkflow — дубликат не создается;
 * - лок транзакционный: PostgreSQL снимает его сам при коммите, откате
 *   и при смерти процесса/соединения — «зависших» строк в таблице
 *   `locking` нет (в отличие от acquire/release, у которых истекшая
 *   строка не передается другому владельцу);
 * - владелец лока — сессия БД текущего запроса, т.е. идентификация
 *   уникальна на каждый запуск по построению (требование «уникальный
 *   ownerId» выполняется механизмом самого провайдера);
 * - ключ `"complete-cart-request:<id>"" не совпадает с внутренним
 *   ключом workflow (id корзины) — взаимной блокировки нет;
 * - другие корзины не затрагиваются: ключ содержит id корзины, разные
 *   корзины оформляются параллельно.
 *
 * Бизнес-логика checkout не дублируется: middleware только сериализует
 * доступ к штатному обработчику. Обойти защиту прямым вызовом Store API
 * нельзя — middleware стоит на самом штатном маршруте.
 */

const LOCK_KEY_PREFIX = "complete-cart-request:"
const LOCK_TIMEOUT_SECONDS = 30

export async function serializeCartCompletion(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const cartId = req.params?.id
  if (typeof cartId !== "string" || cartId.length === 0) {
    next()
    return
  }

  const locking = req.scope.resolve(Modules.LOCKING)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    await locking.execute(`${LOCK_KEY_PREFIX}${cartId}`, async () => {
      // Обработчик маршрута отвечает всегда (ошибки — через штатный
      // error handler, который тоже отправляет ответ), поэтому промис
      // завершается по событию "finish" — строго ПОСЛЕ коммита workflow
      // и формирования ответа. Раньше освобождать лок нельзя: это
      // переоткрыло бы гонку (клиентский "close" не считается).
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
      // Лок занят дольше отведенного окна — на этой корзине уже висит
      // незавершающееся оформление. Тот же контракт, что у ядра для
      // параллельного complete (HTTP 409 CONFLICT).
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Cart is already being completed by another request"
      )
    }
    logger.warn(
      `Не удалось сериализовать complete корзины ${cartId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    throw error
  }
}

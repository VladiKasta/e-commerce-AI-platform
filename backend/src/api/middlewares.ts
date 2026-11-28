import {
  authenticate,
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import {
  AdminAddAttributeOptions,
  AdminCreateCatalogAttribute,
  AdminDeleteProductAttributeValuesParams,
  AdminListCatalogAttributesParams,
  AdminSetAttributeCategories,
  AdminSetProductAttributeValues,
  AdminUpdateAttributeOption,
  AdminUpdateCatalogAttribute,
} from "./admin/catalog-attributes/validators"
import { serializeCartCompletion } from "./middlewares/cart-completion"
import { guardCartAccess, guardCartClaim } from "./middlewares/cart-access"
import {
  ensureOrderAccess,
  ensureTransferInitiator,
} from "./middlewares/order-access"
import {
  guardPaymentCollectionCreate,
  guardPaymentProviderPolicy,
  guardPaymentSessionsAccess,
} from "./middlewares/payment-access"
import {
  limitLogin,
  limitRegister,
  limitReset,
  limitUpdate,
  limitTransferRequest,
} from "./middlewares/auth-rate-limit"

/**
 * Валидация Admin API характеристик каталога — штатные middleware
 * Medusa (те же, что использует ядро для /admin/*): zod-схемы из
 * src/api/admin/catalog-attributes/validators.ts.
 *
 * Авторизация на эти маршруты НЕ настраивается отдельно: Medusa применяет
 * authenticate("user") ко всем путям /admin/* автоматически.
 */
export default defineMiddlewares({
  routes: [
    // Этап 4.5: сериализация завершения корзины — транзакционный
    // advisory-лок Locking Module (locking-postgres) на весь запрос
    // к ШТАТНОМУ маршруту complete. Два одновременных complete одной
    // корзины не создают дублирующих заказов (см. middleware для деталей).
    {
      methods: ["POST"],
      matcher: "/store/carts/:id/complete",
      middlewares: [serializeCartCompletion],
    },
    // Этап 5.2.1: защита корзин покупателей. Гостевые корзины работают по
    // модели Medusa (id = секрет); авторизованная корзина доступна только
    // владельцу — чтение/изменение/завершение чужой дают контролируемый
    // 404 (неотличимый от несуществующей корзины). Claim проверяет
    // принадлежность ПОД тем же advisory-локом, что и complete (4.5),
    // и повторяет проверку после захвата лока: конкурентные claim/claim
    // и claim/complete сериализуются, повторный claim своей корзины
    // идемпотентен, присвоение чужой — 404.
    {
      matcher: "/store/carts/:id/{*splat}",
      middlewares: [guardCartAccess],
    },
    // Явный базовый путь (на случай, если {*splat} не покрывает `/store/carts/:id`
    // без вложенности): дублирование middleware безвредно — проверка идемпотентна.
    {
      matcher: "/store/carts/:id",
      middlewares: [guardCartAccess],
    },
    {
      methods: ["POST"],
      matcher: "/store/carts/:id/customer",
      middlewares: [guardCartClaim],
    },
    // Этап 5.2.1: защита заказов (по официальному гайду Medusa
    // «Restrict Order Retrieval»): authenticate с allowUnauthenticated
    // заполняет auth_context, когда credentials есть, а доступ решает
    // ensureOrderAccess — свои заказы по авторизации; гостевой заказ —
    // только по подтвержденному праву (заголовок x-cart-id c id корзины
    // заказа, link order_cart); прочие запросы — контролируемый 404 без
    // раскрытия данных. Гостевой checkout не затрагивается: complete
    // возвращает заказ напрямую (proof нужен только для повторного
    // чтения GET /store/orders/:id).
    {
      method: ["GET"],
      matcher: "/store/orders/:id",
      middlewares: [
        authenticate("customer", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
        ensureOrderAccess,
      ],
    },
    // Этап 5.2.2: распределенный rate limiting защищаемых маршрутов
    // (механизм и ограничения — решение №38 в docs/PROGRESS.md). Порядок:
    // лимит применяется ДО аутентификации и ДО guard-ов 5.2.1 —
    // отказ одинаков для любых идентификаторов (перечисление email
    // невозможно) и не расходует ресурсы штатных обработчиков.
    {
      methods: ["POST"],
      matcher: "/auth/customer/emailpass",
      middlewares: [limitLogin],
    },
    {
      methods: ["POST"],
      matcher: "/auth/customer/emailpass/register",
      middlewares: [limitRegister],
    },
    {
      methods: ["POST"],
      matcher: "/auth/customer/emailpass/reset-password",
      middlewares: [limitReset],
    },
    {
      methods: ["POST"],
      matcher: "/auth/customer/emailpass/update",
      middlewares: [limitUpdate],
    },
    {
      methods: ["POST"],
      matcher: "/store/orders/:id/transfer/request",
      middlewares: [limitTransferRequest, ensureTransferInitiator],
    },
    {
      methods: ["POST"],
      matcher: "/store/orders/:id/transfer/cancel",
      middlewares: [ensureTransferInitiator],
    },
    // Этап 5.3.1: защита платежных коллекций и сессий (закрывает находку
    // 5.3 — маршруты ядра не проверяли владельца корзины). Право на
    // коллекцию наследуется от права на её корзину (link
    // cart_payment_collection, Query API): гостевая корзина работает по
    // модели Medusa (id = секрет, гостевой checkout без регрессий),
    // авторизованная — только владелец; посторонним и неавторизованным —
    // контролируемый 404 без раскрытия суммы. Не затрагивает Admin API,
    // внутренние workflows ядра и будущие webhook-маршруты провайдеров.
    {
      methods: ["POST"],
      matcher: "/store/payment-collections",
      middlewares: [guardPaymentCollectionCreate],
    },
    {
      methods: ["POST"],
      matcher: "/store/payment-collections/:id/payment-sessions",
      // Этап 6.2: первой проверяется политика выбора провайдера
      // (production-запрет фиктивных способов — решение №41), затем
      // доступ владельца (5.3.1).
      middlewares: [guardPaymentProviderPolicy, guardPaymentSessionsAccess],
    },
    {
      methods: ["POST"],
      matcher: "/store/payment-collections/:id/payment-sessions/:session_id",
      middlewares: [guardPaymentSessionsAccess],
    },
    // Характеристики: список / создание / редактирование
    {
      methods: ["GET"],
      matcher: "/admin/catalog-attributes",
      middlewares: [validateAndTransformQuery(AdminListCatalogAttributesParams, {})],
    },
    {
      methods: ["POST"],
      matcher: "/admin/catalog-attributes",
      middlewares: [validateAndTransformBody(AdminCreateCatalogAttribute)],
    },
    {
      methods: ["POST"],
      matcher: "/admin/catalog-attributes/:id",
      middlewares: [validateAndTransformBody(AdminUpdateCatalogAttribute)],
    },

    // Допустимые значения характеристик
    {
      methods: ["POST"],
      matcher: "/admin/catalog-attributes/:id/options",
      middlewares: [validateAndTransformBody(AdminAddAttributeOptions)],
    },
    {
      methods: ["POST"],
      matcher: "/admin/catalog-attributes/:id/options/:option_id",
      middlewares: [validateAndTransformBody(AdminUpdateAttributeOption)],
    },

    // Привязки характеристик к категориям
    {
      methods: ["POST"],
      matcher: "/admin/catalog-attributes/:id/categories",
      middlewares: [validateAndTransformBody(AdminSetAttributeCategories)],
    },

    // Значения характеристик товара
    {
      methods: ["POST"],
      matcher: "/admin/products/:id/attribute-values",
      middlewares: [validateAndTransformBody(AdminSetProductAttributeValues)],
    },
    {
      methods: ["DELETE"],
      matcher: "/admin/products/:id/attribute-values",
      middlewares: [
        validateAndTransformQuery(AdminDeleteProductAttributeValuesParams, {}),
      ],
    },
  ],
})

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
    // Transfer: инициатор request/cancel — только покупатель с email,
    // совпадающим с email заказа (легитимная семантика переноса гостевого
    // заказа); чужой покупатель получает 404 без данных. Accept/decline
    // остаются штатными (подтверждение — одноразовый токен на email заказа).
    {
      methods: ["POST"],
      matcher: "/store/orders/:id/transfer/request",
      middlewares: [ensureTransferInitiator],
    },
    {
      methods: ["POST"],
      matcher: "/store/orders/:id/transfer/cancel",
      middlewares: [ensureTransferInitiator],
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

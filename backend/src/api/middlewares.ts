import {
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

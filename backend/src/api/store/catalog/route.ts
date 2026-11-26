import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type {
  CatalogErrorResponse,
  CatalogQuery,
  CatalogResponse,
} from "../../../types/catalog"
import { CatalogSearchService } from "../../../services/catalog-search"
import { catalogErrorResponse } from "../../../services/catalog-search"

/**
 * GET /store/catalog — каталог с товарами, фасетами, пагинацией и сортировкой
 * одним запросом. Поддерживает фильтры характеристик (filter[code]=v1,v2),
 * категории, коллекции, диапазоны цен, наличие, региональный контекст.
 *
 * Примеры: см. docs/api.md.
 */
export async function GET(
  req: MedusaStoreRequest,
  res: MedusaResponse<CatalogResponse | CatalogErrorResponse>
): Promise<void> {
  // Сервис создается на request scope: разрешение модулей идентично
  // контейнерной регистрации, но без зависимости от конвенции именования
  // app-сервисов Medusa.
  const service = new CatalogSearchService(req.scope)

  try {
    const query = service.parseQuery(
      req.query as Record<string, unknown>,
      false
    )
    const channelIds = req.publishable_key_context?.sales_channel_ids ?? []

    const response = await service.search(
      query as CatalogQuery,
      channelIds as string[]
    )
    res.json(response)
  } catch (error) {
    catalogErrorResponse(
      res,
      error,
      req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    )
  }
}

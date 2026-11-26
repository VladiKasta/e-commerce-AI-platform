import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import type {
  CatalogErrorResponse,
  CatalogResponse,
} from "../../../types/catalog"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CatalogSearchService } from "../../../services/catalog-search"
import { catalogErrorResponse } from "../../../services/catalog-search"

/**
 * GET /store/search — полнотекстовый поиск с тем же контрактом ответа, что и
 * каталог (единый сервис). Параметр q обязателен; поддерживает те же
 * фильтры, сортировку и пагинацию, что и /store/catalog.
 */
export async function GET(
  req: MedusaStoreRequest,
  res: MedusaResponse<CatalogResponse | CatalogErrorResponse>
): Promise<void> {
  const service = new CatalogSearchService(req.scope)

  try {
    const query = service.parseQuery(
      req.query as Record<string, unknown>,
      true
    )
    const channelIds = req.publishable_key_context?.sales_channel_ids ?? []

    const response = await service.search(query, channelIds as string[])
    res.json(response)
  } catch (error) {
    catalogErrorResponse(
      res,
      error,
      req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    )
  }
}

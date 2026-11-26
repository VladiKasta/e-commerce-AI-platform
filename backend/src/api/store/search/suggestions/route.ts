import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import type { SearchSuggestion } from "../../../../types/catalog"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CatalogSearchService } from "../../../../services/catalog-search"
import { catalogErrorResponse } from "../../../../services/catalog-search"

/**
 * GET /store/search/suggestions?q=... — поисковые подсказки (typeahead):
 * префиксный поиск по названию/артикулу, до 8 уникальных товаров.
 */
export async function GET(
  req: MedusaStoreRequest,
  res: MedusaResponse<
    { suggestions: SearchSuggestion[] } | { type: string; message: string }
  >
): Promise<void> {
  const service = new CatalogSearchService(req.scope)

  try {
    const q = typeof req.query.q === "string" ? req.query.q : ""
    const channelIds = req.publishable_key_context?.sales_channel_ids ?? []

    const suggestions = await service.suggest(q, channelIds as string[])
    res.json({ suggestions })
  } catch (error) {
    catalogErrorResponse(
      res,
      error,
      req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    )
  }
}

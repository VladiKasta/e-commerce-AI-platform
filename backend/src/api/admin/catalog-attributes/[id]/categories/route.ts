import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CatalogAttributeModuleService } from "../../../../../modules/catalog-attributes"
import type { AdminCategoryAttributesResponse } from "../../../../../types/admin-attributes"
import type { AdminSetAttributeCategoriesType } from "../../validators"
import {
  assertCategoriesExist,
  resolveAttributeService,
  resolveProductService,
} from "../../utils"

/** Тип фильтров сгенерированного listCategoryAttributes. */
type BindingFilters = Parameters<CatalogAttributeModuleService["listCategoryAttributes"]>[0]

/**
 * POST /admin/catalog-attributes/:id/categories — идемпотентная замена
 * всего набора привязок характеристики к категориям: порядок массива
 * задает position, пустой массив снимает все привязки. Категории
 * проверяются на существование (штатный Product Module).
 */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminSetAttributeCategoriesType>,
  res: MedusaResponse<AdminCategoryAttributesResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const productService = resolveProductService(req.scope)
  const attribute = await service.retrieveAttribute(req.params.id)
  const { category_ids: categoryIds } = req.validatedBody

  await assertCategoriesExist(productService, categoryIds)

  const existing = await service.listCategoryAttributes({
    attribute_id: attribute.id,
  } as BindingFilters)
  if (existing.length) {
    await service.softDeleteCategoryAttributes(existing.map((binding) => binding.id))
  }

  const created = categoryIds.length
    ? await service.createCategoryAttributes(
        categoryIds.map((categoryId, index) => ({
          category_id: categoryId,
          attribute_id: attribute.id,
          position: index + 1,
        }))
      )
    : []

  res.json({ category_attributes: created })
}

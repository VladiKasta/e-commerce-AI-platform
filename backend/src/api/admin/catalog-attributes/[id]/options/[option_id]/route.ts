import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { CatalogAttributeModuleService } from "../../../../../../modules/catalog-attributes"
import type {
  AdminAttributeOptionDeleteResponse,
  AdminAttributeOptionResponse,
} from "../../../../../../types/admin-attributes"
import type { AdminUpdateAttributeOptionType } from "../../../validators"
import { resolveAttributeService } from "../../../utils"

/** Тип фильтров сгенерированного listProductAttributeValues. */
type ValueFilters = Parameters<CatalogAttributeModuleService["listProductAttributeValues"]>[0]

/**
 * POST /admin/catalog-attributes/:id/options/:option_id — редактирование
 * допустимого значения (только подпись и позиция; машинное значение value
 * неизменяемо — на него ссылаются значения товаров и индекс).
 *
 * DELETE /admin/catalog-attributes/:id/options/:option_id — удаление
 * допустимого значения вместе со значениями товаров, которые на него
 * ссылаются (без «осиротевших» значений). Значения товаров удаляются
 * первыми: их события запускают переиндексацию затронутых товаров.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminUpdateAttributeOptionType>,
  res: MedusaResponse<AdminAttributeOptionResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const optionId = req.params.option_id

  // Проверяем, что опция принадлежит характеристике из пути.
  const attribute = await service.retrieveAttribute(req.params.id)
  const option = await service.retrieveAttributeOption(optionId)
  if (option.attribute_id !== attribute.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Значение ${optionId} не принадлежит характеристике ${attribute.id}`
    )
  }

  const update: Record<string, unknown> = {}
  for (const key of ["label", "position"] as const) {
    if (req.validatedBody[key] !== undefined) {
      update[key] = req.validatedBody[key]
    }
  }

  const [updated] = Object.keys(update).length
    ? await service.updateAttributeOptions([{ id: option.id, ...update }])
    : [option]

  res.json({ attribute_option: updated })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<AdminAttributeOptionDeleteResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const optionId = req.params.option_id

  const attribute = await service.retrieveAttribute(req.params.id)
  const option = await service.retrieveAttributeOption(optionId)
  if (option.attribute_id !== attribute.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Значение ${optionId} не принадлежит характеристике ${attribute.id}`
    )
  }

  // Значения товаров, ссылающиеся на удаляемое допустимое значение,
  // удаляются вместе с ним — не остаются «осиротевшими».
  // Фильтр по nullable-колонке text_value делается в коде — фильтр по
  // nullable-колонкам в Medusa Service неоднозначен (см. сервис модуля).
  const attributeValues = await service.listProductAttributeValues({
    attribute_id: attribute.id,
  } as ValueFilters)
  const referencingValues = attributeValues.filter(
    (value) => value.text_value === option.value
  )

  if (referencingValues.length) {
    await service.softDeleteProductAttributeValues(
      referencingValues.map((value) => value.id)
    )
  }

  await service.softDeleteAttributeOptions([option.id])

  res.json({
    id: option.id,
    object: "attribute-option",
    deleted: true,
  })
}

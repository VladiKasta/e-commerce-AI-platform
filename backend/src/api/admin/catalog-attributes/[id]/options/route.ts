import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { CatalogAttributeModuleService } from "../../../../../modules/catalog-attributes"
import type { AdminAttributeOptionsResponse } from "../../../../../types/admin-attributes"
import type { AdminAddAttributeOptionsType } from "../../validators"
import { resolveAttributeService } from "../../utils"

/** Тип фильтров сгенерированного listAttributeOptions. */
type OptionFilters = Parameters<CatalogAttributeModuleService["listAttributeOptions"]>[0]

/**
 * POST /admin/catalog-attributes/:id/options — добавление допустимых
 * значений характеристики (select/multi_select и подписи фасетов).
 * Дубликаты существующих значений отклоняются (400), значения из
 * запроса добавляются атомарным пакетом.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminAddAttributeOptionsType>,
  res: MedusaResponse<AdminAttributeOptionsResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const attribute = await service.retrieveAttribute(req.params.id)
  const { options: payload } = req.validatedBody

  const existing = await service.listAttributeOptions({
    attribute_id: attribute.id,
  } as OptionFilters)
  const existingValues = new Set(existing.map((option) => option.value))
  const duplicates = payload
    .map((option) => option.value)
    .filter((value) => existingValues.has(value))

  if (duplicates.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Значения уже существуют у характеристики "${attribute.code}": ${duplicates.join(", ")}`
    )
  }

  const created = await service.createAttributeOptions(
    payload.map((option, index) => ({
      attribute_id: attribute.id,
      value: option.value,
      label: option.label,
      position: option.position ?? existing.length + index + 1,
    }))
  )

  res.status(201).json({ attribute_options: created })
}

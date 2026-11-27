import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { CatalogAttributeModuleService } from "../../../../modules/catalog-attributes"
import type {
  AdminCatalogAttributeDeleteResponse,
  AdminCatalogAttributeResponse,
} from "../../../../types/admin-attributes"
import type { AdminUpdateCatalogAttributeType } from "../validators"
import { resolveAttributeService } from "../utils"

/** Тип фильтров сгенерированных list-методов модуля. */
type AttributeFilters = Parameters<CatalogAttributeModuleService["listAttributes"]>[0]
type OptionFilters = Parameters<CatalogAttributeModuleService["listAttributeOptions"]>[0]
type BindingFilters = Parameters<CatalogAttributeModuleService["listCategoryAttributes"]>[0]
type ValueFilters = Parameters<CatalogAttributeModuleService["listProductAttributeValues"]>[0]

/**
 * GET /admin/catalog-attributes/:id — характеристика с допустимыми
 * значениями и привязками к категориям.
 *
 * POST /admin/catalog-attributes/:id — редактирование. Неизменяемые поля:
 * code и data_type (ключи поискового индекса и типизированных колонок).
 *
 * DELETE /admin/catalog-attributes/:id — удаление характеристики
 * вместе со всеми зависимыми записями (значения товаров, допустимые
 * значения, привязки к категориям) — без «осиротевших» строк.
 * Зависимости удаляются до самой характеристики.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<AdminCatalogAttributeResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const attribute = await service.retrieveAttribute(req.params.id)

  const [options, bindings] = await Promise.all([
    service.listAttributeOptions({
      attribute_id: attribute.id,
    } as OptionFilters),
    service.listCategoryAttributes({
      attribute_id: attribute.id,
    } as BindingFilters),
  ])

  res.json({
    attribute: {
      ...attribute,
      options: options.sort((a, b) => a.position - b.position),
      categories: bindings,
    },
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest<AdminUpdateCatalogAttributeType>,
  res: MedusaResponse<AdminCatalogAttributeResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const body = req.validatedBody
  const attribute = await service.retrieveAttribute(req.params.id)

  // Неизменяемые поля: только явное изменение отклоняется.
  if (body.code !== undefined && body.code !== attribute.code) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Код характеристики неизменяем (текущий: "${attribute.code}")`
    )
  }
  if (body.data_type !== undefined && body.data_type !== attribute.data_type) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Тип данных характеристики неизменяем (текущий: "${attribute.data_type}") — существующие значения хранятся в типизированных колонках`
    )
  }

  const update: Record<string, unknown> = {}
  for (const key of [
    "name",
    "filter_type",
    "unit",
    "filterable",
    "searchable",
    "position",
    "option_title",
  ] as const) {
    if (body[key] !== undefined) {
      update[key] = body[key]
    }
  }

  const [updated] = Object.keys(update).length
    ? await service.updateAttributes([{ id: attribute.id, ...update }])
    : [attribute]

  const [options, bindings] = await Promise.all([
    service.listAttributeOptions({ attribute_id: attribute.id } as OptionFilters),
    service.listCategoryAttributes({ attribute_id: attribute.id } as BindingFilters),
  ])

  res.json({
    attribute: {
      ...updated,
      options: options.sort((a, b) => a.position - b.position),
      categories: bindings,
    },
  })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<AdminCatalogAttributeDeleteResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const attribute = await service.retrieveAttribute(req.params.id)

  // Порядок каскада: значения → допустимые значения → привязки → сама
  // характеристика. Зависимости никогда не переживают владельца.
  const [options, bindings, values] = await Promise.all([
    service.listAttributeOptions({ attribute_id: attribute.id } as OptionFilters),
    service.listCategoryAttributes({ attribute_id: attribute.id } as BindingFilters),
    service.listProductAttributeValues({
      attribute_id: attribute.id,
    } as ValueFilters),
  ])

  if (values.length) {
    await service.softDeleteProductAttributeValues(values.map((value) => value.id))
  }
  if (options.length) {
    await service.softDeleteAttributeOptions(options.map((option) => option.id))
  }
  if (bindings.length) {
    await service.softDeleteCategoryAttributes(bindings.map((binding) => binding.id))
  }

  await service.softDeleteAttributes([attribute.id])

  res.json({
    id: attribute.id,
    object: "catalog-attribute",
    deleted: true,
  })
}

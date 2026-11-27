import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { CatalogAttributeModuleService } from "../../../modules/catalog-attributes"
import type {
  AdminListCatalogAttributesResponse,
  AdminCatalogAttributeResponse,
} from "../../../types/admin-attributes"
import type {
  AdminCreateCatalogAttributeType,
  AdminListCatalogAttributesParamsType,
} from "./validators"
import { resolveAttributeService } from "./utils"

/** Тип фильтров сгенерированного listAttributes (по коду/ID). */
type AttributeFilters = Parameters<CatalogAttributeModuleService["listAttributes"]>[0]
/** Тип фильтров сгенерированного listAttributeOptions. */
type OptionFilters = Parameters<CatalogAttributeModuleService["listAttributeOptions"]>[0]

/**
 * GET /admin/catalog-attributes — реестр характеристик с допустимыми
 * значениями и привязками к категориям.
 *
 * POST /admin/catalog-attributes — создание характеристики (и опционально
 * ее допустимых значений одним запросом).
 *
 * Валидация: src/api/middlewares.ts (штатные validateAndTransformBody /
 * validateAndTransformQuery). Авторизация: штатная для всех /admin/*
 * (Bearer JWT или сессия Medusa Admin).
 */
export async function GET(
  req: AuthenticatedMedusaRequest<never, AdminListCatalogAttributesParamsType>,
  res: MedusaResponse<AdminListCatalogAttributesResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const { q, limit, offset } = req.validatedQuery

  const attributes = await service.listAttributes()
  const [options, bindings] = await Promise.all([
    service.listAttributeOptions(),
    service.listCategoryAttributes(),
  ])

  const optionsByAttribute = new Map<string, typeof options>()
  for (const option of options) {
    const bucket = optionsByAttribute.get(option.attribute_id) ?? []
    bucket.push(option)
    optionsByAttribute.set(option.attribute_id, bucket)
  }

  const bindingsByAttribute = new Map<string, typeof bindings>()
  for (const binding of bindings) {
    const bucket = bindingsByAttribute.get(binding.attribute_id) ?? []
    bucket.push(binding)
    bindingsByAttribute.set(binding.attribute_id, bucket)
  }

  const decorate = (attribute: (typeof attributes)[number]) => ({
    ...attribute,
    options: (optionsByAttribute.get(attribute.id) ?? []).sort(
      (a, b) => a.position - b.position
    ),
    categories: bindingsByAttribute.get(attribute.id) ?? [],
  })

  const normalizedQuery = q?.trim().toLowerCase()
  const filtered = normalizedQuery
    ? attributes.filter(
        (attribute) =>
          attribute.code.toLowerCase().includes(normalizedQuery) ||
          attribute.name.toLowerCase().includes(normalizedQuery)
      )
    : attributes

  const page = filtered
    .sort((a, b) => a.position - b.position || a.code.localeCompare(b.code))
    .slice(offset, offset + limit)

  res.json({
    attributes: page.map(decorate),
    count: filtered.length,
    limit,
    offset,
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest<AdminCreateCatalogAttributeType>,
  res: MedusaResponse<AdminCatalogAttributeResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const body = req.validatedBody

  const existing = await service.listAttributes({ code: body.code } as AttributeFilters)
  if (existing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Характеристика с кодом "${body.code}" уже существует`
    )
  }

  const [attribute] = await service.createAttributes([
    {
      code: body.code,
      name: body.name,
      data_type: body.data_type,
      filter_type: body.filter_type,
      unit: body.unit ?? null,
      filterable: body.filterable,
      searchable: body.searchable,
      position: body.position,
      option_title: body.option_title ?? null,
    },
  ])

  if (body.options.length) {
    await service.createAttributeOptions(
      body.options.map((option, index) => ({
        attribute_id: attribute.id,
        value: option.value,
        label: option.label,
        position: option.position ?? index + 1,
      }))
    )
  }

  const options = await service.listAttributeOptions({
    attribute_id: attribute.id,
  } as OptionFilters)

  res.status(201).json({
    attribute: {
      ...attribute,
      options: options.sort((a, b) => a.position - b.position),
      categories: [],
    },
  })
}

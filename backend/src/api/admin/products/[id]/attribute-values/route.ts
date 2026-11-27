import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { CatalogAttributeModuleService } from "../../../../../modules/catalog-attributes"
import type {
  AdminProductAttributeValuesDeleteResponse,
  AdminProductAttributeValuesResponse,
} from "../../../../../types/admin-attributes"
import type {
  AdminDeleteProductAttributeValuesParamsType,
  AdminSetProductAttributeValuesType,
} from "../../../catalog-attributes/validators"
import {
  assertOptionValuesExist,
  assertProductAndVariantExist,
  assertValueMatchesDataType,
  resolveAttributeService,
  resolveProductService,
} from "../../../catalog-attributes/utils"

/** Тип фильтров сгенерированного listProductAttributeValues. */
type ValueFilters = Parameters<CatalogAttributeModuleService["listProductAttributeValues"]>[0]

/**
 * GET /admin/products/:id/attribute-values — значения характеристик товара.
 *
 * POST /admin/products/:id/attribute-values — идемпотентная перезапись
 * значений: для каждой пары (характеристика × товар/вариант) набор
 * значений заменяется целиком (setProductAttributeValues модуля).
 * Проверяются: существование товара и варианта, существование
 * характеристик, соответствие типов и (для select/multi_select)
 * допустимость значений.
 *
 * DELETE /admin/products/:id/attribute-values?attribute_id=...[&variant_id=...]
 * — удаление значений одной характеристики в области товара (или
 * конкретного варианта). Значения помечаются deleted_at (soft delete):
 * маршрут отвечает прежним контрактом, а строки остаются читаемыми
 * для событийной синхронизации поискового индекса.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<AdminProductAttributeValuesResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const productService = resolveProductService(req.scope)
  const productId = req.params.id

  // 404, если товар не существует
  await productService.retrieveProduct(productId)

  const values = await service.listProductAttributeValues({
    product_id: productId,
  } as ValueFilters)

  res.json({ product_attribute_values: values })
}

export async function POST(
  req: AuthenticatedMedusaRequest<AdminSetProductAttributeValuesType>,
  res: MedusaResponse<AdminProductAttributeValuesResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const productService = resolveProductService(req.scope)
  const productId = req.params.id
  const { values: payload } = req.validatedBody

  // Проверяем товар/варианты и существование характеристик.
  for (const item of payload) {
    await assertProductAndVariantExist(productService, productId, item.variant_id ?? null)
  }

  const attributeIds = [...new Set(payload.map((item) => item.attribute_id))]
  const attributes = await service.listAttributes({ id: attributeIds } as Parameters<
    CatalogAttributeModuleService["listAttributes"]
  >[0])
  const attributeById = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  const missingAttributes = attributeIds.filter((id) => !attributeById.has(id))

  if (missingAttributes.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Характеристики не найдены: ${missingAttributes.join(", ")}`
    )
  }

  // Типы значений и допустимость значений (select/multi_select).
  for (const item of payload) {
    const attribute = attributeById.get(item.attribute_id)
    if (!attribute) {
      continue
    }
    assertValueMatchesDataType(attribute, item.value)
    if (typeof item.value === "string") {
      await assertOptionValuesExist(service, attribute, [item.value])
    }
  }

  const created = await service.setProductAttributeValues(
    payload.map((item) => ({
      product_id: productId,
      variant_id: item.variant_id ?? null,
      attribute_id: item.attribute_id,
      value: item.value,
    }))
  )

  res.status(201).json({ product_attribute_values: created })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest<
    never,
    AdminDeleteProductAttributeValuesParamsType
  >,
  res: MedusaResponse<AdminProductAttributeValuesDeleteResponse>
): Promise<void> {
  const service = resolveAttributeService(req.scope)
  const productService = resolveProductService(req.scope)
  const productId = req.params.id
  const { attribute_id: attributeId, variant_id: variantId } = req.validatedQuery

  await productService.retrieveProduct(productId)
  await service.retrieveAttribute(attributeId)

  const existing = await service.listProductAttributeValues({
    attribute_id: attributeId,
    product_id: productId,
  } as ValueFilters)

  // Область удаления: уровень товара или конкретного варианта
  // (фильтр по nullable variant_id в коде — как в сервисе модуля).
  const scopeVariantId = variantId ?? null
  const stale = existing.filter((value) => (value.variant_id ?? null) === scopeVariantId)

  if (stale.length) {
    // Soft delete (не физическое удаление): событие удаления значения
    // несет только id строк, и строки должны остаться читаемыми для
    // резолвинга затронутых товаров событийной синхронизацией индекса.
    await service.softDeleteProductAttributeValues(stale.map((value) => value.id))
  }

  res.json({
    ids: stale.map((value) => value.id),
    object: "product-attribute-value",
    deleted: true,
    product_id: productId,
    attribute_id: attributeId,
    variant_id: scopeVariantId,
  })
}

import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import {
  CATALOG_ATTRIBUTES_MODULE,
  type AttributeDTO,
  type CatalogAttributeModuleService,
} from "../../../modules/catalog-attributes"

/**
 * Общие проверки целостности Admin API характеристик. Все ошибки —
 * MedusaError: глобальный error-handler Medusa превращает их в стандартный
 * контракт {type, message} с корректным HTTP-кодом (400/404).
 */

export function resolveAttributeService(
  scope: { resolve<T>(key: string): T }
): CatalogAttributeModuleService {
  return scope.resolve<CatalogAttributeModuleService>(CATALOG_ATTRIBUTES_MODULE)
}

export function resolveProductService(
  scope: { resolve<T>(key: string): T }
): IProductModuleService {
  return scope.resolve<IProductModuleService>(Modules.PRODUCT)
}

/**
 * Проверяет соответствие типа значения типу данных характеристики:
 * защищает типизированные колонки (text/numeric/boolean) от
 * некорректных записей.
 */
export function assertValueMatchesDataType(
  attribute: Pick<AttributeDTO, "code" | "data_type">,
  value: string | number | boolean
): void {
  const expected =
    attribute.data_type === "number"
      ? "number"
      : attribute.data_type === "boolean"
        ? "boolean"
        : "string"

  if (typeof value !== expected) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Значение характеристики "${attribute.code}" (тип ${attribute.data_type}) должно быть ${expected}`
    )
  }
}

/**
 * Для select/multi_select значение обязано существовать среди допустимых
 * значений характеристики — предотвращает «осиротевшие» значения
 * без опции.
 */
export async function assertOptionValuesExist(
  service: CatalogAttributeModuleService,
  attribute: Pick<AttributeDTO, "id" | "code" | "data_type">,
  values: string[]
): Promise<void> {
  if (attribute.data_type !== "select" && attribute.data_type !== "multi_select") {
    return
  }

  const options = await service.listAttributeOptions(
    { attribute_id: attribute.id } as Parameters<
      CatalogAttributeModuleService["listAttributeOptions"]
    >[0]
  )
  const known = new Set(options.map((option) => option.value))
  const missing = [...new Set(values)].filter((value) => !known.has(value))

  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Неизвестные значения для характеристики "${attribute.code}": ${missing.join(", ")}`
    )
  }
}

/**
 * Проверяет существование товара (и, опционально, его варианта) —
 * предотвращает значения у несуществующих товаров.
 */
export async function assertProductAndVariantExist(
  productService: IProductModuleService,
  productId: string,
  variantId?: string | null
): Promise<void> {
  // 404, если товар не существует
  await productService.retrieveProduct(productId)

  if (!variantId) {
    return
  }

  const variants = await productService.listProductVariants({
    id: variantId,
    product_id: productId,
  })

  if (!variants.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Вариант ${variantId} не принадлежит товару ${productId}`
    )
  }
}

/**
 * Проверяет существование категорий — предотвращает привязки
 * характеристик к несуществующим категориям.
 */
export async function assertCategoriesExist(
  productService: IProductModuleService,
  categoryIds: string[]
): Promise<void> {
  if (!categoryIds.length) {
    return
  }

  const categories = await productService.listProductCategories({ id: categoryIds })
  const found = new Set(categories.map((category) => category.id))
  const missing = [...new Set(categoryIds)].filter((id) => !found.has(id))

  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Категории не найдены: ${missing.join(", ")}`
    )
  }
}

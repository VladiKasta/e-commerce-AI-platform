import { MedusaService } from "@medusajs/framework/utils"
import {
  Attribute,
  AttributeOption,
  CategoryAttribute,
  ProductAttributeValue,
} from "./models"
import type { AttributeDataType, AttributeFilterType } from "./models"

/** DTO-типы модуля характеристик (структурные: колонки таблиц). */
export type AttributeDTO = {
  id: string
  code: string
  name: string
  data_type: AttributeDataType
  filter_type: AttributeFilterType
  unit: string | null
  filterable: boolean
  searchable: boolean
  position: number
  option_title: string | null
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export type AttributeOptionDTO = {
  id: string
  attribute_id: string
  value: string
  label: string
  position: number
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export type CategoryAttributeDTO = {
  id: string
  category_id: string
  attribute_id: string
  position: number
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export type ProductAttributeValueDTO = {
  id: string
  attribute_id: string
  product_id: string
  variant_id: string | null
  text_value: string | null
  numeric_value: number | null
  boolean_value: boolean | null
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export type UpsertProductAttributeValueInput = {
  product_id: string
  variant_id?: string | null
  attribute_id: string
  /** Значение характеристики: код опции, произвольная строка, число или boolean. */
  value: string | number | boolean
}

/**
 * Сервис модуля универсальных характеристик товаров.
 *
 * MedusaService генерирует базовые CRUD-методы для каждой модели
 * (createAttributes, listAttributes, updateAttributes, deleteAttributes,
 * createAttributeOptions, ...) — см. MedusaServiceReturnType. Ниже добавлены
 * только составные операции, которых нет в сгенерированном API.
 */
class CatalogAttributeModuleService extends MedusaService({
  Attribute,
  AttributeOption,
  CategoryAttribute,
  ProductAttributeValue,
}) {
  /**
   * Заменяет весь набор значений характеристики для товара (или конкретного
   * варианта): идемпотентная операция "перезаписать список значений".
   */
  async setProductAttributeValues(
    input: UpsertProductAttributeValueInput[]
  ): Promise<ProductAttributeValueDTO[]> {
    if (!input.length) {
      return []
    }

    const created: ProductAttributeValueDTO[] = []

    // Группируем по (attribute, product, variant) и перезаписываем значения.
    const scope = new Map<
      string,
      {
        attribute_id: string
        product_id: string
        variant_id: string | null
        values: UpsertProductAttributeValueInput[]
      }
    >()

    for (const item of input) {
      const key = `${item.attribute_id}__${item.product_id}__${item.variant_id ?? "-"}`
      const entry = scope.get(key) ?? {
        attribute_id: item.attribute_id,
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        values: [],
      }
      entry.values.push(item)
      scope.set(key, entry)
    }

    for (const entry of scope.values()) {
      await this.deleteScopeValues(entry)

      const rows = entry.values.map((item) => ({
        attribute_id: entry.attribute_id,
        product_id: entry.product_id,
        variant_id: entry.variant_id,
        ...CatalogAttributeModuleService.typedValueColumns(item.value),
      }))

      created.push(...(await this.createProductAttributeValues(rows)))
    }

    return created
  }

  /**
   * Удаляет существующие значения характеристики в заданной области
   * (товар или конкретный вариант) soft delete-ом. Имя отличается от
   * сгенерированного MedusaService.deleteProductAttributeValues(ids), чтобы не
   * перекрывать его рекурсивно.
   *
   * Soft delete (а не физическое удаление) нужен событийной синхронизации
   * поискового индекса: событие catalog_attributes.product-attribute-value.
   * deleted несет только id строк, а строки к моменту обработки события
   * должны оставаться читаемыми (сервис модуля, withDeleted) для резолвинга
   * затронутых товаров. Семантика модуля не меняется: list-методы и
   * query.graph по умолчанию не возвращают soft-deleted строки.
   */
  private async deleteScopeValues(entry: {
    attribute_id: string
    product_id: string
    variant_id: string | null
  }): Promise<void> {
    // Читаем все значения (товар, характеристика) и фильтруем scope
    // (уровень товара или конкретного варианта) в коде: фильтр по
    // nullable-колонке в Medusa Service неоднозначен.
    const existing = await this.listProductAttributeValues({
      attribute_id: entry.attribute_id,
      product_id: entry.product_id,
    } as Parameters<typeof this.listProductAttributeValues>[0])

    const stale = existing
      .filter((row) => (row.variant_id ?? null) === entry.variant_id)
      .map((row) => row.id)

    if (stale.length) {
      await this.softDeleteProductAttributeValues(stale)
    }
  }

  /** Раскладывает значение по типизированной колонке по типу данных. */
  private static typedValueColumns(
    value: string | number | boolean
  ): Pick<
    ProductAttributeValueDTO,
    "text_value" | "numeric_value" | "boolean_value"
  > {
    if (typeof value === "number") {
      return { text_value: null, numeric_value: value, boolean_value: null }
    }
    if (typeof value === "boolean") {
      return { text_value: null, numeric_value: null, boolean_value: value }
    }
    return { text_value: value, numeric_value: null, boolean_value: null }
  }
}

export default CatalogAttributeModuleService
export { CatalogAttributeModuleService }
export type { AttributeDataType, AttributeFilterType }

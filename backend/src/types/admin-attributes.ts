import type {
  AttributeOptionDTO,
  AttributeDTO,
  CategoryAttributeDTO,
  ProductAttributeValueDTO,
} from "../modules/catalog-attributes"

/**
 * Контракты ответов Admin API характеристик каталога (этап 3).
 *
 * Формат следует конвенциям Medusa Admin API: обертка по имени сущности,
 * delete-ответы — { id, object, deleted: true }.
 */

/** Характеристика с допустимыми значениями и привязками к категориям. */
export type AdminAttribute = AttributeDTO & {
  options: AttributeOptionDTO[]
  categories: CategoryAttributeDTO[]
}

export type AdminListCatalogAttributesResponse = {
  attributes: AdminAttribute[]
  count: number
  limit: number
  offset: number
}

export type AdminCatalogAttributeResponse = {
  attribute: AdminAttribute
}

export type AdminCatalogAttributeDeleteResponse = {
  id: string
  object: "catalog-attribute"
  deleted: true
}

export type AdminAttributeOptionsResponse = {
  attribute_options: AttributeOptionDTO[]
}

export type AdminAttributeOptionResponse = {
  attribute_option: AttributeOptionDTO
}

export type AdminAttributeOptionDeleteResponse = {
  id: string
  object: "attribute-option"
  deleted: true
}

export type AdminCategoryAttributesResponse = {
  category_attributes: CategoryAttributeDTO[]
}

export type AdminProductAttributeValuesResponse = {
  product_attribute_values: ProductAttributeValueDTO[]
}

export type AdminProductAttributeValuesDeleteResponse = {
  ids: string[]
  object: "product-attribute-value"
  deleted: true
  product_id: string
  attribute_id: string
  variant_id: string | null
}

import { model } from "@medusajs/framework/utils"

/**
 * Значение характеристики, назначенное товару или варианту.
 *
 * Хранится в типизированных колонках: text_value — для text/select/
 * multi_select (код значения), numeric_value — для number, boolean_value —
 * для boolean. Заполнена ровно одна из них.
 *
 * product_id — всегда заполнен (значение уровня товара или товара-владельца
 * варианта); variant_id — только для вариант-специфичных значений.
 *
 * Ссылки на product/variant хранятся как ID без внешних ключей: модуль
 * описывает проекцию каталога, а не расширяет таблицы Medusa (штатные
 * Module Links для этой модели не дают преимуществ — доступ идет через
 * собственный сервис и query.graph модуля, см. docs/filters.md).
 */
const ProductAttributeValue = model
  .define("product_attribute_value", {
    id: model.id().primaryKey(),
    attribute_id: model.text(),
    product_id: model.text(),
    variant_id: model.text().nullable(),
    text_value: model.text().nullable(),
    numeric_value: model.float().nullable(),
    boolean_value: model.boolean().nullable(),
  })
  .indexes([
    { on: ["product_id", "attribute_id"], name: "product_attribute_value_lookup" },
    { on: ["attribute_id"], name: "product_attribute_value_attribute_idx" },
  ])

export default ProductAttributeValue

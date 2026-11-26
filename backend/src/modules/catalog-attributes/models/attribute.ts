import { model } from "@medusajs/framework/utils"

/**
 * Тип данных значения характеристики. Определяет, как значение хранится
 * в ProductAttributeValue и как оно попадает в поисковый индекс.
 */
export const AttributeDataTypes = [
  "text",
  "number",
  "boolean",
  "select",
  "multi_select",
]

export type AttributeDataType = (typeof AttributeDataTypes)[number]

/**
 * Способ отображения фильтра на витрине. Независим от типа данных:
 * например, строковая характеристика может отображаться как select, radio
 * или color, а числовая — как range или checkbox по предопределенным
 * значениям.
 */
export const AttributeFilterTypes = [
  "checkbox",
  "select",
  "radio",
  "range",
  "color",
  "boolean",
]

export type AttributeFilterType = (typeof AttributeFilterTypes)[number]

/**
 * Универсальная характеристика товара (бренд, материал, технический
 * параметр). Характеристики создаются администратором и не требуют
 * изменений кода витрины: поисковый индекс фильтрует все вложенные поля
 * объекта `attributes` динамически.
 */
const Attribute = model
  .define("attribute", {
    id: model.id().primaryKey(),
    /** Уникальный код характеристики (латиница, kebab/snake): brand, material. */
    code: model.text(),
    /** Человекочитаемое название: «Бренд», «Материал». */
    name: model.text(),
    /** Тип хранимого значения. */
    data_type: model.enum(AttributeDataTypes).default("text"),
    /** Способ отображения фильтра на витрине. */
    filter_type: model.enum(AttributeFilterTypes).default("checkbox"),
    /** Единица измерения для отображения (мм, г/м², «» — безразмерная). */
    unit: model.text().nullable(),
    /** Участвует ли характеристика в фильтрации каталога. */
    filterable: model.boolean().default(true),
    /** Участвует ли значение характеристики в полнотекстовом поиске. */
    searchable: model.boolean().default(true),
    /** Порядок отображения фильтра на витрине. */
    position: model.number().default(0),
    /**
     * Название штатной опции товара Medusa (например «Цвет» или «Размер»),
     * из которой берутся значения характеристики для вариантов. Позволяет
     * фильтровать по вариантам, не дублируя штатные Product Options:
     * значение характеристики варианта выводится из его опции, а значения
     * товара — из ProductAttributeValue. null — характеристика назначается
     * только вручную.
     */
    option_title: model.text().nullable(),
  })
  .indexes([
    { on: ["code"], unique: true, name: "attribute_code_unique" },
  ])

export default Attribute

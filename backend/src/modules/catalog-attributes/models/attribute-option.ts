import { model } from "@medusajs/framework/utils"

/**
 * Предопределенное значение характеристики (для типов select/multi_select
 * и для отображения человекочитаемых подписей значений фильтров).
 */
const AttributeOption = model
  .define("attribute_option", {
    id: model.id().primaryKey(),
    attribute_id: model.text(),
    /** Машинное значение: хранится в поисковом индексе и приходит в фильтрах. */
    value: model.text(),
    /** Подпись для витрины: «Органический хлопок» для значения organic-cotton. */
    label: model.text(),
    position: model.number().default(0),
  })
  .indexes([
    { on: ["attribute_id", "value"], unique: true, name: "attribute_option_value_unique" },
  ])

export default AttributeOption

import { model } from "@medusajs/framework/utils"

/**
 * Привязка характеристики к категории: определяет, какие фильтры показывать
 * в каталоге категории и в каком порядке. Товар без привязанных к категории
 * характеристик не покажет фильтров этой категории, но значения остаются
 * в индексе и фильтруются напрямую.
 */
const CategoryAttribute = model
  .define("category_attribute", {
    id: model.id().primaryKey(),
    category_id: model.text(),
    attribute_id: model.text(),
    position: model.number().default(0),
  })
  .indexes([
    { on: ["category_id", "attribute_id"], unique: true, name: "category_attribute_unique" },
  ])

export default CategoryAttribute

import { Module } from "@medusajs/framework/utils"
import CatalogAttributeModuleService from "./service"

/**
 * Модуль универсальных характеристик товаров (бренды, материалы,
 * технические параметры). Не дублирует штатные Product Options Medusa:
 * значения, определяющие покупаемый вариант (цвет, размер), берутся из
 * штатных опций через Attribute.option_title.
 *
 * Регистрационное имя контейнера: "catalogAttributes". Имя модуля —
 * snake_case (требование линтера @medusajs/module-name-snake-case),
 * события модуля: "catalog_attributes.<entity>.<action>".
 */
export const CATALOG_ATTRIBUTES_MODULE = "catalog_attributes"

export default Module(CATALOG_ATTRIBUTES_MODULE, {
  service: CatalogAttributeModuleService,
})

export { CatalogAttributeModuleService }
export * from "./models"
export * from "./service"

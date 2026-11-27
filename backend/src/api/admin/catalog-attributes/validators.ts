import { z } from "@medusajs/framework/zod"
import type {
  AttributeDataType,
  AttributeFilterType,
} from "../../../modules/catalog-attributes"

/**
 * Zod-схемы Admin API характеристик каталога (этап 3).
 *
 * Валидация применяется штатными middleware validateAndTransformBody /
 * validateAndTransformQuery (см. src/api/middlewares.ts) — это тот же
 * механизм, что использует ядро Medusa для своих Admin-маршрутов.
 *
 * Списки допустимых значений data_type / filter_type связаны с моделью
 * Attribute на уровне типов (satisfies readonly ...).
 */

const dataTypeSchema = z.enum(
  ["text", "number", "boolean", "select", "multi_select"] satisfies readonly AttributeDataType[]
)

const filterTypeSchema = z.enum(
  ["checkbox", "select", "radio", "range", "color", "boolean"] satisfies readonly AttributeFilterType[]
)

const attributeCodeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "code должен быть латиницей в kebab/snake-регистре")

const optionPayloadSchema = z.object({
  /** Машинное значение: хранится в индексе и приходит в фильтрах. */
  value: z.string().min(1).max(100),
  /** Человекочитаемая подпись. */
  label: z.string().min(1).max(255),
  position: z.number().int().min(0).optional(),
})

const uniqueOptionValues = z
  .array(optionPayloadSchema)
  .refine(
    (options) => new Set(options.map((option) => option.value)).size === options.length,
    { message: "Дубликаты значений (value) внутри запроса" }
  )

/** POST /admin/catalog-attributes */
export const AdminCreateCatalogAttribute = z
  .object({
    code: attributeCodeSchema,
    name: z.string().min(1).max(255),
    data_type: dataTypeSchema.default("text"),
    filter_type: filterTypeSchema.default("checkbox"),
    unit: z.string().max(50).nullish(),
    filterable: z.boolean().default(true),
    searchable: z.boolean().default(true),
    position: z.number().int().min(0).default(0),
    option_title: z.string().max(255).nullish(),
    /** Допустимые значения для select/multi_select (и подписи фасетов). */
    options: uniqueOptionValues.default([]),
  })

export type AdminCreateCatalogAttributeType = z.infer<typeof AdminCreateCatalogAttribute>

/**
 * POST /admin/catalog-attributes/:id
 *
 * code и data_type перечислены в схеме, но считаются неизменяемыми:
 * маршрут отклоняет их изменение (400), потому что они являются ключами
 * поискового индекса и типизированных колонок значений.
 */
export const AdminUpdateCatalogAttribute = z.object({
  code: attributeCodeSchema.optional(),
  name: z.string().min(1).max(255).optional(),
  data_type: dataTypeSchema.optional(),
  filter_type: filterTypeSchema.optional(),
  unit: z.string().max(50).nullish(),
  filterable: z.boolean().optional(),
  searchable: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  option_title: z.string().max(255).nullish(),
})

export type AdminUpdateCatalogAttributeType = z.infer<typeof AdminUpdateCatalogAttribute>

/** GET /admin/catalog-attributes */
export const AdminListCatalogAttributesParams = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type AdminListCatalogAttributesParamsType = z.infer<
  typeof AdminListCatalogAttributesParams
>

/** POST /admin/catalog-attributes/:id/options */
export const AdminAddAttributeOptions = z
  .object({
    options: uniqueOptionValues.min(1),
  })

export type AdminAddAttributeOptionsType = z.infer<typeof AdminAddAttributeOptions>

/**
 * POST /admin/catalog-attributes/:id/options/:option_id
 *
 * value (машинное значение) неизменяемо: на него ссылаются значения
 * товаров и поисковый индекс.
 */
export const AdminUpdateAttributeOption = z.object({
  label: z.string().min(1).max(255).optional(),
  position: z.number().int().min(0).optional(),
})

export type AdminUpdateAttributeOptionType = z.infer<typeof AdminUpdateAttributeOption>

/**
 * POST /admin/catalog-attributes/:id/categories
 *
 * Идемпотентная замена всего набора привязок характеристики к категориям
 * (порядок массива задает position). Пустой массив снимает все привязки.
 */
export const AdminSetAttributeCategories = z
  .object({
    category_ids: z
      .array(z.string().min(1))
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Дубликаты category_id внутри запроса",
      }),
  })

export type AdminSetAttributeCategoriesType = z.infer<typeof AdminSetAttributeCategories>

/**
 * POST /admin/products/:id/attribute-values
 *
 * Для каждой пары (характеристика × товар/вариант) набор значений
 * перезаписывается целиком (идемпотентно) — семантика
 * CatalogAttributeModuleService.setProductAttributeValues.
 */
export const AdminSetProductAttributeValues = z.object({
  values: z
    .array(
      z.object({
        attribute_id: z.string().min(1),
        variant_id: z.string().min(1).nullish(),
        value: z.union([z.string().min(1), z.number(), z.boolean()]),
      })
    )
    .min(1),
})

export type AdminSetProductAttributeValuesType = z.infer<typeof AdminSetProductAttributeValues>

/** DELETE /admin/products/:id/attribute-values */
export const AdminDeleteProductAttributeValuesParams = z.object({
  attribute_id: z.string().min(1),
  variant_id: z.string().min(1).optional(),
})

export type AdminDeleteProductAttributeValuesParamsType = z.infer<
  typeof AdminDeleteProductAttributeValuesParams
>

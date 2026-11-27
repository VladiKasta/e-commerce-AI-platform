import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState, type ReactNode } from "react"
import {
  Badge,
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import {
  attributesApi,
  productAttributeValuesApi,
  productCategoriesOf,
  readRawValue,
  type AttributeDTO,
} from "../lib/catalog-attributes"

/**
 * Виджет «Характеристики товара» на странице товара Medusa Admin (этап 3.5.3).
 *
 * Зона product.details.after; данные — существующие Admin API (маршруты
 * 15–26 из docs/api.md). Характеристики со штатной опцией (option_title,
 * например «Цвет»/«Размер») не показываются: их значения берутся из
 * Product Options вариантов и редактируются штатным UI (без дублирования).
 *
 * Доступные характеристики вычисляются по категориям товара с соблюдением
 * семантики backend (docs/api.md, раздел про привязки): категория без
 * привязок открывает все характеристики; категория с привязками — только
 * свой набор; объединение по категориям без дубликатов. Уже назначенные
 * значения отображаются и редактируются независимо от категорий
 * (значения не удаляются при смене категорий).
 */

type WidgetProduct = { id: string }

const ATTRIBUTES_KEY = ["catalog-attributes"] as const

/** Черновик значения: undefined = нет значения; массив = multi_select. */
type DraftValue = string | number | boolean | string[] | undefined

const ProductAttributesWidget = ({ data }: { data: WidgetProduct }) => {
  const productId = data.id
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["product-attribute-values", productId],
    })
  }

  const categoriesQuery = useQuery({
    queryKey: ["product-categories-of", productId],
    queryFn: () => productCategoriesOf(productId),
  })
  const attributesQuery = useQuery({
    queryKey: ATTRIBUTES_KEY,
    queryFn: () => attributesApi.list(),
  })
  const valuesQuery = useQuery({
    queryKey: ["product-attribute-values", productId],
    queryFn: () => productAttributeValuesApi.list(productId),
  })

  const categories = categoriesQuery.data?.product.categories ?? []
  const attributes = attributesQuery.data?.attributes ?? []
  const rows = valuesQuery.data?.product_attribute_values ?? []

  // Назначенные значения уровня товара, сгруппированные по характеристикам.
  const assignedByAttribute = useMemo(() => {
    const map = new Map<string, Array<string | number | boolean>>()
    for (const row of rows) {
      if (row.variant_id !== null) {
        continue
      }
      const value = readRawValue(row)
      if (value === null) {
        continue
      }
      const bucket = map.get(row.attribute_id) ?? []
      bucket.push(value)
      map.set(row.attribute_id, bucket)
    }
    return map
  }, [rows])

  // Доступные характеристики: scope категорий ∪ назначенные (без дубликатов).
  const available = useMemo(
    () => computeAvailableAttributes(attributes, categories, assignedByAttribute),
    [attributes, categories, assignedByAttribute]
  )

  const isLoading =
    categoriesQuery.isLoading || attributesQuery.isLoading || valuesQuery.isLoading
  const isError =
    categoriesQuery.isError || attributesQuery.isError || valuesQuery.isError

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h3">Характеристики товара</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Набор характеристик определяется категориями товара; назначенные
          значения хранятся независимо от категорий
        </Text>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-1 px-6 py-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-9 animate-pulse rounded-md bg-ui-bg-subtle" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-2 px-6 py-8">
          <Text className="text-ui-fg-subtle">Не удалось загрузить характеристики</Text>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              void categoriesQuery.refetch()
              void attributesQuery.refetch()
              void valuesQuery.refetch()
            }}
          >
            Повторить
          </Button>
        </div>
      )}

      {!isLoading && !isError && available.length === 0 && (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-subtle" size="small">
            Нет доступных характеристик: категории товара не имеют привязок
            характеристик
          </Text>
        </div>
      )}

      {!isLoading &&
        !isError &&
        available.map((attribute) => (
          <AttributeRow
            key={attribute.id}
            productId={productId}
            attribute={attribute}
            assigned={assignedByAttribute.get(attribute.id) ?? []}
            onChanged={invalidate}
          />
        ))}
    </Container>
  )
}

/**
 * Характеристики, доступные товару, по семантике backend:
 *  - товар без категорий → все характеристики (каталог без категории);
 *  - категория без привязок → все характеристики;
 *  - категория с привязками → только привязанный набор;
 *  - объединение категорий без дубликатов;
 *  - характеристики с назначенными значениями — всегда (редактирование
 *    и удаление доступны независимо от категорий).
 * Характеристики со штатной опцией (option_title) исключены.
 */
function computeAvailableAttributes(
  allAttributes: AttributeDTO[],
  productCategories: Array<{ id: string }>,
  assignedByAttribute: Map<string, Array<string | number | boolean>>
): AttributeDTO[] {
  const assignedIds = new Set(assignedByAttribute.keys())

  const scoped = (() => {
    if (productCategories.length === 0) {
      return allAttributes
    }

    const categoriesWithBindings = new Set(
      allAttributes.flatMap((attribute) =>
        attribute.categories.map((binding) => binding.category_id)
      )
    )

    // Категория без единой привязки открывает все характеристики.
    if (productCategories.some((category) => !categoriesWithBindings.has(category.id))) {
      return allAttributes
    }

    const scope = new Set<string>()
    const productCategoryIds = new Set(productCategories.map((category) => category.id))
    for (const attribute of allAttributes) {
      if (
        attribute.categories.some((binding) =>
          productCategoryIds.has(binding.category_id)
        )
      ) {
        scope.add(attribute.id)
      }
    }
    return allAttributes.filter((attribute) => scope.has(attribute.id))
  })()

  return [...scoped, ...allAttributes.filter((a) => assignedIds.has(a.id) && !scoped.includes(a))]
    .filter((attribute) => !attribute.option_title)
    .sort((a, b) => a.position - b.position)
}

// ── Строка характеристики ─────────────────────────────────────────────────

const AttributeRow = ({
  productId,
  attribute,
  assigned,
  onChanged,
}: {
  productId: string
  attribute: AttributeDTO
  assigned: Array<string | number | boolean>
  onChanged: () => void
}) => {
  const draftState = useDraft(attribute, assigned)
  const hasAssigned = assigned.length > 0
  const isDirty = !valuesEqual(draftState.value, assigned)

  const saveMutation = useMutation<unknown, Error, "save" | "clear">({
    mutationFn: (mode: "save" | "clear") => {
      if (mode === "clear") {
        return productAttributeValuesApi.clear(productId, attribute.id)
      }
      const draft = draftState.value
      if (
        draft === undefined ||
        (Array.isArray(draft) && draft.length === 0)
      ) {
        return productAttributeValuesApi.clear(productId, attribute.id)
      }
      const values = Array.isArray(draft)
        ? draft.map((value) => ({ attribute_id: attribute.id, value }))
        : [{ attribute_id: attribute.id, value: draft }]
      return productAttributeValuesApi.set(productId, values)
    },
    onSuccess: () => {
      toast.success(`«${attribute.name}» сохранено`)
      onChanged()
    },
    onError: (mutationError: Error) => {
      toast.error(`Не удалось сохранить «${attribute.name}»`, {
        description: mutationError.message,
      })
    },
  })

  return (
    <div className="flex flex-col gap-2 px-6 py-4">
      <div className="flex items-center gap-2">
        <Label size="small" weight="plus">
          {attribute.name}
        </Label>
        {attribute.unit && (
          <Text className="text-ui-fg-subtle" size="xsmall">
            {attribute.unit}
          </Text>
        )}
        <Text className="font-mono text-ui-fg-subtle" size="xsmall">
          {attribute.code}
        </Text>
        {!attribute.filterable && (
          <Badge size="2xsmall" color="grey">
            не в фильтрах
          </Badge>
        )}
        {hasAssigned && (
          <IconButton
            variant="transparent"
            size="small"
            className="ml-auto text-ui-tag-red-text"
            aria-label={`Удалить значения ${attribute.name}`}
            onClick={() => saveMutation.mutate("clear")}
          >
            <TrashIcon />
          </IconButton>
        )}
      </div>

      {draftState.control}

      <div className="flex items-center gap-2">
        <Button
          size="small"
          variant="secondary"
          disabled={!isDirty || saveMutation.isPending}
          isLoading={saveMutation.isPending}
          onClick={() => saveMutation.mutate("save")}
        >
          Сохранить
        </Button>
        {draftState.hint && (
          <Text className="text-ui-fg-subtle" size="xsmall">
            {draftState.hint}
          </Text>
        )}
      </div>
    </div>
  )
}

/** Черновик значения + тип-специфичный контрол (строка/число/флажок/выбор). */
function useDraft(
  attribute: AttributeDTO,
  assigned: Array<string | number | boolean>
): {
  value: DraftValue
  setValue: (value: DraftValue) => void
  control: ReactNode
  hint: string
} {
  const initial = toDraftValue(attribute, assigned)
  const [value, setValue] = useState<DraftValue>(initial)

  // Синхронизация при изменении назначенных значений с сервера
  // (штатный паттерн React: корректировка state во время рендера).
  const [syncKey, setSyncKey] = useState<DraftValue>(initial)
  if (!draftsEqual(initial, syncKey)) {
    setSyncKey(initial)
    setValue(initial)
  }

  const control = buildControl(attribute, value, setValue)
  const hint = draftHint(attribute, assigned)

  return { value, setValue, control, hint }
}

function toDraftValue(
  attribute: AttributeDTO,
  assigned: Array<string | number | boolean>
): DraftValue {
  if (assigned.length === 0) {
    return attribute.data_type === "multi_select" ? [] : undefined
  }
  if (attribute.data_type === "multi_select") {
    return assigned.map(String)
  }
  return assigned[0]
}

function buildControl(
  attribute: AttributeDTO,
  value: DraftValue,
  setValue: (value: DraftValue) => void
): ReactNode {
  switch (attribute.data_type) {
    case "boolean": {
      const checked = typeof value === "boolean" ? value : false
      return (
        <Switch
          checked={checked}
          onCheckedChange={(next) => setValue(next)}
        />
      )
    }
    case "number": {
      return (
        <Input
          type="number"
          className="w-40"
          placeholder="0"
          value={value === undefined ? "" : String(value)}
          onChange={(event) => {
            const raw = event.target.value
            setValue(raw === "" ? undefined : Number(raw))
          }}
        />
      )
    }
    case "select": {
      const options = [...attribute.options].sort((a, b) => a.position - b.position)
      const selected = typeof value === "string" ? value : undefined
      return (
        <div className="max-w-xs">
          <Select value={selected} onValueChange={(next) => setValue(next)}>
            <Select.Trigger>
              <Select.Value placeholder="Выберите значение" />
            </Select.Trigger>
            <Select.Content>
              {options.map((option) => (
                <Select.Item key={option.id} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      )
    }
    case "multi_select": {
      const options = [...attribute.options].sort((a, b) => a.position - b.position)
      const selected = Array.isArray(value) ? value : []
      if (options.length === 0) {
        return (
          <Text className="text-ui-fg-subtle" size="small">
            Допустимые значения не заданы
          </Text>
        )
      }
      return (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const active = selected.includes(option.value)
            return (
              <Button
                key={option.id}
                size="small"
                variant={active ? "primary" : "secondary"}
                onClick={() =>
                  setValue(
                    active
                      ? selected.filter((entry) => entry !== option.value)
                      : [...selected, option.value]
                  )
                }
              >
                {option.label}
              </Button>
            )
          })}
        </div>
      )
    }
    default: {
      // text
      return (
        <Input
          className="max-w-md"
          value={typeof value === "string" ? value : ""}
          placeholder={attribute.unit ? `например, ${attribute.unit}` : "Текст"}
          onChange={(event) => {
            const raw = event.target.value
            setValue(raw === "" ? undefined : raw)
          }}
        />
      )
    }
  }
}

function draftHint(
  attribute: AttributeDTO,
  assigned: Array<string | number | boolean>
): string {
  if (assigned.length === 0) {
    return ""
  }
  const rendered = assigned
    .map((value) => {
      if (typeof value === "boolean") {
        return value ? "да" : "нет"
      }
      const label = attribute.options.find(
        (option) => option.value === String(value)
      )?.label
      return label ?? String(value)
    })
    .join(", ")
  return `Текущее: ${rendered}`
}

function valuesEqual(
  draft: DraftValue,
  assigned: Array<string | number | boolean>
): boolean {
  if (draft === undefined || (Array.isArray(draft) && draft.length === 0)) {
    return assigned.length === 0
  }
  if (Array.isArray(draft)) {
    const assignedStrings = assigned.map(String)
    return (
      draft.length === assignedStrings.length &&
      draft.every((entry) => assignedStrings.includes(entry))
    )
  }
  if (assigned.length !== 1) {
    return false
  }
  const single = assigned[0]
  if (typeof draft === "number") {
    return Number(single) === draft
  }
  if (typeof single === "boolean") {
    return single === draft
  }
  return String(single) === String(draft)
}

/** Сравнение двух черновиков (undefined и пустой массив — «нет значения»). */
function draftsEqual(a: DraftValue, b: DraftValue): boolean {
  const normalize = (value: DraftValue): unknown =>
    Array.isArray(value) && value.length === 0 ? null : (value ?? null)
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

const TrashIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="16"
    height="16"
  >
    <path d="M4 6h12M8 6V4.5A.5.5 0 0 1 8.5 4h3a.5.5 0 0 1 .5.5V6m-7 0 .7 9.1a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9L15.3 6M8.5 9v4M11.5 9v4" />
  </svg>
)

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductAttributesWidget

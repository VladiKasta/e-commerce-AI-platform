import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Switch,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import {
  AttributeFilterType,
  categoriesApi,
  DATA_TYPE_LABELS,
  FILTER_TYPE_LABELS,
  attributesApi,
  type AttributeDTO,
  type AttributeOptionDTO,
} from "../../../lib/catalog-attributes"

/**
 * UI Route Medusa Admin: карточка характеристики (этап 3.5.1) —
 * редактирование (code и data_type неизменяемы: ключи поискового
 * индекса) и управление допустимыми значениями.
 *
 * Флаг searchable не отображается: он не потребляется индексатором
 * (техдолг этапа 3, см. docs/PROGRESS.md).
 */

const ATTRIBUTES_KEY = ["catalog-attributes"] as const

const AttributeDetailPage = () => {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ATTRIBUTES_KEY })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [...ATTRIBUTES_KEY, id],
    queryFn: () => attributesApi.retrieve(id!),
    enabled: Boolean(id),
  })

  const attribute = data?.attribute

  if (isLoading) {
    return (
      <Container className="flex items-center justify-center p-8">
        <Text className="text-ui-fg-subtle">Загрузка характеристики…</Text>
      </Container>
    )
  }

  if (isError || !attribute) {
    return (
      <Container className="flex flex-col items-center gap-3 p-8">
        <Text className="text-ui-fg-subtle">
          {isError ? `Ошибка загрузки: ${(error as Error).message}` : "Характеристика не найдена"}
        </Text>
        <Link to="/catalog-attributes">
          <Button variant="secondary" size="small">
            К списку характеристик
          </Button>
        </Link>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link to="/catalog-attributes">
          <Text className="text-ui-fg-subtle" size="small">
            Характеристики
          </Text>
        </Link>
        <Text className="text-ui-fg-subtle" size="small">
          /
        </Text>
        <Text className="font-mono" size="small">
          {attribute.code}
        </Text>
      </div>

      <EditAttributeSection attribute={attribute} onUpdated={invalidate} />
      <CategoriesSection
        attributeId={attribute.id}
        bindings={[...attribute.categories].sort((a, b) => a.position - b.position)}
        onChanged={invalidate}
      />
      <OptionsSection attributeId={attribute.id} onChanged={invalidate} />
    </div>
  )
}

// ── Привязки к категориям ─────────────────────────────────────────────────

/**
 * Управление привязками характеристики к категориям (этап 3.5.2).
 * Существующий Admin API — идемпотентная замена набора: порядок массива
 * задает position, пустой массив снимает все привязки (маршрут 23).
 * Имена категорий — штатный GET /admin/product-categories.
 */
const CategoriesSection = ({
  attributeId,
  bindings,
  onChanged,
}: {
  attributeId: string
  bindings: Array<{ id: string; category_id: string; position: number }>
  onChanged: () => void
}) => {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const categoriesQuery = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => categoriesApi.list(),
  })
  const categories = categoriesQuery.data?.product_categories ?? []
  const categoryById = new Map(categories.map((category) => [category.id, category]))

  const boundIds = bindings.map((binding) => binding.category_id)
  const available = categories.filter(
    (category) => !boundIds.includes(category.id)
  )

  const setCategoriesMutation = useMutation({
    mutationFn: (categoryIds: string[]) =>
      attributesApi.setCategories(attributeId, categoryIds),
    onSuccess: () => {
      toast.success("Привязки обновлены")
      setSelectedId(undefined)
      onChanged()
    },
    onError: (mutationError: Error) => {
      toast.error("Не удалось обновить привязки", {
        description: mutationError.message,
      })
    },
  })

  const handleAdd = () => {
    if (!selectedId) {
      toast.error("Выберите категорию")
      return
    }
    setCategoriesMutation.mutate([...boundIds, selectedId])
  }

  const handleRemove = (categoryId: string) => {
    setCategoriesMutation.mutate(boundIds.filter((id) => id !== categoryId))
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h3">Категории</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            В каталоге категории показываются только привязанные характеристики
            (порядок — по позиции привязки); без категории доступны все
          </Text>
        </div>
      </div>

      {bindings.length > 0 ? (
        <div className="flex flex-col divide-y">
          {bindings.map((binding) => {
            const category = categoryById.get(binding.category_id)
            return (
              <div key={binding.id} className="flex items-center gap-3 px-6 py-2.5">
                <Text size="small" weight="plus">
                  {category?.name ?? binding.category_id}
                </Text>
                {category && (
                  <Text className="font-mono text-ui-fg-subtle" size="xsmall">
                    {category.handle}
                  </Text>
                )}
                <Text className="text-ui-fg-subtle" size="xsmall">
                  позиция {binding.position}
                </Text>
                <div className="ml-auto">
                  <IconButton
                    variant="transparent"
                    size="small"
                    className="text-ui-tag-red-text"
                    aria-label={`Убрать категорию ${category?.name ?? binding.category_id}`}
                    onClick={() => handleRemove(binding.category_id)}
                  >
                    <UnbindIcon />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="px-6 py-6">
          <Text className="text-ui-fg-subtle" size="small">
            Не привязана ни к одной категории — характеристика участвует
            в фильтрах каталога без категории
          </Text>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 px-6 py-4">
        <div className="flex flex-col gap-1.5">
          <Label size="small" weight="plus">
            Категория
          </Label>
          {categoriesQuery.isLoading ? (
            <div className="h-8 w-64 animate-pulse rounded-md bg-ui-bg-subtle" />
          ) : categoriesQuery.isError ? (
            <Text className="text-ui-tag-red-text" size="small">
              Не удалось загрузить категории: {(categoriesQuery.error as Error).message}
            </Text>
          ) : available.length === 0 ? (
            <Text className="text-ui-fg-subtle" size="small">
              Все категории каталога уже привязаны
            </Text>
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <Select.Trigger>
                <Select.Value placeholder="Выберите категорию" />
              </Select.Trigger>
              <Select.Content>
                {available.map((category) => (
                  <Select.Item key={category.id} value={category.id}>
                    {category.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          )}
        </div>
        <Button
          size="small"
          variant="secondary"
          isLoading={setCategoriesMutation.isPending}
          disabled={available.length === 0 || categoriesQuery.isLoading}
          onClick={handleAdd}
        >
          Привязать категорию
        </Button>
      </div>
    </Container>
  )
}

const UnbindIcon = () => (
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
    <path d="M5 5l10 10M15 5 5 15" />
  </svg>
)

// ── Редактирование основной информации ─────────────────────────────────────

const EditAttributeSection = ({
  attribute,
  onUpdated,
}: {
  attribute: AttributeDTO
  onUpdated: () => void
}) => {
  const [form, setForm] = useState({
    name: attribute.name,
    filter_type: attribute.filter_type,
    unit: attribute.unit ?? "",
    filterable: attribute.filterable,
    position: String(attribute.position),
    option_title: attribute.option_title ?? "",
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      attributesApi.update(attribute.id, {
        name: form.name.trim(),
        filter_type: form.filter_type,
        unit: form.unit.trim() || null,
        filterable: form.filterable,
        position: Number(form.position) || 0,
        option_title: form.option_title.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Изменения сохранены")
      onUpdated()
    },
    onError: (mutationError: Error) => {
      toast.error("Не удалось сохранить", { description: mutationError.message })
    },
  })

  const save = () => {
    if (!form.name.trim()) {
      toast.error("Укажите название характеристики")
      return
    }
    updateMutation.mutate()
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{attribute.name}</Heading>
        <Button size="small" isLoading={updateMutation.isPending} onClick={save}>
          Сохранить
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
        <Field label="Код" hint="Неизменяем: ключ поискового индекса">
          <Input value={attribute.code} readOnly disabled />
        </Field>
        <Field label="Тип данных" hint="Неизменяем: типизированные колонки значений">
          <Input value={DATA_TYPE_LABELS[attribute.data_type]} readOnly disabled />
        </Field>
        <Field label="Название">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Тип фильтра">
          <Select
            value={form.filter_type}
            onValueChange={(value) =>
              setForm({ ...form, filter_type: value as AttributeFilterType })
            }
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {(Object.entries(FILTER_TYPE_LABELS) as Array<[AttributeFilterType, string]>).map(
                ([value, label]) => (
                  <Select.Item key={value} value={value}>
                    {label}
                  </Select.Item>
                )
              )}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Единица измерения">
          <Input
            value={form.unit}
            onChange={(event) => setForm({ ...form, unit: event.target.value })}
          />
        </Field>
        <Field label="Позиция в фильтрах">
          <Input
            type="number"
            value={form.position}
            onChange={(event) => setForm({ ...form, position: event.target.value })}
          />
        </Field>
        <Field
          label="Штатная опция товара"
          hint="Название опции Medusa (например «Цвет»): значения вариантов берутся из неё"
        >
          <Input
            value={form.option_title}
            placeholder="Цвет"
            onChange={(event) => setForm({ ...form, option_title: event.target.value })}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Label size="small" weight="plus">
            Участвует в фильтрации
          </Label>
          <div className="flex h-8 items-center">
            <Switch
              checked={form.filterable}
              onCheckedChange={(checked) => setForm({ ...form, filterable: checked })}
            />
          </div>
        </div>
      </div>
    </Container>
  )
}

// ── Допустимые значения ───────────────────────────────────────────────────

const OptionsSection = ({
  attributeId,
  onChanged,
}: {
  attributeId: string
  onChanged: () => void
}) => {
  const prompt = usePrompt()
  const [addValue, setAddValue] = useState("")
  const [addLabel, setAddLabel] = useState("")
  const [editing, setEditing] = useState<AttributeOptionDTO | null>(null)

  const listQuery = useQuery({
    queryKey: [...ATTRIBUTES_KEY, attributeId],
    queryFn: () => attributesApi.retrieve(attributeId),
  })
  const options = listQuery.data?.attribute.options ?? []

  const addMutation = useMutation({
    mutationFn: () =>
      attributesApi.addOptions(attributeId, [
        { value: addValue.trim(), label: addLabel.trim() },
      ]),
    onSuccess: () => {
      toast.success("Значение добавлено")
      setAddValue("")
      setAddLabel("")
      onChanged()
    },
    onError: (mutationError: Error) => {
      toast.error("Не удалось добавить значение", {
        description: mutationError.message,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (optionId: string) => attributesApi.deleteOption(attributeId, optionId),
    onSuccess: () => {
      toast.success("Значение удалено")
      onChanged()
    },
    onError: (mutationError: Error) => {
      toast.error("Не удалось удалить значение", {
        description: mutationError.message,
      })
    },
  })

  const handleAdd = () => {
    if (!addValue.trim() || !addLabel.trim()) {
      toast.error("Укажите значение и подпись")
      return
    }
    addMutation.mutate()
  }

  const handleDelete = async (option: AttributeOptionDTO) => {
    const confirmed = await prompt({
      title: "Удалить допустимое значение?",
      description: `Значения товаров, ссылающиеся на «${option.value}», будут удалены вместе с ним.`,
      confirmText: "Удалить",
      cancelText: "Отмена",
      variant: "danger",
    })
    if (confirmed) {
      deleteMutation.mutate(option.id)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h3">Допустимые значения</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Подписи значений для фильтров витрины; для типов «выбор» — допустимые значения
          </Text>
        </div>
      </div>
      {options.length > 0 ? (
        <div className="flex flex-col divide-y">
          {options.map((option) => (
            <div key={option.id} className="flex items-center gap-3 px-6 py-2.5">
              <Badge size="2xsmall" className="font-mono">
                {option.value}
              </Badge>
              <Text size="small">{option.label}</Text>
              <Text className="text-ui-fg-subtle" size="xsmall">
                позиция {option.position}
              </Text>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="secondary" size="small" onClick={() => setEditing(option)}>
                  Изменить
                </Button>
                <IconButton
                  variant="transparent"
                  size="small"
                  className="text-ui-tag-red-text"
                  aria-label={`Удалить ${option.value}`}
                  onClick={() => void handleDelete(option)}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-6 py-6">
          <Text className="text-ui-fg-subtle" size="small">
            Допустимых значений нет
          </Text>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 px-6 py-4">
        <div className="flex flex-col gap-1.5">
          <Label size="small" weight="plus">
            Значение
          </Label>
          <Input
            className="w-40"
            placeholder="cotton"
            value={addValue}
            onChange={(event) => setAddValue(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label size="small" weight="plus">
            Подпись
          </Label>
          <Input
            className="w-56"
            placeholder="Хлопок"
            value={addLabel}
            onChange={(event) => setAddLabel(event.target.value)}
          />
        </div>
        <Button
          size="small"
          variant="secondary"
          isLoading={addMutation.isPending}
          onClick={handleAdd}
        >
          Добавить значение
        </Button>
      </div>

      <EditOptionDrawer
        attributeId={attributeId}
        option={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onChanged={onChanged}
      />
    </Container>
  )
}

const EditOptionDrawer = ({
  attributeId,
  option,
  onOpenChange,
  onChanged,
}: {
  attributeId: string
  option: AttributeOptionDTO | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) => {
  const [label, setLabel] = useState("")
  const [position, setPosition] = useState("0")

  // Синхронизация формы при открытии другого значения.
  const [lastOptionId, setLastOptionId] = useState<string | null>(null)
  if (option && option.id !== lastOptionId) {
    setLastOptionId(option.id)
    setLabel(option.label)
    setPosition(String(option.position))
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      attributesApi.updateOption(attributeId, option!.id, {
        label: label.trim(),
        position: Number(position) || 0,
      }),
    onSuccess: () => {
      toast.success("Значение обновлено")
      onOpenChange(false)
      onChanged()
    },
    onError: (mutationError: Error) => {
      toast.error("Не удалось обновить значение", {
        description: mutationError.message,
      })
    },
  })

  return (
    <Drawer open={Boolean(option)} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            Значение <span className="font-mono">{option?.value}</span>
          </Drawer.Title>
          <Drawer.Description>
            Машинное значение неизменяемо; можно изменить подпись и позицию
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body>
          <div className="flex flex-col gap-4">
            <Field label="Подпись">
              <Input value={label} onChange={(event) => setLabel(event.target.value)} />
            </Field>
            <Field label="Позиция">
              <Input
                type="number"
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              />
            </Field>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button isLoading={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
              Сохранить
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) => (
  <div className="flex flex-col gap-1.5">
    <Label size="small" weight="plus">
      {label}
    </Label>
    {children}
    {hint && (
      <Text className="text-ui-fg-subtle" size="xsmall">
        {hint}
      </Text>
    )}
  </div>
)

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

export default AttributeDetailPage

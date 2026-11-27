import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
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
  StatusBadge,
  Switch,
  Table,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import {
  AttributeDataType,
  AttributeFilterType,
  DATA_TYPE_LABELS,
  FILTER_TYPE_LABELS,
  attributesApi,
} from "../../lib/catalog-attributes"

/**
 * UI Route Medusa Admin: список характеристик каталога (этап 3.5.1).
 *
 * Штатные компоненты @medusajs/ui, данные — реальный Admin API
 * (маршруты 15, 16, 19 из docs/api.md). Бизнес-логика не дублируется:
 * клиентская валидация минимальна (обязательность, формат code),
 * остальное валидирует backend, его сообщения показываются в toast.
 */

const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

/** Иконка раздела (inline-SVG в стиле иконок Medusa Admin; пакет @medusajs/icons не входит в зависимости backend). */
const AttributesIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="20"
    height="20"
  >
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4l1 2h6A1.5 1.5 0 0 1 17 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11Z" />
  </svg>
)

export const config = defineRouteConfig({
  label: "Характеристики",
  icon: AttributesIcon,
})

const ATTRIBUTES_KEY = ["catalog-attributes"] as const

const AttributeListPage = () => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ATTRIBUTES_KEY,
    queryFn: () => attributesApi.list(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => attributesApi.delete(id),
    onSuccess: (result) => {
      toast.success(`Характеристика удалена (${result.id})`)
      void queryClient.invalidateQueries({ queryKey: ATTRIBUTES_KEY })
    },
    onError: (mutationError: Error) => {
      toast.error("Не удалось удалить характеристику", {
        description: mutationError.message,
      })
    },
  })

  const handleDelete = async (id: string, code: string) => {
    const confirmed = await prompt({
      title: "Удалить характеристику?",
      description: `«${code}» будет удалена вместе с допустимыми значениями, привязками к категориям и значениями товаров. Действие нельзя отменить.`,
      confirmText: "Удалить",
      cancelText: "Отмена",
      variant: "danger",
    })
    if (confirmed) {
      deleteMutation.mutate(id)
    }
  }

  const attributes = data?.attributes ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Характеристики</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Универсальные характеристики товаров: бренды, материалы, технические параметры
          </Text>
        </div>
        <Button size="small" onClick={() => setCreateOpen(true)}>
          Создать
        </Button>
      </div>

      {isLoading && <LoadingRows />}

      {isError && (
        <div className="flex flex-col items-center gap-2 px-6 py-10">
          <Text className="text-ui-fg-subtle">
            Не удалось загрузить характеристики: {(error as Error).message}
          </Text>
          <Button variant="secondary" size="small" onClick={() => void refetch()}>
            Повторить
          </Button>
        </div>
      )}

      {!isLoading && !isError && attributes.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-6 py-10">
          <Text className="text-ui-fg-subtle">
            Характеристик пока нет. Создайте первую — например, «Бренд».
          </Text>
        </div>
      )}

      {!isLoading && !isError && attributes.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Код</Table.HeaderCell>
              <Table.HeaderCell>Название</Table.HeaderCell>
              <Table.HeaderCell>Тип данных</Table.HeaderCell>
              <Table.HeaderCell>Тип фильтра</Table.HeaderCell>
              <Table.HeaderCell>Значений</Table.HeaderCell>
              <Table.HeaderCell>Фильтруемая</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Действия</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {attributes.map((attribute) => (
              <Table.Row
                key={attribute.id}
                className="cursor-pointer"
                onClick={() => navigate(`/catalog-attributes/${attribute.id}`)}
              >
                <Table.Cell>
                  <Text className="font-mono text-ui-fg-subtle" size="small">
                    {attribute.code}
                  </Text>
                </Table.Cell>
                <Table.Cell>{attribute.name}</Table.Cell>
                <Table.Cell>{DATA_TYPE_LABELS[attribute.data_type]}</Table.Cell>
                <Table.Cell>{FILTER_TYPE_LABELS[attribute.filter_type]}</Table.Cell>
                <Table.Cell>
                  {attribute.options.length > 0 ? (
                    <Badge size="2xsmall" color="orange">
                      {attribute.options.length}
                    </Badge>
                  ) : (
                    <Text className="text-ui-fg-subtle" size="small">
                      —
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {attribute.filterable ? (
                    <StatusBadge color="green">Да</StatusBadge>
                  ) : (
                    <StatusBadge color="grey">Нет</StatusBadge>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation()
                        navigate(`/catalog-attributes/${attribute.id}`)
                      }}
                    >
                      Редактировать
                    </Button>
                    <IconButton
                      variant="transparent"
                      size="small"
                      className="text-ui-tag-red-text"
                      aria-label={`Удалить ${attribute.code}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleDelete(attribute.id, attribute.code)
                      }}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      <CreateAttributeDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ATTRIBUTES_KEY })}
      />
    </Container>
  )
}

const LoadingRows = () => (
  <div className="flex flex-col gap-1 px-6 py-4">
    {[0, 1, 2, 3].map((row) => (
      <div key={row} className="h-9 animate-pulse rounded-md bg-ui-bg-subtle" />
    ))}
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

// ── Создание характеристики ───────────────────────────────────────────────

type CreateFormState = {
  code: string
  name: string
  data_type: AttributeDataType
  filter_type: AttributeFilterType
  unit: string
  filterable: boolean
  position: string
}

const emptyCreateState: CreateFormState = {
  code: "",
  name: "",
  data_type: "text",
  filter_type: "checkbox",
  unit: "",
  filterable: true,
  position: "0",
}

const CreateAttributeDrawer = ({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) => {
  const [form, setForm] = useState<CreateFormState>(emptyCreateState)
  const [validation, setValidation] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () =>
      attributesApi.create({
        code: form.code.trim(),
        name: form.name.trim(),
        data_type: form.data_type,
        filter_type: form.filter_type,
        unit: form.unit.trim() || null,
        filterable: form.filterable,
        position: Number(form.position) || 0,
      }),
    onSuccess: () => {
      toast.success("Характеристика создана")
      onOpenChange(false)
      setForm(emptyCreateState)
      onCreated()
    },
    onError: (mutationError: Error) => {
      toast.error("Не удалось создать характеристику", {
        description: mutationError.message,
      })
    },
  })

  const submit = () => {
    if (!form.code.trim() || !form.name.trim()) {
      setValidation("Укажите код и название характеристики")
      return
    }
    if (!CODE_PATTERN.test(form.code.trim())) {
      setValidation("Код: латиница в kebab/snake-регистре (например brand или eco_mark)")
      return
    }
    setValidation(null)
    createMutation.mutate()
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Новая характеристика</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <div className="flex flex-col gap-4">
            <Field label="Код" hint="Уникальный код латиницей: brand, material, screen_size">
              <Input
                value={form.code}
                placeholder="brand"
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </Field>
            <Field label="Название" hint="Отображается в фильтрах каталога">
              <Input
                value={form.name}
                placeholder="Бренд"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="Тип данных" hint="Определяет формат значений; после создания не меняется">
              <Select
                value={form.data_type}
                onValueChange={(value) =>
                  setForm({ ...form, data_type: value as AttributeDataType })
                }
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {(Object.entries(DATA_TYPE_LABELS) as Array<[AttributeDataType, string]>).map(
                    ([value, label]) => (
                      <Select.Item key={value} value={value}>
                        {label}
                      </Select.Item>
                    )
                  )}
                </Select.Content>
              </Select>
            </Field>
            <Field label="Тип фильтра" hint="Как характеристика показывается в фильтрах витрины">
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
            <Field label="Единица измерения" hint="Необязательно: мм, г/м², «»">
              <Input
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
              />
            </Field>
            <div className="flex items-center justify-between">
              <Field label="Позиция в фильтрах" hint="Чем меньше, тем выше">
                <Input
                  type="number"
                  value={form.position}
                  className="w-20"
                  onChange={(event) => setForm({ ...form, position: event.target.value })}
                />
              </Field>
              <div className="flex flex-col items-end gap-1">
                <Switch
                  checked={form.filterable}
                  onCheckedChange={(checked) => setForm({ ...form, filterable: checked })}
                />
                <Text className="text-ui-fg-subtle" size="xsmall">
                  Участвует в фильтрации
                </Text>
              </div>
            </div>
            {validation && (
              <Text className="text-ui-tag-red-text" size="small">
                {validation}
              </Text>
            )}
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button isLoading={createMutation.isPending} onClick={submit}>
              Создать
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

export default AttributeListPage

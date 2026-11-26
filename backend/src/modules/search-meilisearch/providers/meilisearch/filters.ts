import type { SearchFilters } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import type { MeilisearchNetworkError } from "./client"

/**
 * Компиляция дерева SearchTypes.SearchFilters в выражения фильтров
 * Meilisearch. Meilisearch принимает массив строк: верхний уровень — AND,
 * вложенный массив — OR. Значения экранируются через JSON.stringify,
 * поэтому произвольные пользовательские строки не могут изменить
 * структуру выражения (инъекции исключены на уровне типов: строки
 * фильтров строятся только здесь, из проверенных значений).
 *
 * Операторы, которые Meilisearch не поддерживает ($prefix, $like),
 * отклоняются ошибкой вместо приблизительной интерпретации.
 */

type Primitive = string | number | boolean | Date

const UNSUPPORTED_OPERATORS = new Set(["$prefix", "$like"])

/** Результат компиляции: массив узлов Meilisearch (строки AND-условий и
 *  вложенные массивы OR-групп), либо строка, либо undefined. */
export type CompiledFilter = string | Array<string | string[]>

export function compileFilters(
  filters: SearchFilters | undefined
): CompiledFilter | undefined {
  if (!filters || typeof filters !== "object") {
    return undefined
  }

  const expressions = compileNode(filters)
  if (!expressions.length) {
    return undefined
  }
  // Один плоский узел — простая строка.
  if (expressions.length === 1 && typeof expressions[0] === "string") {
    return expressions[0]
  }
  return expressions
}

/**
 * Возвращает массив узлов: строка (AND-условие) либо массив строк
 * (OR-группа). Внутреннее представление; на верхнем уровне превращается
 * в Meilisearch-фильтр.
 */
function compileNode(filters: SearchFilters): Array<string | string[]> {
  const and: Array<string | string[]> = []

  for (const [rawKey, rawValue] of Object.entries(filters)) {
    if (rawValue === undefined) {
      continue
    }

    if (rawKey === "$and") {
      const branches = (Array.isArray(rawValue) ? rawValue : [rawValue]) as SearchFilters[]
      for (const branch of branches) {
        and.push(...compileNode(branch ?? {}))
      }
      continue
    }

    if (rawKey === "$or") {
      const branches = (Array.isArray(rawValue) ? rawValue : [rawValue]) as SearchFilters[]
      const alternatives = branches
        .flatMap((branch) => compileNode(branch ?? {}))
        .map((node) => (Array.isArray(node) ? node.join(" OR ") : node))
      if (alternatives.length) {
        and.push(alternatives)
      }
      continue
    }

    if (rawKey === "$not") {
      const inner = compileNode((rawValue ?? {}) as SearchFilters)
      for (const node of inner) {
        const expression = Array.isArray(node) ? node.join(" OR ") : node
        and.push(`NOT (${expression})`)
      }
      continue
    }

    if (rawKey === "q") {
      // Свободный текст поднимается на верхний уровень до компиляции;
      // отдельные поля q внутри дерева не поддерживаем.
      continue
    }

    and.push(...compileField(rawKey, rawValue))
  }

  return and
}

function compileField(field: string, rawValue: unknown): Array<string | string[]> {
  if (rawValue !== null && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    // Карта операторов: { price: { $gte: 100 } }
    const operators = rawValue as Record<string, unknown>
    const parts: string[] = []

    for (const [operator, operand] of Object.entries(operators)) {
      if (operand === undefined) {
        continue
      }

      if (UNSUPPORTED_OPERATORS.has(operator)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Meilisearch не поддерживает оператор ${operator} в фильтре по полю ${field}`
        )
      }

      switch (operator) {
        case "$eq":
          parts.push(equality(field, operand as Primitive))
          break
        case "$ne":
          parts.push(`NOT ${equality(field, operand as Primitive)}`)
          break
        case "$in":
          parts.push(inList(field, toArray(operand)))
          break
        case "$nin":
          parts.push(`NOT ${inList(field, toArray(operand))}`)
          break
        case "$lt":
          parts.push(`${field} < ${literal(operand)}`)
          break
        case "$lte":
          parts.push(`${field} <= ${literal(operand)}`)
          break
        case "$gt":
          parts.push(`${field} > ${literal(operand)}`)
          break
        case "$gte":
          parts.push(`${field} >= ${literal(operand)}`)
          break
        case "$exists":
          parts.push(operand ? `${field} EXISTS` : `${field} NOT EXISTS`)
          break
        case "$contains": {
          const values = Array.isArray(operand) ? operand : [operand]
          // «Массив содержит все значения»: Meilisearch сравнивает элементы
          // массива как равенство, поэтому все значения объединяются через AND.
          for (const value of values as Primitive[]) {
            parts.push(equality(field, value))
          }
          break
        }
        case "$overlaps":
          parts.push(inList(field, toArray(operand)))
          break
        default:
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Неизвестный оператор фильтра ${operator} для поля ${field}`
          )
      }
    }

    return parts
  }

  // Прямое значение: массив = IN, скаляр = равенство.
  if (Array.isArray(rawValue)) {
    return [inList(field, rawValue)]
  }

  return [equality(field, rawValue as Primitive)]
}

function equality(field: string, value: Primitive): string {
  if (value === null) {
    return `${field} IS NULL`
  }
  return `${field} = ${literal(value)}`
}

function inList(field: string, values: unknown[]): string {
  if (!values.length) {
    // Пустой список значений не должен матчить ничего.
    return "false"
  }
  return `${field} IN [${values.map((value) => literal(value)).join(", ")}]`
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

function literal(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "0"
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString())
  }
  if (value === null || value === undefined) {
    return "null"
  }
  // Строки экранируются целиком (кавычки и слэши внутри безопасны).
  return JSON.stringify(String(value))
}

export function isMeilisearchNetworkError(
  error: unknown
): error is MeilisearchNetworkError {
  return (
    error instanceof Error &&
    (error.name === "MeilisearchNetworkError" ||
      (error as MeilisearchNetworkError).message?.includes("Meilisearch недоступен"))
  )
}

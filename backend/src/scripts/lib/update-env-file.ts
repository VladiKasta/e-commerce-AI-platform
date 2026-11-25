import { existsSync, readFileSync, writeFileSync } from "node:fs"

const ENV_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

/**
 * Разбирает значение из строки .env, убирая окружающие кавычки.
 */
function parseRawValue(raw: string): string {
  const value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Читает .env-файл в объект. Возвращает null, если файл не существует.
 */
export function readEnvFile(envPath: string): Record<string, string> | null {
  if (!existsSync(envPath)) {
    return null
  }

  const result: Record<string, string> = {}
  const content = readFileSync(envPath, "utf8")

  for (const line of content.split(/\r?\n/)) {
    const match = ENV_LINE_RE.exec(line)
    if (match) {
      result[match[1]] = parseRawValue(match[2])
    }
  }

  return result
}

export type UpsertEnvResult = "unchanged" | "updated" | "appended" | "missing-file"

/**
 * Записывает значение переменной в .env-файл, не трогая остальные строки.
 *
 * - если переменная уже содержит значение — ничего не делает;
 * - если переменной нет — добавляет её в конец файла;
 * - если значение отличается — заменяет его.
 */
export function upsertEnvValue(
  envPath: string,
  key: string,
  value: string
): UpsertEnvResult {
  if (!existsSync(envPath)) {
    return "missing-file"
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/)
  let found = false

  const next = lines.map((line) => {
    const match = ENV_LINE_RE.exec(line)
    if (!match || match[1] !== key) {
      return line
    }
    found = true
    if (parseRawValue(match[2]) === value) {
      return line
    }
    return `${key}=${value}`
  })

  if (!found) {
    const lastLine = next.length ? next[next.length - 1] : ""
    if (lastLine.trim() === "") {
      // Файл заканчивается переводом строки — вставляем перед ним,
      // чтобы сохранить корректное окончание файла.
      next.splice(next.length - 1, 0, `${key}=${value}`)
    } else {
      next.push(`${key}=${value}`)
    }
  }

  if (next.join("\n") === lines.join("\n")) {
    return "unchanged"
  }

  writeFileSync(envPath, next.join("\n"), "utf8")
  return found ? "updated" : "appended"
}

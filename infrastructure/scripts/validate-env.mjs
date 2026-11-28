#!/usr/bin/env node
/**
 * Валидация единого корневого .env перед запуском сервисов.
 *
 * Читает значения из .env-файла и объединяет их с process.env
 * (process.env имеет приоритет — так валидируется именно то, что получат
 * контейнеры). Проверяет обязательность, форматы URL и длину секретов.
 *
 * Использование:
 *   node infrastructure/scripts/validate-env.mjs [--file path/to/.env]
 *
 * Выход: код 0 при успехе, 1 при любых ошибках.
 */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { file: null }
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--file" && argv[i + 1]) {
      args.file = argv[i + 1]
      i += 1
    } else {
      console.error(`Неизвестный аргумент: ${argv[i]}`)
      process.exit(1)
    }
  }
  return args
}

function parseEnvFile(filePath) {
  const values = {}
  if (!existsSync(filePath)) {
    return values
  }
  const content = readFileSync(filePath, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) {
      continue
    }
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }
  return values
}

const args = parseArgs(process.argv)
const envPath = path.resolve(
  args.file ?? path.join(__dirname, "..", "..", ".env")
)

const fileValues = parseEnvFile(envPath)
const config = { ...fileValues }
for (const [key, value] of Object.entries(process.env)) {
  // Пустые значения из process.env не затирают значения из .env-файла.
  if (value !== "") {
    config[key] = value
  }
}

const errors = []
const warnings = []

function requireValue(name, description) {
  const value = config[name]
  if (value === undefined || value.trim() === "") {
    errors.push(`${name} — обязательная переменная (${description})`)
    return ""
  }
  return value.trim()
}

function requireHttpUrl(name, description) {
  const value = requireValue(name, description)
  if (value && !/^https?:\/\/.+/.test(value)) {
    errors.push(`${name} должен быть HTTP(S) URL, получено: "${value}"`)
  }
  return value
}

function requirePort(name) {
  const raw = requireValue(name, "TCP-порт")
  const port = Number.parseInt(raw, 10)
  if (raw && (Number.isNaN(port) || port < 1 || port > 65535)) {
    errors.push(`${name} должен быть числом от 1 до 65535, получено: "${raw}"`)
  }
  return port
}

function requireOriginList(name, description) {
  const value = requireValue(name, description)
  if (value) {
    for (const origin of value.split(",")) {
      const trimmed = origin.trim()
      if (trimmed === "" || trimmed.endsWith("/")) {
        errors.push(
          `${name}: origin "${trimmed}" некорректен — укажите полный URL без слэша в конце`
        )
      }
    }
  }
  return value
}

// ── Application ───────────────────────────────────────────────────────
requireValue("STORE_NAME", "название магазина")
const storeLocale = requireValue("STORE_LOCALE", "локаль магазина")
if (storeLocale && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(storeLocale)) {
  errors.push(
    `STORE_LOCALE должен быть в формате IETF (например, ru-RU), получено: "${storeLocale}"`
  )
}
const storeCurrency = requireValue("STORE_CURRENCY", "валюта магазина")
if (storeCurrency && !/^[a-z]{3}$/.test(storeCurrency)) {
  errors.push(
    `STORE_CURRENCY должен быть трехбуквенным ISO-кодом в нижнем регистре (например, rub), получено: "${storeCurrency}"`
  )
}

// ── PostgreSQL ────────────────────────────────────────────────────────
requireValue("POSTGRES_HOST", "хост PostgreSQL внутри Docker-сети")
requirePort("POSTGRES_PORT")
requireValue("POSTGRES_DB", "имя базы данных")
requireValue("POSTGRES_USER", "пользователь базы данных")
requireValue("POSTGRES_PASSWORD", "пароль PostgreSQL")

// ── Redis ─────────────────────────────────────────────────────────────
const redisUrl = requireValue("REDIS_URL", "URL Redis")
if (redisUrl && !/^rediss?:\/\/.+/.test(redisUrl)) {
  errors.push(`REDIS_URL должен начинаться с redis:// или rediss://, получено: "${redisUrl}"`)
}

// ── Medusa ────────────────────────────────────────────────────────────
requirePort("MEDUSA_PORT")
requireHttpUrl("MEDUSA_INTERNAL_URL", "внутренний URL Medusa для SSR")
requireHttpUrl("MEDUSA_PUBLIC_URL", "публичный URL Medusa")

const publishableKey = config.MEDUSA_PUBLISHABLE_KEY?.trim() ?? ""
if (publishableKey && !publishableKey.startsWith("pk_")) {
  errors.push(
    `MEDUSA_PUBLISHABLE_KEY должен начинаться с "pk_" либо быть пустым (ключ создается автоматически), получено: "${publishableKey}"`
  )
}

const jwtSecret = requireValue("JWT_SECRET", "секрет для JWT Medusa")
const cookieSecret = requireValue("COOKIE_SECRET", "секрет для cookies Medusa")
if (jwtSecret === "supersecret") {
  errors.push("JWT_SECRET не должен быть значением по умолчанию — запустите `make init` или сгенерируйте секреты")
}
if (cookieSecret === "supersecret") {
  errors.push("COOKIE_SECRET не должен быть значением по умолчанию — запустите `make init` или сгенерируйте секреты")
}

requireOriginList("STORE_CORS", "разрешенные origin для Store API")
requireOriginList("ADMIN_CORS", "разрешенные origin для Admin API")
requireOriginList("AUTH_CORS", "разрешенные origin для /auth")

// ── Administrator ─────────────────────────────────────────────────────
const adminEmail = requireValue("ADMIN_EMAIL", "email администратора Medusa")
if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  errors.push(`ADMIN_EMAIL должен быть корректным email, получено: "${adminEmail}"`)
}
const adminPassword = requireValue("ADMIN_PASSWORD", "пароль администратора Medusa")
if (adminPassword && adminPassword.length < 8) {
  errors.push(`ADMIN_PASSWORD должен содержать минимум 8 символов`)
}

// ── Nuxt ──────────────────────────────────────────────────────────────
requirePort("NUXT_PORT")
requireHttpUrl("NUXT_PUBLIC_SITE_URL", "публичный URL storefront")

// ── Meilisearch ───────────────────────────────────────────────────────
requireHttpUrl("MEILISEARCH_HOST", "внутренний URL Meilisearch")
const meiliKey = requireValue("MEILISEARCH_MASTER_KEY", "master key Meilisearch")
if (meiliKey && meiliKey.length < 16) {
  errors.push("MEILISEARCH_MASTER_KEY должен содержать минимум 16 символов")
}
requireValue("MEILISEARCH_INDEX_PREFIX", "префикс поисковых индексов")

// ── Email-уведомления (этап 5.2.3) ────────────────────────────────
const notificationEnabled = (
  config.NOTIFICATION_ENABLED ?? "true"
).toLowerCase()
if (!["true", "false"].includes(notificationEnabled)) {
  errors.push(
    `NOTIFICATION_ENABLED должен быть true или false, получено: "${config.NOTIFICATION_ENABLED}"`
  )
}

const mailpitEnabled = (config.MAILPIT_ENABLED ?? "false").toLowerCase()
if (!["true", "false"].includes(mailpitEnabled)) {
  errors.push(
    `MAILPIT_ENABLED должен быть true или false, получено: "${config.MAILPIT_ENABLED}"`
  )
}
// Mailpit — инструмент локальной разработки: в production он не включается.
if (
  mailpitEnabled === "true" &&
  String(config.NODE_ENV ?? "").toLowerCase() === "production"
) {
  errors.push(
    "MAILPIT_ENABLED=true недопустим при NODE_ENV=production — Mailpit предназначен только для локальной разработки (SMTP-конфигурация должна указывать на реальный сервер)"
  )
}

const notificationsOn = notificationEnabled === "true"
const smtpHost = config.SMTP_HOST?.trim() ?? ""
if (notificationsOn && smtpHost === "") {
  errors.push(
    "SMTP_HOST — обязательная переменная при NOTIFICATION_ENABLED=true (для локальной разработки: mailpit)"
  )
}
if (smtpHost) {
  const smtpPort = config.SMTP_PORT?.trim() ?? "587"
  const port = Number.parseInt(smtpPort, 10)
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    errors.push(
      `SMTP_PORT должен быть числом от 1 до 65535, получено: "${smtpPort}"`
    )
  }
  const smtpSecure = (config.SMTP_SECURE ?? "false").toLowerCase()
  if (!["true", "false"].includes(smtpSecure)) {
    errors.push(
      `SMTP_SECURE должен быть true или false, получено: "${config.SMTP_SECURE}"`
    )
  }
  const fromEmail = config.SMTP_FROM_EMAIL?.trim() ?? ""
  // Домен без точки допустим для локальной разработки (Mailpit, SMTP_HOST=mailpit);
  // корректность адреса отправителя в production в итоге проверяет SMTP-сервер.
  if (!/^[^\s@]+@[^\s@]+$/.test(fromEmail)) {
    errors.push(
      `SMTP_FROM_EMAIL должен быть корректным email отправителя, получено: "${fromEmail}"`
    )
  }
  if (mailpitEnabled === "true" && smtpHost !== "mailpit") {
    warnings.push(
      "MAILPIT_ENABLED=true, но SMTP_HOST указывает не на mailpit — письма будут уходить на настроенный SMTP-сервер, а не в Mailpit"
    )
  }
  if (
    notificationsOn &&
    mailpitEnabled === "false" &&
    smtpHost === "mailpit"
  ) {
    errors.push(
      "SMTP_HOST=mailpit при MAILPIT_ENABLED=false — сервис Mailpit не будет запущен; укажите реальный SMTP-сервер или включите Mailpit"
    )
  }
}
const retryWindow = config.NOTIFICATION_RETRY_WINDOW_MINUTES?.trim() ?? "15"
if (Number.isNaN(Number.parseInt(retryWindow, 10)) || Number.parseInt(retryWindow, 10) < 1) {
  errors.push(
    `NOTIFICATION_RETRY_WINDOW_MINUTES должен быть целым числом минут ≥1, получено: "${retryWindow}"`
  )
}

// ── Initialization ────────────────────────────────────────────────────
const seedDemoData = requireValue("SEED_DEMO_DATA", "флаг демо-данных")
if (seedDemoData && !["true", "false"].includes(seedDemoData)) {
  errors.push(`SEED_DEMO_DATA должен быть true или false, получено: "${seedDemoData}"`)
}

// ── Платежи (этап 6.2) ────────────────────────────────────────────────
// Демо-провайдер фиктивной онлайн-оплаты регистрируется только вне
// production (решение №41): там ему нужен секрет HMAC webhook-а.
// В production переменная не используется (провайдер не регистрируется и
// блокируется guard-ом); оплата при получении (pp_cod_cash) настраек
// не требует.
const isProductionEnv = String(config.NODE_ENV ?? "").toLowerCase() === "production"
const demoWebhookSecret = config.PAYMENT_DEMO_WEBHOOK_SECRET?.trim() ?? ""
if (!isProductionEnv && demoWebhookSecret === "") {
  errors.push(
    "PAYMENT_DEMO_WEBHOOK_SECRET — обязательная переменная вне production (секрет HMAC webhook-а демо-провайдера онлайн-оплаты; генерируется make init)"
  )
}
if (demoWebhookSecret !== "" && demoWebhookSecret.length < 16) {
  errors.push("PAYMENT_DEMO_WEBHOOK_SECRET должен содержать минимум 16 символов")
}

if (publishableKey === "") {
  warnings.push(
    "MEDUSA_PUBLISHABLE_KEY пуст — он будет создан seed-скриптом при инициализации"
  )
}

console.log(`Проверена конфигурация: ${envPath}`)
for (const warning of warnings) {
  console.warn(`  [warn] ${warning}`)
}

if (errors.length > 0) {
  console.error("Ошибки конфигурации:")
  for (const error of errors) {
    console.error(`  [error] ${error}`)
  }
  process.exit(1)
}

console.log("Конфигурация валидна.")

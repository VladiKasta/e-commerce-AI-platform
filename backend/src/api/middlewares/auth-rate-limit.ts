import type {
  AuthContext,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { createHmac } from "node:crypto"

/**
 * Распределенный rate limiting для маршрутов аутентификации и переноса
 * заказа (этап 5.2.2; механизм и ограничения — решение №38 в
 * docs/PROGRESS.md, зафиксировано до реализации).
 *
 * Механизм — только зарегистрированные официальные модули Medusa, без
 * новых зависимостей и без отдельного сервиса:
 *
 * - **счетчики в Redis** — Cache Module (провайдер cache-redis, общий
 *   Redis приложения): `get(key)` / `set(key, value, ttlSeconds)`;
 * - **атомарность между процессами** — инкремент «read→check→set»
 *   выполняется под транзакционным advisory-локом Locking Module
 *   (locking-postgres, `execute(key, fn)`) по ключу счетчика —
 *   параллельные запросы не обходят лимит; TTL обновляется при каждой
 *   попытке (скользящее окно), «осиротевших» бессрочных ключей нет,
 *   блокировка всегда истекает сама (бессрочной блокировки аккаунта нет);
 * - **fail-open**: любая ошибка инфраструктуры (Redis недоступен и т.п.)
 *   пропускает запрос — доступность авторизации важнее идеального лимита;
 *   проверка не задерживает запрос дольше BUCKET_TIMEOUT_MS.
 *
 * Ключи: `ratelimit:<route>:ip:<ip>` и `ratelimit:<route>:id:<hmac>`.
 * Идентификатор (email) нормализуется (trim + lower) и хешируется
 * HMAC-SHA256 с JWT_SECRET — в ключах Redis и логах нет открытых email,
 * паролей и токенов. Логи предупреждений содержат только маршрут и тип
 * бакета (ip/id), без значений.
 *
 * IP: по умолчанию берется адрес TCP-сокета (не подделывается).
 * X-Forwarded-For НЕ используется: Medusa выставляет
 * `app.set("trust proxy", 1)`, и при прямом доступе клиент подделывает
 * `req.ip` через заголовок. Флаг AUTH_RATE_LIMIT_TRUST_PROXY=true
 * включает `req.ip` (Express-резолюция) для production за reverse
 * proxy, который ПЕРЕЗАПИСЫВАЕТ X-Forwarded-For (этап 10).
 *
 * Превышение лимита: HTTP 429, заголовок Retry-After (окно в секундах —
 * консервативная верхняя оценка), тело {"type":"rate_limited","message":…}.
 * Ответ одинаков для любых идентификаторов (существующих/несуществующих
 * email) — перечисление невозможно; лимит применяется ДО аутентификации.
 *
 * Правила (env, формат "<max>/<window_seconds>"; дефолты в .env.example):
 *   вход          AUTH_RATE_LIMIT_LOGIN_IP=30/60      AUTH_RATE_LIMIT_LOGIN_ID=5/900
 *   регистрация   AUTH_RATE_LIMIT_REGISTER_IP=30/60   AUTH_RATE_LIMIT_REGISTER_ID=5/3600
 *   сброс пароля  AUTH_RATE_LIMIT_RESET_IP=30/60      AUTH_RATE_LIMIT_RESET_ID=3/3600
 *   смена пароля  AUTH_RATE_LIMIT_UPDATE_IP=30/60     (по идентификатору невозможен: reset-токен непрозрачен)
 *   transfer      AUTH_RATE_LIMIT_TRANSFER_IP=30/60   AUTH_RATE_LIMIT_TRANSFER_ID=10/3600
 */

type Rule = { max: number; windowSeconds: number }

function parseRule(raw: string): Rule {
  const [maxRaw, windowRaw] = raw.split("/")
  const max = Number.parseInt(maxRaw, 10)
  const windowSeconds = Number.parseInt(windowRaw, 10)
  if (!Number.isFinite(max) || !Number.isFinite(windowSeconds) || max < 1 || windowSeconds < 1) {
    throw new Error(`ожидается "<max>/<window_seconds>", получено "${raw}"`)
  }
  return { max, windowSeconds }
}

function envRule(name: string, fallback: string): Rule {
  const raw = process.env[name]
  if (raw) {
    try {
      return parseRule(raw)
    } catch (error) {
      console.warn(
        `auth-rate-limit: некорректное ${name}="${raw}" (${
          error instanceof Error ? error.message : String(error)
        }); используется дефолт ${fallback}`
      )
    }
  }
  return parseRule(fallback)
}

const RULES = {
  login: {
    ip: envRule("AUTH_RATE_LIMIT_LOGIN_IP", "30/60"),
    id: envRule("AUTH_RATE_LIMIT_LOGIN_ID", "5/900"),
  },
  register: {
    ip: envRule("AUTH_RATE_LIMIT_REGISTER_IP", "30/60"),
    id: envRule("AUTH_RATE_LIMIT_REGISTER_ID", "5/3600"),
  },
  reset: {
    ip: envRule("AUTH_RATE_LIMIT_RESET_IP", "30/60"),
    id: envRule("AUTH_RATE_LIMIT_RESET_ID", "3/3600"),
  },
  update: {
    ip: envRule("AUTH_RATE_LIMIT_UPDATE_IP", "30/60"),
  },
  transfer: {
    ip: envRule("AUTH_RATE_LIMIT_TRANSFER_IP", "30/60"),
    id: envRule("AUTH_RATE_LIMIT_TRANSFER_ID", "10/3600"),
  },
}

const TRUST_PROXY = process.env.AUTH_RATE_LIMIT_TRUST_PROXY === "true"

/** Максимальное время ожидания проверки одного бакета (fail-open по таймауту). */
const BUCKET_TIMEOUT_MS = 500
/** Ожидание advisory-лока бакета (конкурентные попытки того же бакета). */
const LOCK_TIMEOUT_SECONDS = 2

const HMAC_SECRET = process.env.JWT_SECRET ?? "auth-rate-limit-key-derivation"

/** Необратимый ключ идентификатора: открытые email в Redis исключены. */
function identifierKeyPart(identifier: string): string {
  const normalized = identifier.trim().toLowerCase()
  return createHmac("sha256", HMAC_SECRET).update(normalized).digest("hex").slice(0, 32)
}

/** auth_context опционален (см. cart-access.ts). */
type AccessRequest = MedusaRequest & { auth_context?: AuthContext }

/** IP запроса без доверия к X-Forwarded-For (по умолчанию) — адрес сокета. */
function clientIp(req: MedusaRequest): string {
  const socketAddress = (req as { socket?: { remoteAddress?: string } }).socket
    ?.remoteAddress
  if (TRUST_PROXY) {
    return req.ip ?? socketAddress ?? "unknown"
  }
  return socketAddress ?? "unknown"
}

/** Промис-таймаут fail-open: false по истечении (без утечек — unref). */
function timeoutPromise(ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    timer.unref?.()
  })
}

/** Атомарный инкремент бакета; true — лимит превышен. Ошибка → false (fail-open). */
async function hitBucket(
  scope: MedusaRequest["scope"],
  bucketKey: string,
  rule: Rule
): Promise<boolean> {
  const locking = scope.resolve(Modules.LOCKING)
  const cache = scope.resolve(Modules.CACHE)
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Ошибка инфраструктуры резолвит fail-open с warn-ом; проигравший
  // таймаут-гонку промис имеет обработчик — unhandled rejection нет.
  const operation = locking.execute(`ratelimit-lock:${bucketKey}`, async () => {
    const current = Number((await cache.get<number>(bucketKey)) ?? 0)
    if (current >= rule.max) {
      return true
    }
    await cache.set(bucketKey, current + 1, rule.windowSeconds)
    return false
  }, { timeout: LOCK_TIMEOUT_SECONDS }).then(
    (limited) => limited,
    (error) => {
      logger.warn(
        `auth-rate-limit: проверка лимита пропущена (fail-open): ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return false
    }
  )
  return Promise.race([operation, timeoutPromise(BUCKET_TIMEOUT_MS)])
}

/** Идентификатор из тела запроса (email/identifier) — для auth-маршрутов. */
function bodyIdentifier(req: MedusaRequest, field: string): string | undefined {
  const body = req.body as Record<string, unknown> | undefined
  const raw = body?.[field]
  return typeof raw === "string" && raw.length > 0 ? raw : undefined
}

type RateLimitMiddleware = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => Promise<void>

/**
 * Guard: два независимых бакета — по IP и по идентификатору (если
 * извлекается). Идентификатор никогда не попадает в логи.
 */
function makeRateLimit(
  route: string,
  rules: { ip: Rule; id?: Rule },
  identifierOf?: (req: MedusaRequest) => string | undefined
): RateLimitMiddleware {
  return async function rateLimit(req, res, next) {
    const identifier = identifierOf?.(req)
    const exceeded: Rule[] = []
    if (await hitBucket(req.scope, `ratelimit:${route}:ip:${clientIp(req)}`, rules.ip)) {
      exceeded.push(rules.ip)
    }
    if (rules.id && identifier) {
      const part = identifierKeyPart(identifier)
      if (await hitBucket(req.scope, `ratelimit:${route}:id:${part}`, rules.id)) {
        exceeded.push(rules.id)
      }
    }
    if (exceeded.length === 0) {
      next()
      return
    }
    const retryAfter = Math.max(...exceeded.map((rule) => rule.windowSeconds))
    res.status(429)
    res.set("Retry-After", String(retryAfter))
    res.json({
      type: "rate_limited",
      message: "Too many requests, please try again later.",
    })
  }
}

/** `POST /auth/customer/emailpass` — вход (email в теле). */
export const limitLogin = makeRateLimit("login", RULES.login, (req) =>
  bodyIdentifier(req, "email")
)

/** `POST /auth/customer/emailpass/register` — регистрация (email в теле). */
export const limitRegister = makeRateLimit("register", RULES.register, (req) =>
  bodyIdentifier(req, "email")
)

/** `POST /auth/customer/emailpass/reset-password` (identifier в теле). */
export const limitReset = makeRateLimit("reset-password", RULES.reset, (req) =>
  bodyIdentifier(req, "identifier")
)

/** `POST /auth/customer/emailpass/update` — смена по reset-токену (только IP). */
export const limitUpdate = makeRateLimit("password-update", RULES.update)

/**
 * `POST /store/orders/:id/transfer/request` — идентификатор:
 * авторизованный покупатель (auth_context), при его отсутствии — email
 * из тела (запрос все равно получит штатный 401).
 */
export const limitTransferRequest = makeRateLimit(
  "transfer-request",
  RULES.transfer,
  (req) => (req as AccessRequest).auth_context?.actor_id ?? bodyIdentifier(req, "email")
)

import { FetchError } from "@medusajs/js-sdk"
import type { CommerceErrorData } from "../types/commerce"

/**
 * Единая нормализация ошибок Commerce API.
 *
 * Любая ошибка (HTTP-ответ Medusa, сеть, таймаут, отмена) приводится
 * к `CommerceError` с безопасным пользовательским сообщением:
 * stack trace, URL внутренней сети и прочие внутренности остаются
 * только в `details`/`cause` для серверных логов, но не показываются
 * пользователю.
 */

export interface CommerceErrorOptions {
  statusCode?: number
  code?: string
  /** Технические детали для логов; не показываются пользователю. */
  details?: unknown
  cause?: unknown
}

/** Нормализованная ошибка Commerce API. */
export class CommerceError extends Error implements CommerceErrorData {
  readonly statusCode: number | undefined
  readonly code: string | undefined
  readonly details: unknown

  constructor(message: string, options: CommerceErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = "CommerceError"
    this.statusCode = options.statusCode
    this.code = options.code
    this.details = options.details
  }
}

/** Машинный код по HTTP-статусу ответа Medusa. */
function codeByStatus(status: number | undefined): string {
  switch (status) {
    case 400:
      return "bad_request"
    case 401:
      return "unauthorized"
    case 403:
      return "forbidden"
    case 404:
      return "not_found"
    case 409:
      return "conflict"
    case 422:
      return "invalid_data"
    case 429:
      return "rate_limited"
    default:
      return status !== undefined && status >= 500 ? "server_error" : "unknown"
  }
}

/** Пользовательское сообщение для 5xx: не раскрываем внутренности backend. */
function serverErrorMessage(): string {
  return "Внутренняя ошибка сервера Medusa. Попробуйте повторить запрос позже."
}

function isAbortError(error: unknown): error is DOMException {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  )
}

interface NodeNetworkCause {
  code?: string
}

/** Ошибки сети: fetch failed (undici) / NetworkError (браузер). */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "TypeError" || error.message.includes("fetch failed")) {
    return true
  }
  const cause = (error as { cause?: unknown }).cause
  const code = (cause as NodeNetworkCause | undefined)?.code
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET"
  )
}

/**
 * Приводит любую ошибку к `CommerceError`.
 * Уже нормализованные ошибки проходят без изменений.
 */
export function toCommerceError(error: unknown): CommerceError {
  if (error instanceof CommerceError) {
    return error
  }

  if (error instanceof FetchError) {
    const statusCode = error.status
    // Сообщения Medusa для 4xx безопасны (например, «Product with id … was not found»);
    // для 5xx не доверяем внутренностям backend.
    const message =
      statusCode !== undefined && statusCode >= 500
        ? serverErrorMessage()
        : error.message || "Ошибка запроса к Medusa API"

    return new CommerceError(message, {
      statusCode,
      code: codeByStatus(statusCode),
      details: error.message,
      cause: error,
    })
  }

  // AbortSignal.timeout() завершается DOMException TimeoutError.
  if (isAbortError(error)) {
    if (error.name === "TimeoutError") {
      return new CommerceError(
        "Medusa API не ответил за отведенное время (timeout).",
        { statusCode: 504, code: "timeout", details: error.message, cause: error }
      )
    }
    return new CommerceError("Запрос к Medusa API отменен.", {
      statusCode: 499,
      code: "aborted",
      details: error.message,
      cause: error,
    })
  }

  if (isNetworkError(error)) {
    return new CommerceError(
      "Не удалось связаться с Medusa API. Проверьте, что backend запущен (`make status`).",
      {
        statusCode: 503,
        code: "medusa_unreachable",
        details: error instanceof Error ? error.message : String(error),
        cause: error,
      }
    )
  }

  // Ошибки h3/Nuxt (createError) и прочие Error с statusCode — проходим как есть.
  const candidate = error as { statusCode?: unknown }
  if (error instanceof Error && typeof candidate.statusCode === "number") {
    const statusCode = candidate.statusCode
    return new CommerceError(error.message || "Ошибка запроса", {
      statusCode,
      code: codeByStatus(statusCode),
      details: error.message,
      cause: error,
    })
  }

  return new CommerceError("Неизвестная ошибка при обращении к Medusa API.", {
    statusCode: 500,
    code: "unknown",
    details: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** Сериализуемый снимок ошибки для передачи через payload (useState, useAsyncData). */
export function serializeCommerceError(error: CommerceError): CommerceErrorData {
  return {
    message: error.message,
    statusCode: error.statusCode,
    code: error.code,
  }
}

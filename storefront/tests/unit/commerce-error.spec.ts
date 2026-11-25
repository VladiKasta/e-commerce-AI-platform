import { FetchError } from "@medusajs/js-sdk"
import { describe, expect, it } from "vitest"
import {
  CommerceError,
  serializeCommerceError,
  toCommerceError,
} from "#shared/utils/commerce-error"

describe("toCommerceError", () => {
  it("пропускает уже нормализованную CommerceError без изменений", () => {
    const original = new CommerceError("Уже нормализована", {
      statusCode: 404,
      code: "not_found",
    })

    expect(toCommerceError(original)).toBe(original)
  })

  it("маппит FetchError 404 в not_found с сообщением Medusa", () => {
    const error = toCommerceError(
      new FetchError("Product with id: x was not found", "Not Found", 404)
    )

    expect(error.statusCode).toBe(404)
    expect(error.code).toBe("not_found")
    expect(error.message).toContain("not found")
  })

  it("маппит FetchError 400 в not_allowed-подобные 4xx без раскрытия internals", () => {
    const error = toCommerceError(
      new FetchError("Publishable API key required", "Bad Request", 400)
    )

    expect(error.statusCode).toBe(400)
    expect(error.code).toBe("bad_request")
    expect(error.message).toContain("Publishable API key")
  })

  it("маппит FetchError 500 в безопасное сообщение без internals backend", () => {
    const error = toCommerceError(
      new FetchError("TypeError: Cannot read properties of undefined", "Internal Server Error", 500)
    )

    expect(error.statusCode).toBe(500)
    expect(error.code).toBe("server_error")
    // Стек и внутренние детали не показываются пользователю.
    expect(error.message).not.toContain("TypeError")
    expect(error.details).toContain("TypeError")
  })

  it("маппит таймаут (DOMException TimeoutError от AbortSignal.timeout) в 504", () => {
    const error = toCommerceError(
      new DOMException("The operation was aborted due to timeout", "TimeoutError")
    )

    expect(error.statusCode).toBe(504)
    expect(error.code).toBe("timeout")
  })

  it("маппит отмену запроса (AbortError) в 499", () => {
    const error = toCommerceError(new DOMException("aborted", "AbortError"))

    expect(error.statusCode).toBe(499)
    expect(error.code).toBe("aborted")
  })

  it("маппит ошибки сети (fetch failed) в 503 medusa_unreachable", () => {
    const networkError = new TypeError("fetch failed")
    ;(networkError as { cause?: unknown }).cause = { code: "ECONNREFUSED" }

    const error = toCommerceError(networkError)

    expect(error.statusCode).toBe(503)
    expect(error.code).toBe("medusa_unreachable")
  })

  it("сохраняет statusCode ошибок h3/Nuxt (createError)", () => {
    const h3Error = new Error("Page not found")
    ;(h3Error as { statusCode?: number }).statusCode = 404

    const error = toCommerceError(h3Error)

    expect(error.statusCode).toBe(404)
    expect(error.code).toBe("not_found")
  })

  it("неизвестные ошибки → 500 unknown с безопасным сообщением", () => {
    const error = toCommerceError(new Error("secret internals"))

    expect(error.statusCode).toBe(500)
    expect(error.code).toBe("unknown")
    expect(error.message).not.toContain("secret internals")
  })

  it("не раскрывает стек и секреты в message", () => {
    const withStack = new CommerceError("Видимое сообщение", {
      details: "x-medusa-key: secret",
    })
    const serialized = serializeCommerceError(withStack)

    expect(serialized.message).toBe("Видимое сообщение")
    expect(serialized.code).toBeUndefined()
    expect(JSON.stringify(serialized)).not.toContain("secret")
  })
})

import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommerceError } from "#shared/utils/commerce-error"
import { createCommerceClient } from "#shared/utils/commerce-client"
import type { CommerceClient } from "#shared/types/commerce"

/**
 * Тесты логики самой обертки (заголовки, query, таймаут, отмена,
 * нормализация ошибок) на моке fetch. Контракт Medusa проверяется
 * интеграционными тестами на живом API (tests/integration).
 */

const PUBLISHABLE_KEY = "pk_test_key"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function ok(body: unknown): Response {
  return jsonResponse(200, body)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Commerce Client: publishable key и query", () => {
  it("передает publishable API key во все запросы", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok({ products: [], count: 0, limit: 50, offset: 0 })))
    vi.stubGlobal("fetch", fetchMock)

    const commerce = createCommerceClient({
      baseUrl: "http://medusa.test",
      publishableKey: PUBLISHABLE_KEY,
    })

    await commerce.products.list()

    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init!.headers)
    expect(headers.get("x-publishable-api-key")).toBe(PUBLISHABLE_KEY)
  })

  it("сериализует query-параметры и НЕ добавляет calculated_price без региона", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok({ products: [], count: 0, limit: 6, offset: 0 })))
    vi.stubGlobal("fetch", fetchMock)

    const commerce = createCommerceClient({ baseUrl: "http://medusa.test", publishableKey: PUBLISHABLE_KEY })
    await commerce.products.list({ limit: 6, offset: 0, order: "-created_at" })

    const [url] = fetchMock.mock.calls[0]!
    const requestUrl = new URL(String(url))
    expect(requestUrl.searchParams.get("limit")).toBe("6")
    expect(requestUrl.searchParams.get("order")).toBe("-created_at")
    expect(requestUrl.searchParams.get("fields")).toBeNull()
  })

  it("добавляет fields=+*variants.calculated_price при переданном region_id", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok({ products: [], count: 0, limit: 50, offset: 0 })))
    vi.stubGlobal("fetch", fetchMock)

    const commerce = createCommerceClient({ baseUrl: "http://medusa.test", publishableKey: PUBLISHABLE_KEY })
    await commerce.products.list({ region_id: "reg_123" })

    const [url] = fetchMock.mock.calls[0]!
    const requestUrl = new URL(String(url))
    expect(requestUrl.searchParams.get("region_id")).toBe("reg_123")
    expect(requestUrl.searchParams.get("fields")).toBe("+*variants.calculated_price")
  })

  it("не дублирует calculated_price, если fields задан вызывающим кодом", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok({ products: [], count: 0, limit: 50, offset: 0 })))
    vi.stubGlobal("fetch", fetchMock)

    const commerce = createCommerceClient({ baseUrl: "http://medusa.test", publishableKey: PUBLISHABLE_KEY })
    await commerce.products.list({ region_id: "reg_1", fields: "+*variants.calculated_price" })

    const [url] = fetchMock.mock.calls[0]!
    const requestUrl = new URL(String(url))
    expect(requestUrl.searchParams.get("fields")).toBe("+*variants.calculated_price")
  })

  it("getByHandle использует штатный фильтр handle и возвращает null, если товар не найден", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(ok({ products: [], count: 0, limit: 1, offset: 0 }))
    )
    vi.stubGlobal("fetch", fetchMock)

    const commerce = createCommerceClient({ baseUrl: "http://medusa.test", publishableKey: PUBLISHABLE_KEY })
    const product = await commerce.products.getByHandle("missing-handle")

    const [url] = fetchMock.mock.calls[0]!
    const requestUrl = new URL(String(url))
    expect(requestUrl.searchParams.get("handle")).toBe("missing-handle")
    expect(requestUrl.searchParams.get("limit")).toBe("1")
    expect(product).toBeNull()
  })

  it("categories.getById нормализует особенность Medusa (200 с пустым телом) в 404", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok({}))))

    const commerce = createCommerceClient({ baseUrl: "http://medusa.test", publishableKey: PUBLISHABLE_KEY })

    await expect(commerce.categories.getById("pcat_missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found",
    })
  })
})

describe("Commerce Client: таймаут и отмена", () => {
  let hangingServer: http.Server
  let hangingUrl: string
  let commerce: CommerceClient

  beforeEach(async () => {
    // Реальный HTTP-сервер, который принимает соединение и не отвечает.
    hangingServer = http.createServer(() => {})
    await new Promise<void>((resolve) => {
      hangingServer.listen(0, "127.0.0.1", resolve)
    })
    hangingUrl = `http://127.0.0.1:${(hangingServer.address() as AddressInfo).port}`
    commerce = createCommerceClient({
      baseUrl: hangingUrl,
      publishableKey: PUBLISHABLE_KEY,
      timeoutMs: 100,
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => hangingServer.close(() => resolve()))
  })

  it("прерывает зависший запрос по таймауту и нормализует в CommerceError 504", async () => {
    await expect(commerce.regions.list()).rejects.toMatchObject({
      statusCode: 504,
      code: "timeout",
    })
  })

  it("поддерживает отмену запроса внешним AbortSignal (499 aborted)", async () => {
    const controller = new AbortController()
    const promise = commerce.regions.list({ signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ code: "aborted" })
  })

  it("позволяет переопределить таймаут на уровне запроса", async () => {
    const slowClient = createCommerceClient({
      baseUrl: hangingUrl,
      publishableKey: PUBLISHABLE_KEY,
      timeoutMs: 60_000,
    })

    await expect(slowClient.regions.list({ timeoutMs: 80 })).rejects.toBeInstanceOf(
      CommerceError
    )
  })
})

describe("Commerce Client: нормализация HTTP-ошибок Medusa", () => {
  it("превращает 404 Medusa в CommerceError not_found", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(jsonResponse(404, { type: "not_found", message: "Product with id: x was not found" }))
    ))

    const commerce = createCommerceClient({ baseUrl: "http://medusa.test", publishableKey: PUBLISHABLE_KEY })

    await expect(commerce.products.getById("prod_x")).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found",
      message: "Product with id: x was not found",
    })
  })
})

import { beforeAll, describe, expect, it } from "vitest"

/**
 * Unit-тесты демонстрационных платежных провайдеров этапа 6.2 (решение №41).
 *
 * Импортируют РЕАЛЬНЫЙ код провайдеров из backend (read-only volume репозитория —
 * тот же прием, что в search-documents.spec.ts этапа 3.6.3). Интеграционные
 * проверки полного жизненного цикла на живой Medusa — store-payment-providers.spec.ts.
 */

type BackendExports = Record<string, unknown>

async function importBackend(relPath: string): Promise<BackendExports> {
  const backendSrc = process.env.BACKEND_SRC_DIR ?? "/server/repo/backend/src"
  const candidates = [`${backendSrc}/${relPath}`, `${process.cwd()}/../backend/src/${relPath}`]
  let lastError: unknown = null
  for (const path of candidates) {
    try {
      return (await import(path)) as BackendExports
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

// Минимальные локальные типи контракта (кросс-граничные type-only импорты
// backend не используются — тот же прием, что в search-documents.spec.ts).
type ProviderInput = {
  data?: Record<string, unknown>
  context?: { idempotency_key?: string }
}

describe("payment-demo-online: контракт провайдера (unit)", () => {
  let mod: BackendExports
  let Provider: new (
    cradle: Record<string, unknown>,
    options: { webhook_secret: string }
  ) => {
    initiatePayment: (input: ProviderInput) => Promise<unknown>
    updatePayment: (input: ProviderInput) => Promise<unknown>
    authorizePayment: (input: ProviderInput) => Promise<unknown>
    getPaymentStatus: (input: ProviderInput) => Promise<unknown>
    getWebhookActionAndData: (
      payload: unknown
    ) => Promise<{ action: string; data?: { session_id?: string } }>
    validateOptions: (options: Record<string, unknown>) => void
  }

  beforeAll(async () => {
    mod = await importBackend(
      "modules/payment-demo-online/providers/demo/service.ts"
    )
    Provider = mod.default as unknown as typeof Provider
  })

  const makeProvider = () =>
    new Provider({}, { webhook_secret: "unit-test-secret" })

  it("validateOptions: production-глушилка (решение №41)", () => {
    const prev = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = "production"
      expect(() =>
        Provider.validateOptions({ webhook_secret: "x".repeat(32) })
      ).toThrow(/must not be registered in production/)
      process.env.NODE_ENV = "development"
      expect(() =>
        Provider.validateOptions({ webhook_secret: "x".repeat(32) })
      ).not.toThrow()
      expect(() => Provider.validateOptions({})).toThrow(/webhook_secret/)
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it("исходы: success по умолчанию, строгая валидация произвольных значений", async () => {
    const provider = makeProvider()
    const initiated = (await provider.initiatePayment({
      data: {},
    })) as { id: string; data: { outcome: string } }
    expect(initiated.id).toBeTruthy()
    expect(initiated.data.outcome).toBe("success")
    await expect(
      provider.initiatePayment({ data: { outcome: "fake" } as Record<string, unknown> })
    ).rejects.toThrow(/Unknown demo payment outcome/)
    await expect(
      provider.updatePayment({ data: { outcome: 42 } as Record<string, unknown> })
    ).rejects.toThrow(/Unknown demo payment outcome/)
  })

  it("authorizePayment: success → authorized, pending → pending_authorization, decline → throw", async () => {
    const provider = makeProvider()
    const ok = (await provider.authorizePayment({
      data: { outcome: "success" },
    })) as { status: string }
    expect(ok.status).toBe("authorized")
    const pending = (await provider.authorizePayment({
      data: { outcome: "pending" },
    })) as { status: string }
    expect(pending.status).toBe("pending_authorization")
    await expect(
      provider.authorizePayment({ data: { outcome: "decline" } })
    ).rejects.toThrow(/declined/)
  })

  it("webhook: верная подпись → действие; неверная/отсутствующая → not_supported", async () => {
    const provider = makeProvider()
    const body = JSON.stringify({
      event_type: "authorized",
      session_id: "payses_unit",
      amount: 100,
    })
    const signature = await (async () => {
      const { createHmac } = await import("node:crypto")
      return createHmac("sha256", "unit-test-secret")
        .update(Buffer.from(body, "utf8"))
        .digest("hex")
    })()
    const payload = {
      data: JSON.parse(body) as Record<string, unknown>,
      rawData: Buffer.from(body, "utf8"),
      headers: { "x-demo-signature": signature },
    }
    const ok = await provider.getWebhookActionAndData(payload)
    expect(ok.action).toBe("authorized")
    expect(ok.data?.session_id).toBe("payses_unit")

    const bad = await provider.getWebhookActionAndData({
      ...payload,
      headers: { "x-demo-signature": "deadbeef" },
    })
    expect(bad.action).toBe("not_supported")
    const missing = await provider.getWebhookActionAndData({
      ...payload,
      headers: {},
    })
    expect(missing.action).toBe("not_supported")
  })

  it("webhook: подтвержденная сессия авторизуется при повторном authorizePayment (deferred-механизм ядра)", async () => {
    const provider = makeProvider()
    const body = JSON.stringify({
      event_type: "authorized",
      session_id: "payses_deferred",
      amount: 500,
    })
    const { createHmac } = await import("node:crypto")
    const signature = createHmac("sha256", "unit-test-secret")
      .update(Buffer.from(body, "utf8"))
      .digest("hex")
    const action = await provider.getWebhookActionAndData({
      data: JSON.parse(body) as Record<string, unknown>,
      rawData: Buffer.from(body, "utf8"),
      headers: { "x-demo-signature": signature },
    })
    expect(action.action).toBe("authorized")
    // Ядро вызывает authorizePayment повторно; штатный context.idempotency_key
    // несет id сессии — подтвержденная сессия отвечает authorized.
    const authorized = (await provider.authorizePayment({
      data: { outcome: "pending" },
      context: { idempotency_key: "payses_deferred" },
    })) as { status: string }
    expect(authorized.status).toBe("authorized")
    // Неподтвержденная сессия с тем же исходом остается pending_authorization.
    const still = (await provider.authorizePayment({
      data: { outcome: "pending" },
      context: { idempotency_key: "payses_other" },
    })) as { status: string }
    expect(still.status).toBe("pending_authorization")
  })

  it("webhook: неподдерживаемое действие/формат/сумма-не-число → not_supported", async () => {
    const provider = makeProvider()
    const { createHmac } = await import("node:crypto")
    const call = async (obj: Record<string, unknown>) => {
      const body = JSON.stringify(obj)
      const signature = createHmac("sha256", "unit-test-secret")
        .update(Buffer.from(body, "utf8"))
        .digest("hex")
      return provider.getWebhookActionAndData({
        data: obj,
        rawData: Buffer.from(body, "utf8"),
        headers: { "x-demo-signature": signature },
      })
    }
    expect((await call({ event_type: "refunded", session_id: "x" })).action).toBe(
      "not_supported"
    )
    expect((await call({ event_type: "authorized" })).action).toBe("not_supported")
    expect(
      (await call({ event_type: "authorized", session_id: "x", amount: "abc" })).action
    ).toBe("not_supported")
  })
})

describe("payment-cod: контракт провайдера (unit)", () => {
  it("authorizePayment всегда authorized (техническая), опций не требует", async () => {
    const mod = await importBackend("modules/payment-cod/providers/cod/service.ts")
    const Provider = mod.default as new (
      cradle: Record<string, unknown>
    ) => {
      authorizePayment: (input: ProviderInput) => Promise<{ status: string }>
      getWebhookActionAndData: () => Promise<{ action: string }>
      initiatePayment: (input: ProviderInput) => Promise<{ id: string }>
    }
    const provider = new Provider({})
    const res = await provider.authorizePayment({ data: {} })
    expect(res.status).toBe("authorized")
    expect((await provider.getWebhookActionAndData()).action).toBe("not_supported")
    expect((await provider.initiatePayment({})).id).toBeTruthy()
  })
})

describe("production guard выбора провайдера (unit, этап 6.2)", () => {
  it("в production блокирует фиктивные провайдеры, не трогает COD и реальные", async () => {
    const mod = await importBackend("api/middlewares/payment-access.ts")
    const assertFn = mod.assertProviderSelectionAllowed as unknown as (
      isProduction: boolean,
      providerId: string
    ) => void
    expect(() => assertFn(true, "pp_system_default")).toThrow(/not available/)
    expect(() => assertFn(true, "pp_demo_online")).toThrow(/not available/)
    expect(() => assertFn(true, "pp_cod_cash")).not.toThrow()
    expect(() => assertFn(true, "pp_yookassa_custom")).not.toThrow()
    expect(() => assertFn(false, "pp_system_default")).not.toThrow()
    expect(() => assertFn(false, "pp_demo_online")).not.toThrow()
  })
})

import { beforeAll, describe, expect, it } from "vitest"

/**
 * Unit-тесты сверки поискового индекса (этап 3.6.3): каноническое
 * сравнение документов (используется runSearchReconcile для детекции
 * «устаревших») и SQL-резолвер активной ready-версии индекса.
 *
 * Импортируют РЕАЛЬНЫЙ код backend через read-only volume `.:/server/repo`
 * (docker-compose.yml; запускается через `make test`).
 */

// ── canonicalJson (backend/src/jobs/search-index-reconcile.ts) ───────────

type CanonicalFn = (value: unknown) => string

let canonicalJson: CanonicalFn

beforeAll(async () => {
  // Импортируемая цепочка включает определение индекса (products.ts),
  // которое на import регистрируется через global.MedusaModule — вне
  // приложения реестра нет, подменяем no-op.
  const globals = globalThis as {
    MedusaModule?: { setSearchIndex: (definition: unknown, path?: string) => void }
  }
  globals.MedusaModule ??= { setSearchIndex: () => undefined }

  const backendRoot =
    process.env.BACKEND_SRC_DIR ?? "/server/repo/backend/src"
  const job = (await import(
    `${backendRoot}/jobs/search-index-reconcile`
  )) as unknown as { canonicalJson: CanonicalFn }
  canonicalJson = job.canonicalJson
})

describe("Каноническое сравнение документов сверки", () => {
  it("порядок ключей объекта не влияет на результат", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
  })

  it("порядок элементов массива не влияет на результат (массивы — множества)", () => {
    expect(canonicalJson(["cotton", "polyester"])).toBe(
      canonicalJson(["polyester", "cotton"])
    )
  })

  it("различное содержимое дает различную каноническую форму", () => {
    expect(canonicalJson({ price: 1490 })).not.toBe(
      canonicalJson({ price: 1500 })
    )
    expect(canonicalJson(["a"])).not.toBe(canonicalJson(["a", "a"]))
    expect(canonicalJson(null)).not.toBe(canonicalJson("null"))
  })

  it("вложенные объекты характеристик сравниваются независимо от порядка", () => {
    const indexed = {
      attributes: { material: ["b", "a"], brand: "x" },
      category_ids: [2, 1],
    }
    const rebuilt = {
      attributes: { brand: "x", material: ["a", "b"] },
      category_ids: [1, 2],
    }
    expect(canonicalJson(indexed)).toBe(canonicalJson(rebuilt))
  })

  it("undefined-поля объекта игнорируются, примитивы сериализуются типобезопасно", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }))
    expect(canonicalJson(1)).toBe("1")
    expect(canonicalJson(true)).toBe("true")
    expect(canonicalJson(null)).toBe("null")
    expect(canonicalJson([])).toBe("[]")
  })
})

// ── resolveActivePhysicalNameFromModule (backend/src/services/catalog-search.ts) ──

type PgConnection = {
  raw: (sql: string, bindings?: unknown[]) => Promise<unknown>
}

type ResolveFn = (
  container: { resolve: (key: string) => unknown },
  indexName: string
) => Promise<string | null>

let resolveActivePhysicalNameFromModule: ResolveFn

beforeAll(async () => {
  const globals = globalThis as {
    MedusaModule?: { setSearchIndex: (definition: unknown, path?: string) => void }
  }
  globals.MedusaModule ??= { setSearchIndex: () => undefined }

  const backendRoot =
    process.env.BACKEND_SRC_DIR ?? "/server/repo/backend/src"
  const service = (await import(
    `${backendRoot}/services/catalog-search`
  )) as unknown as {
    resolveActivePhysicalNameFromModule: ResolveFn
  }
  resolveActivePhysicalNameFromModule = service.resolveActivePhysicalNameFromModule
})

/** Ключ регистрации PG-подключения в контейнере Medusa (ContainerRegistrationKeys.PG_CONNECTION). */
const PG_CONNECTION_KEY = "__pg_connection__"

function containerWithRaw(
  raw: (sql: string, bindings?: unknown[]) => Promise<unknown>
): { resolve: (key: string) => unknown } {
  return {
    resolve: (key: string): unknown => {
      if (key === PG_CONNECTION_KEY) {
        return { raw } satisfies PgConnection
      }
      throw new Error(`unregistered: ${key}`)
    },
  }
}

describe("Резолвер активной ready-версии индекса", () => {
  it("возвращает physical_name активной версии по имени индекса", async () => {
    const container = containerWithRaw(async () => ({
      rows: [{ physical_name: "store_products_v3" }],
    }))
    await expect(
      resolveActivePhysicalNameFromModule(container, "products")
    ).resolves.toBe("store_products_v3")
  })

  it("SQL читает ТОЛЬКО подтвержденную ready-версию (join по active_version)", async () => {
    let capturedSql = ""
    let capturedBindings: unknown[] | undefined = []
    const container = containerWithRaw(async (sql, bindings) => {
      capturedSql = sql
      capturedBindings = bindings
      return { rows: [{ physical_name: "store_products_v3" }] }
    })
    await resolveActivePhysicalNameFromModule(container, "products")

    expect(capturedSql).toContain("active_version")
    expect(capturedSql).toContain("'ready'")
    expect(capturedSql).toContain("deleted_at IS NULL")
    expect(capturedBindings).toEqual(["products"])
  })

  it("нет готовой строки → null (деградация, без угадывания индекса)", async () => {
    const container = containerWithRaw(async () => ({ rows: [] }))
    await expect(
      resolveActivePhysicalNameFromModule(container, "products")
    ).resolves.toBeNull()
  })

  it("ошибка служебного SQL → null (деградация к последней подтвержденной)", async () => {
    const container = containerWithRaw(async () => {
      throw new Error("connection refused")
    })
    await expect(
      resolveActivePhysicalNameFromModule(container, "products")
    ).resolves.toBeNull()
  })

  it("незарегистрированное PG-подключение → null", async () => {
    const container = {
      resolve: (): unknown => {
        throw new Error("unregistered")
      },
    }
    await expect(
      resolveActivePhysicalNameFromModule(container, "products")
    ).resolves.toBeNull()
  })
})

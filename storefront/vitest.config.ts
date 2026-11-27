import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      // Те же алиасы, что использует Nuxt 4 (srcDir = app/, shared-каталог).
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@": fileURLToPath(new URL("./app", import.meta.url)),
      "#shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    // Интеграционные тесты делят один живой индекс Meilisearch: сценарий
    // сверки намеренно повреждает и ремонтирует его — параллельные файлы
    // видели бы временные повреждения. Файлы выполняются последовательно.
    fileParallelism: false,
  },
})

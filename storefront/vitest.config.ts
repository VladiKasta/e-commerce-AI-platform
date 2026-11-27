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
    sequence: {
      // Этап 5.2.3: тесты уведомлений используют те же маршруты аутентификации,
      // что и store-auth-ratelimit, который СОЗНАТЕЛЬНО исчерпывает IP-бакеты
      // rate limiting (30/60 с, скользящее окно; этап 5.2.2). Поэтому файл
      // уведомлений выполняется первым — до ratelimit-спеки.
      sortTestsFiles(files) {
        const notifications = files.filter((file) =>
          file.includes("store-auth-notifications")
        )
        const rest = files.filter((file) => !file.includes("store-auth-notifications"))
        return [...notifications, ...rest]
      },
    },
  },
})

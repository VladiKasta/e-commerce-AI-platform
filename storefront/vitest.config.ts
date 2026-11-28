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
      // Этапы 5.2.3/5.3: файлы, работающие с лимитируемыми маршрутами
      // аутентификации, выстроены явно — тесты не зависят от порядка
      // запуска из-за общих IP-бакетов rate limiting (30/60 с, скользящее
      // окно): store-auth-notifications первым (сценарии писем требуют
      // свободных бакетов), store-auth-ratelimit ПОСЛЕДНИМ (он сознательно
      // исчерпывает IP-бакеты этапа 5.2.2). Прочие файлы эти маршруты не
      // расходуют (вход администратора /auth/user/* не лимитируется), их
      // взаимный порядок значения не имеет; суммарные IP-бакеты всех
      // auth-файлов укладываются в лимит даже при запуске в одном окне
      // (вход ≤ 20, регистрация ≤ 20, сброс ≤ 15 из 30).
      sortTestsFiles(files) {
        const priority = (file: string): number => {
          if (file.includes("store-auth-notifications")) return 0
          if (file.includes("store-auth-ratelimit")) return 2
          return 1
        }
        return [...files].sort((a, b) => priority(a) - priority(b))
      },
    },
  },
})

import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // PostgreSQL внутри Docker-сети работает без SSL.
    // Рекомендация из официального руководства Medusa по Docker.
    databaseDriverOptions: {
      ssl: false,
      sslmode: "disable",
    },
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    // URL storefront'а, используется Medusa Admin для ссылок (например,
    // shareable payment links).
    storefrontUrl: process.env.NUXT_PUBLIC_SITE_URL,
    vite: () => {
      // Настройка dev-сервера Medusa Admin для работы внутри Docker.
      // Возвращается ТОЛЬКО дельта: базовую конфигурацию (включая react-
      // плагин) админ-бандлер объединяет сам. Спред входного config
      // дублировал react-плагин и вызывал двойную react-refresh
      // трансформацию файлов src/admin (синтаксическая ошибка
      // "RefreshRuntime has already been declared") — известный баг
      // Docker-развёртываний, исправлен в документации Medusa
      // (medusajs/medusa#14545).
      return {
        server: {
          host: "0.0.0.0",
          allowedHosts: ["localhost", ".localhost", "127.0.0.1"],
          hmr: {
            port: 5173,
            clientPort: 5173,
          },
        },
      }
    },
  },
  modules: [
    // Штатные Redis-провайдеры инфраструктурных модулей Medusa:
    // кэш, шина событий и движок workflows хранят состояние в Redis,
    // чтобы окружение разработки было максимально близко к production.
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          url: process.env.REDIS_URL,
        },
      },
    },
    // Штатный Locking Module с провайдером PostgreSQL (этап 3.6.2): те же
    // advisory-локи в БД приложения работают между процессами и инстансами.
    // Защищает параллельные запуски сверки индекса (job search-index-reconcile)
    // и конфликты с полной переиндексацией — Search Module берет свои
    // seed-локи из этого же модуля.
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-postgres",
            id: "locking-postgres",
            is_default: true,
          },
        ],
      },
    },
    // Универсальные характеристики товаров (бренды, материалы, технические
    // параметры) — этап 3. См. backend/src/modules/catalog-attributes.
    {
      resolve: "./src/modules/catalog-attributes",
    },
    // Официальный Search Module Medusa с провайдером Meilisearch:
    // индексация, синхронизация и версионирование индексов — штатные
    // механизмы модуля; провайдер транслирует запросы к Meilisearch.
    // См. docs/search.md и docs/indexing.md.
    {
      resolve: "@medusajs/medusa/search",
      options: {
        providers: [
          {
            resolve: "./src/modules/search-meilisearch/providers/meilisearch",
            id: "meilisearch",
            options: {
              host: process.env.MEILISEARCH_HOST,
              master_key: process.env.MEILISEARCH_MASTER_KEY,
              request_timeout_ms: 15_000,
            },
          },
        ],
        default_provider: "meilisearch",
        index_prefix: process.env.MEILISEARCH_INDEX_PREFIX || "store",
        reindex: {
          batch_size: 100,
        },
      },
    },
  ],
})

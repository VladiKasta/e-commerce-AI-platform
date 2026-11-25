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
    vite: (config) => {
      // Настройка dev-сервера Medusa Admin для работы внутри Docker.
      // Основано на официальном руководстве Medusa по установке с Docker.
      return {
        ...config,
        server: {
          ...(config.server ?? {}),
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
  ],
})

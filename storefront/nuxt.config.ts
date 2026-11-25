import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2026-11-01",
  devtools: { enabled: true },

  modules: ["@nuxt/eslint"],

  css: ["~/assets/css/main.css"],

  vite: {
    plugins: [tailwindcss()],
  },

  typescript: {
    strict: true,
  },

  runtimeConfig: {
    // Приватная часть — доступна только на сервере (Nitro).
    // Docker: NUXT_MEDUSA_URL=http://medusa:9000 (внутренний адрес Docker-сети).
    medusaUrl: "http://localhost:9000",
    public: {
      // Публичная часть — доступна и на сервере, и в браузере.
      // Адрес Medusa для клиентских запросов (публичен по определению).
      medusaUrl: "http://localhost:9000",
      medusaPublishableKey: "",
      // Таймаут запросов Commerce Client (мс).
      medusaTimeoutMs: 15_000,
      siteUrl: "http://localhost:3000",
      storeName: "Demo Store",
      storeLocale: "ru-RU",
      storeCurrency: "rub",
    },
  },
})

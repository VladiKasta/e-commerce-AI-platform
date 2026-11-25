import { createCommerceClient } from "#shared/utils/commerce-client"
import type { CommerceClient } from "#shared/types/commerce"

declare module "#app" {
  interface NuxtApp {
    /** Commerce Client, кэшированный на время жизни Nuxt-приложения. */
    $commerce?: CommerceClient
  }
}

/**
 * Единая точка доступа к типизированному Commerce Client.
 *
 * Это базовый транспортный слой: никаких данных каталога,
 * корзины или авторизации внутри — только запросы к Medusa.
 *
 * SSR: инстанс кэшируется на nuxtApp (один на запрос — состояние
 * не утекает между пользователями). Браузер: один инстанс на
 * приложение (пользовательского состояния у клиента нет).
 *
 * Сервер обращается к Medusa по внутреннему адресу Docker-сети
 * (`runtimeConfig.medusaUrl`), браузер — по публичному URL
 * (`runtimeConfig.public.medusaUrl`). Publishable API key публичен
 * по определению Medusa; серверные секреты в клиент не попадают.
 */
export function useCommerce(): CommerceClient {
  const nuxtApp = useNuxtApp()

  if (!nuxtApp.$commerce) {
    const config = useRuntimeConfig()

    nuxtApp.$commerce = createCommerceClient({
      baseUrl: import.meta.server
        ? config.medusaUrl
        : config.public.medusaUrl,
      publishableKey: config.public.medusaPublishableKey,
      timeoutMs: config.public.medusaTimeoutMs,
    })
  }

  return nuxtApp.$commerce
}

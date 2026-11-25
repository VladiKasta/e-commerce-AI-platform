import type { StoreHealthResponse } from "#shared/types/medusa"

/**
 * Health check витрины: отвечает всегда, даже если Medusa недоступна.
 * Статус Medusa включается в ответ и используется демо-страницей.
 */
export default defineEventHandler(
  async (event): Promise<StoreHealthResponse> => {
    const config = useRuntimeConfig(event)

    let medusa: StoreHealthResponse["medusa"]

    try {
      await $fetch(`${config.medusaUrl}/health`, {
        timeout: 3_000,
      })
      medusa = "ok"
    } catch {
      medusa = "unreachable"
    }

    return {
      status: "ok",
      medusa,
    }
  }
)

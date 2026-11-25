/**
 * Типы ответов серверных маршрутов Nuxt (Nitro), не покрытые
 * типизированным Commerce Client (shared/utils/commerce-client.ts).
 */

/** Ответ GET /api/health — статус витрины и доступность Medusa. */
export interface StoreHealthResponse {
  status: string
  medusa: "ok" | "unreachable"
}

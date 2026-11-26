import MeilisearchProviderService from "./service"

/**
 * Регистрация провайдера meilisearch для официального Search Module
 * Medusa. Разрешение провайдера в medusa-config.ts:
 *
 *   modules: [
 *     {
 *       resolve: "@medusajs/medusa/search",
 *       options: {
 *         providers: [
 *           {
 *             resolve: "./src/modules/search-meilisearch/providers/meilisearch",
 *             id: "meilisearch",
 *             options: { host: ..., master_key: ... },
 *           },
 *         ],
 *         default_provider: "meilisearch",
 *       },
 *     },
 *   ]
 */
export default {
  services: [MeilisearchProviderService],
}

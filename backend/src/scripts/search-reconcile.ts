import type { ExecArgs } from "@medusajs/framework/types"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { executeSearchReconcile } from "../jobs/search-index-reconcile"

/**
 * Ручной запуск сверки поискового индекса с PostgreSQL (make search-reconcile).
 *
 * Выполняет ту же логику, что и scheduled job search-index-reconcile
 * (включая блокировку от параллельного запуска): сравнивает документы
 * активного индекса с пересобранными из PostgreSQL и ремонтирует только
 * расхождения — без полной переиндексации. Расписание job'а — переменная
 * SEARCH_RECONCILE_CRON (см. .env.example).
 */
export default async function searchReconcile({ container }: ExecArgs) {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  await executeSearchReconcile(container, logger)
}

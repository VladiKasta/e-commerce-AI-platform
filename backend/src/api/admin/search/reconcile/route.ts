import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  executeSearchReconcile,
  type ReconcileSummary,
} from "../../../../jobs/search-index-reconcile"

/**
 * POST /admin/search/reconcile — запуск сверки поискового индекса с
 * PostgreSQL (та же логика, что у scheduled job search-index-reconcile и
 * `make search-reconcile`, под тем же lock-ом).
 *
 * Операционная команда: обнаруживает отсутствующие/устаревшие/лишние
 * документы и сироты, точечно ремонтирует только затронутые товары через
 * официальный Search Module (частичная переиндексация без swap +
 * точечные удаления). Полная переиндексация не выполняется.
 *
 * Ответ 200:
 *  - { "status": "completed", "summary": {…} } — сверка выполнена;
 *  - { "status": "skipped" } — предыдущий запуск еще выполняется.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<
    | { status: "completed"; summary: ReconcileSummary }
    | { status: "skipped" }
  >
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const result = await executeSearchReconcile(req.scope, logger)
  res.json(result)
}

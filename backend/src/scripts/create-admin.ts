import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createUsersWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Идемпотентное создание администратора Medusa.
 *
 * Повторяет логику команды `medusa user`, но безопасен при повторных
 * запусках: если пользователь с email из ADMIN_EMAIL уже существует,
 * скрипт ничего не создает.
 *
 * Логика (как в CLI Medusa):
 *  1. Создается пользователь через createUsersWorkflow.
 *  2. Регистрируется auth identity (провайдер emailpass).
 *  3. Auth identity связывается с пользователем через app_metadata.
 *
 * Запуск: `medusa exec ./src/scripts/create-admin.ts` (см. `pnpm create-admin`).
 */
export default async function createAdmin({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const userService = container.resolve(Modules.USER)
  const authService = container.resolve(Modules.AUTH)

  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD ?? ""

  if (!email || !password) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ADMIN_EMAIL и ADMIN_PASSWORD должны быть установлены в .env"
    )
  }

  const existingUsers = await userService.listUsers()
  const existingUser = existingUsers.find(
    (user) => user.email?.toLowerCase() === email
  )

  if (existingUser) {
    logger.info(`Администратор ${email} уже существует — пропускаю создание`)
    return
  }

  const { result } = await createUsersWorkflow(container).run({
    input: {
      users: [{ email }],
    },
  })
  const user = result[0]

  const { authIdentity, error } = await authService.register("emailpass", {
    body: {
      email,
      password,
    },
  })

  if (error || !authIdentity) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Не удалось создать учетные данные для ${email}: ${error ?? "unknown error"}`
    )
  }

  await authService.updateAuthIdentities({
    id: authIdentity.id,
    app_metadata: {
      user_id: user.id,
    },
  })

  logger.info(`Администратор ${email} создан`)
}

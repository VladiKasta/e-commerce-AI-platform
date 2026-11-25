#!/bin/sh
# Entry point одноразового init-сервиса (backend-образ).
#
# Режимы:
#   full      — валидация + миграции + seed + создание администратора (по умолчанию)
#   migrate   — только миграции Medusa
#   seed      — только seed-скрипт
#   admin     — только создание администратора
#   validate  — только валидация конфигурации
#   lint      — линтинг backend-кода
#   typecheck — проверка типов backend-кода

set -e

MODE="${1:-full}"

cd /server/backend

echo "==> [init] Валидация конфигурации окружения"
node /server/infrastructure/scripts/validate-env.mjs --file /server/.env

case "$MODE" in
  validate)
    ;;
  migrate)
    echo "==> [init] Миграции Medusa"
    pnpm run migrate
    ;;
  seed)
    echo "==> [init] Seed базовой конфигурации магазина"
    pnpm run seed
    ;;
  admin)
    echo "==> [init] Создание администратора"
    pnpm run create-admin
    ;;
  lint)
    pnpm run lint
    ;;
  typecheck)
    pnpm run typecheck
    ;;
  full)
    echo "==> [init] Миграции Medusa"
    pnpm run migrate
    echo "==> [init] Seed базовой конфигурации магазина"
    pnpm run seed
    echo "==> [init] Создание администратора"
    pnpm run create-admin
    ;;
  *)
    echo "Неизвестный режим: $MODE" >&2
    echo "Доступные режимы: full, migrate, seed, admin, validate, lint, typecheck" >&2
    exit 1
    ;;
esac

echo "==> [init] Готово (режим: $MODE)"

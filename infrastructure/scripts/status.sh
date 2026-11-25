#!/usr/bin/env bash
# Проверка статуса всех сервисов eCommerce Starter Kit.
#
# Использование:
#   bash infrastructure/scripts/status.sh          — разовая проверка
#   bash infrastructure/scripts/status.sh --wait   — ждать готовности (до 180 сек)
#
# PostgreSQL, Redis и Meilisearch проверяются внутри Docker-сети через
# `docker compose exec` (сервисы не публикуются наружу).
# Medusa и storefront проверяются с хоста по опубликованным портам.

set -uo pipefail

WAIT=false
if [ "${1:-}" = "--wait" ]; then
  WAIT=true
fi

if [ ! -f .env ]; then
  echo "✗ Файл .env не найден. Выполните: cp .env.example .env && make init" >&2
  exit 1
fi

# Загружаем переменные из корневого .env (значения совместимы с shell).
set -a
# shellcheck disable=SC1091
source .env
set +a

MEDUSA_PORT="${MEDUSA_PORT:-9000}"
NUXT_PORT="${NUXT_PORT:-3000}"
TIMEOUT="${STATUS_TIMEOUT:-180}"

results=()

check_postgres() {
  docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1
}

check_redis() {
  [ "$(docker compose exec -T redis redis-cli ping 2>/dev/null)" = "PONG" ]
}

check_meilisearch() {
  docker compose exec -T meilisearch wget -q -O - http://127.0.0.1:7700/health 2>/dev/null | grep -q '"status"'
}

check_medusa() {
  curl -fsS "http://localhost:${MEDUSA_PORT}/health" >/dev/null 2>&1
}

check_storefront() {
  curl -fsS "http://localhost:${NUXT_PORT}/api/health" >/dev/null 2>&1
}

run_checks() {
  local all_ok=true

  if check_postgres; then results+=("postgres:OK"); else results+=("postgres:FAIL"); all_ok=false; fi
  if check_redis; then results+=("redis:OK"); else results+=("redis:FAIL"); all_ok=false; fi
  if check_meilisearch; then results+=("meilisearch:OK"); else results+=("meilisearch:FAIL"); all_ok=false; fi
  if check_medusa; then results+=("medusa:OK"); else results+=("medusa:FAIL"); all_ok=false; fi
  if check_storefront; then results+=("storefront:OK"); else results+=("storefront:FAIL"); all_ok=false; fi

  $all_ok
}

if $WAIT; then
  echo "Ожидаю готовности сервисов (до ${TIMEOUT} сек)..."
  deadline=$((SECONDS + TIMEOUT))
  while true; do
    results=()
    if run_checks; then
      break
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "✗ Таймаут ожидания готовности сервисов" >&2
      docker compose ps
      exit 1
    fi
    sleep 3
  done
else
  results=()
  run_checks || true
fi

echo
echo "Статус сервисов:"
for entry in "${results[@]}"; do
  name="${entry%%:*}"
  status="${entry##*:}"
  if [ "$status" = "OK" ]; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name"
  fi
done

echo
docker compose ps --format "table {{.Service}}\t{{.Status}}" 2>/dev/null || docker compose ps

ok_count=0
for entry in "${results[@]}"; do
  [ "${entry##*:}" = "OK" ] && ok_count=$((ok_count + 1))
done

if [ "$ok_count" -eq "${#results[@]}" ]; then
  echo
  echo "Все сервисы доступны:"
  echo "  • Storefront (Nuxt SSR): http://localhost:${NUXT_PORT}"
  echo "  • Medusa API:            http://localhost:${MEDUSA_PORT}"
  echo "  • Medusa Admin:          http://localhost:${MEDUSA_PORT}/app"
  echo "  • Логин администратора:  ADMIN_EMAIL / ADMIN_PASSWORD из .env"
  exit 0
else
  echo
  echo "Не все сервисы доступны — смотрите логи: make logs" >&2
  exit 1
fi

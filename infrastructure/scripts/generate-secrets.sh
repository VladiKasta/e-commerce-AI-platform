#!/usr/bin/env bash
# Генерация отсутствующих секретов в корневом .env.
#
# Правила:
#   - .env создается из .env.example, если его нет;
#   - секреты генерируются только если они ПУСТЫЕ или отсутствуют;
#   - существующие значения никогда не перезаписываются.
#
# Использование:
#   bash infrastructure/scripts/generate-secrets.sh [.env]

set -euo pipefail

ENV_FILE="${1:-.env}"
EXAMPLE_FILE=".env.example"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$EXAMPLE_FILE" ]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo "• Создан $ENV_FILE из $EXAMPLE_FILE"
  else
    echo "Ошибка: не найден ни $ENV_FILE, ни $EXAMPLE_FILE" >&2
    exit 1
  fi
fi

gen_hex() {
  openssl rand -hex "$1"
}

env_value() {
  # Значение переменной из .env (последнее вхождение, без кавычек).
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

set_env_value() {
  # Перезаписывает пустое значение существующей переменной.
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  awk -v k="$key" -v v="$value" '
    index($0, k "=") == 1 { print k "=" v; next }
    { print }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

ensure_secret() {
  local key="$1" bytes="$2"
  if [ -z "$(env_value "$key")" ]; then
    set_env_value "$key" "$(gen_hex "$bytes")"
    echo "• Сгенерирован $key"
  else
    echo "• $key уже задан — не трогаю"
  fi
}

ensure_secret POSTGRES_PASSWORD 16
ensure_secret JWT_SECRET 32
ensure_secret COOKIE_SECRET 32
ensure_secret ADMIN_PASSWORD 8
ensure_secret MEILISEARCH_MASTER_KEY 16

echo "Секреты готовы."

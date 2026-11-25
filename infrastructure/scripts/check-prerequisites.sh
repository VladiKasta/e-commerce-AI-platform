#!/usr/bin/env bash
# Проверка предварительных требований хост-машины.
#
# Для запуска проекта нужны только: make, Docker (с compose v2), openssl и curl.
# PostgreSQL, Redis, Meilisearch, Node.js и pnpm устанавливать не требуется —
# все сервисы работают в Docker.

set -euo pipefail

fail() {
  echo "✗ $1" >&2
  exit 1
}

ok() {
  echo "✓ $1"
}

command -v docker >/dev/null 2>&1 || fail "Docker не установлен (https://docs.docker.com/get-docker/)"
docker info >/dev/null 2>&1 || fail "Docker daemon не запущен. Запустите Docker Desktop или `systemctl start docker`"
docker compose version >/dev/null 2>&1 || fail "docker compose (v2) недоступен"
command -v openssl >/dev/null 2>&1 || fail "openssl не найден"
command -v curl >/dev/null 2>&1 || fail "curl не найден"

[ -f .env ] || [ -f .env.example ] || fail "Не найден .env или .env.example в корне проекта"

ok "Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
ok "Docker Compose $(docker compose version --short)"
ok "openssl и curl доступны"

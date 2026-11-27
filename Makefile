# ============================================================================
# eCommerce Starter Kit — команды управления
# ============================================================================
# Полное описание проекта: README.md
# Переменные окружения:    .env.example и docs/configuration.md
# Установка с нуля:         docs/installation.md

.DEFAULT_GOAL := help
SHELL := /bin/bash
.SILENT:

SCRIPTS := infrastructure/scripts

.PHONY: help init up down dev build logs status migrate seed lint typecheck test search-init search-reindex search-status search-reconcile search-logs

help: ## Показать список команд
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ── Основной сценарий запуска ───────────────────────────────────────────────

init: ## Полная инициализация с нуля (проверки, секреты, миграции, seed, запуск)
	@bash $(SCRIPTS)/check-prerequisites.sh
	@bash $(SCRIPTS)/generate-secrets.sh
	@if command -v node >/dev/null 2>&1; then \
		node $(SCRIPTS)/validate-env.mjs || exit 1; \
	fi
	@docker compose up -d postgres redis meilisearch --wait
	@docker compose build medusa storefront
	@echo "==> Инициализация базы данных (идемпотентно)"
	@docker compose run --rm init
	@docker compose up -d --no-deps --renew-anon-volumes --wait medusa storefront
	@bash $(SCRIPTS)/status.sh --wait
	@echo ""
	@echo "Готово. Medusa Admin: http://localhost:$$(grep -E '^MEDUSA_PORT=' .env | cut -d= -f2)/app"
	@echo "Логин администратора хранится в .env (ADMIN_EMAIL / ADMIN_PASSWORD)."

# ── Управление стеком ────────────────────────────────────────────────────────

up: ## Запустить все сервисы в фоне (после make init)
	@docker compose up -d --build --renew-anon-volumes --wait
	@bash $(SCRIPTS)/status.sh --wait

down: ## Остановить все сервисы (данные и volumes сохраняются)
	@docker compose down

dev: ## Запустить все сервисы в foreground с логами (hot reload)
	@docker compose up --build --renew-anon-volumes

build: ## Пересобрать Docker-образы backend и storefront
	@docker compose build medusa storefront

logs: ## Показать логи всех сервисов (Ctrl+C для выхода)
	@docker compose logs -f --tail=100

status: ## Проверить доступность всех сервисов
	@bash $(SCRIPTS)/status.sh

# ── Обслуживание данных ──────────────────────────────────────────────────────
# Все команды идемпотентны и безопасны: данные и volumes не удаляются.

migrate: ## Применить миграции Medusa (включая поисковые индексы)
	@docker compose run --rm init sh /server/infrastructure/scripts/init.sh migrate

seed: ## Запустить seed-скрипт (магазин, регион, канал, ключ, демо-товары)
	@docker compose run --rm init sh /server/infrastructure/scripts/init.sh seed

# ── Поиск (Meilisearch) ─────────────────────────────────────────────────────
# Команды работают с включенным стеком (make up). Все операции идемпотентны:
# данные каталога не удаляются, повторный запуск безопасен.

search-init: ## Инициализация поиска: индексы, настройки, первоначальная индексация
	@docker compose exec -T medusa sh -c "cd /server/backend && ./node_modules/.bin/medusa exec ./src/scripts/search-init.ts"

search-reindex: ## Полная переиндексация каталога (атомарная замена версии индекса)
	@docker compose exec -T medusa sh -c "cd /server/backend && ./node_modules/.bin/medusa exec ./src/scripts/search-reindex.ts"

search-status: ## Статус поиска: здоровье, индексы, счетчики, проверка API
	@docker compose exec -T medusa sh -c "cd /server/backend && ./node_modules/.bin/medusa exec ./src/scripts/search-status.ts"

search-reconcile: ## Сверка индекса с PostgreSQL: точечный ремонт расхождений
	@docker compose exec -T medusa sh -c "cd /server/backend && ./node_modules/.bin/medusa exec ./src/scripts/search-reconcile.ts"

search-logs: ## Логи Meilisearch (Ctrl+C для выхода)
	@docker compose logs -f --tail=100 meilisearch

# ── Проверки качества ────────────────────────────────────────────────────────
# Запускаются внутри Docker — Node.js и pnpm на хосте не требуются.

lint: ## Линтинг backend (medusa lint) и storefront (eslint)
	@docker compose run --rm --no-deps init sh /server/infrastructure/scripts/init.sh lint
	@docker compose run --rm --no-deps storefront pnpm lint

typecheck: ## Проверка типов backend (tsc) и storefront (vue-tsc)
	@docker compose run --rm --no-deps init sh /server/infrastructure/scripts/init.sh typecheck
	@docker compose run --rm --no-deps storefront pnpm typecheck

test: ## Автотесты storefront: unit + интеграционные на живой Medusa
	@docker compose run --rm --no-deps -e ADMIN_EMAIL -e ADMIN_PASSWORD -e MEILISEARCH_HOST -e MEILISEARCH_MASTER_KEY storefront pnpm test

# Установка

Пошаговая инструкция установки eCommerce Starter Kit с нуля, повторного запуска и диагностики ошибок.

## 1. Системные требования

| Инструмент | Зачем нужен | Проверка |
|---|---|---|
| Docker + Compose v2 | Вся среда выполнения | `docker --version && docker compose version` |
| GNU make | Команды управления | `make --version` |
| openssl | Генерация секретов | `openssl version` |
| curl | Проверки доступности | `curl --version` |
| Node.js ≥ 22.23.4 и pnpm | **Опционально**: нативная разработка вне Docker | `node --version` |

PostgreSQL, Redis, Meilisearch на хосте **не требуются и не используются**.

## 2. Установка с нуля

```bash
# 1. Скопировать шаблон окружения
cp .env.example .env

# 2. Полная инициализация (одна команда)
make init
```

`make init` выполняет автоматически:

1. Проверку окружения (`infrastructure/scripts/check-prerequisites.sh`).
2. Генерацию отсутствующих секретов (POSTGRES_PASSWORD, JWT_SECRET, COOKIE_SECRET, ADMIN_PASSWORD, MEILISEARCH_MASTER_KEY) — существующие значения не перезаписываются.
3. Валидацию конфигурации (`infrastructure/scripts/validate-env.mjs`).
4. Запуск PostgreSQL, Redis, Meilisearch с ожиданием health checks.
5. Сборку Docker-образов backend и storefront.
6. Одноразовую инициализацию: миграции Medusa → seed → администратор → publishable API key (записывается в `.env`).
7. Запуск Medusa и storefront с ожиданием готовности.
8. Проверку доступности всех сервисов и вывод адресов.

После завершения:

- Витрина: <http://localhost:3000>
- Medusa Admin: <http://localhost:9000/app> (логин — `ADMIN_EMAIL`/`ADMIN_PASSWORD` из `.env`)

### Альтернатива без Makefile

```bash
cp .env.example .env
bash infrastructure/scripts/check-prerequisites.sh
bash infrastructure/scripts/generate-secrets.sh
docker compose up -d postgres redis meilisearch --wait
docker compose build medusa storefront
docker compose run --rm init                       # миграции + seed + администратор
docker compose up -d --no-deps --renew-anon-volumes --wait medusa storefront
bash infrastructure/scripts/status.sh
```

## 3. Повторный запуск

```bash
make up        # поднять стек (данные сохраняются; init при необходимости дозапустит миграции/seed)
make down      # остановить (volumes НЕ удаляются)
make dev       # работа в foreground с логами и hot reload
```

Данные (PostgreSQL, Meilisearch, созданные администратор и API key) переживают `down`/`up` и перезагрузку Docker.

### Повторная инициализация

`make init` можно запускать сколько угодно раз: он идемпотентен — не создает дубликаты товаров, администраторов или ключей, не сбрасывает данные и не перезаписывает уже заданные секреты.

## 4. Ежедневные операции

```bash
make status    # статус и доступность всех сервисов
make logs      # все логи (или: docker compose logs -f medusa)
make migrate   # применить миграции (после обновления Medusa)
make seed      # перезапустить seed (например, после изменения демо-данных)
make lint      # линтинг обоих приложений (в Docker)
make typecheck # проверка типов обоих приложений (в Docker)
make test      # автотесты storefront: unit + интеграционные на живой Medusa (в Docker)
make build     # пересобрать образы (например, после изменения package.json/lockfile)
```

### Типы Nuxt для IDE (`.nuxt`)

Каталог `.nuxt` (сгенерированные типы Nuxt: `runtimeConfig`, auto-imports, маршруты) **не изолируется** анонимным volume и виден на хосте — IDE читает типы напрямую из репозитория. Типы генерирует `nuxt prepare` в контейнере; эта команда входит в `make lint`, `make typecheck` и `make test`, поэтому после изменения `nuxt.config.ts` (например, `runtimeConfig`) достаточно запустить любую из них.

Только генерация типов, без проверок:

```bash
docker compose run --rm --no-deps storefront pnpm nuxt prepare
```

Node.js и pnpm на хосте не требуются. Если IDE показывает устаревшие типы (например, `unknown` вместо `string` у полей `runtimeConfig`) — запустите команду выше и перезапустите TS-сервер (VS Code: «TypeScript: Restart TS Server»).

## 5. Диагностика ошибок

### `make init` завершается ошибкой валидации

- Сообщения вида `X не задан в .env` — скопируйте `.env.example` в `.env` и запустите `make init` заново.
- `JWT_SECRET не должен быть значением по умолчанию` — выполните `bash infrastructure/scripts/generate-secrets.sh`.
- `MEILISEARCH_MASTER_KEY должен содержать минимум 16 символов` — сгенерируйте: `openssl rand -hex 16`.

### Контейнер `meilisearch` (или другой) unhealthy

```bash
docker compose ps                       # кто именно unhealthy
docker compose logs meilisearch        # причина
docker compose restart meilisearch
```

### Storefront показывает «Medusa: недоступно»

```bash
make status                  # статус medusa
docker compose logs medusa   # ошибки бэкенда
```

Типичные причины: init еще не завершился (подождите), изменен `MEDUSA_PORT` без обновления `MEDUSA_INTERNAL_URL`/`MEDUSA_PUBLIC_URL`.

### Товары не отображаются на витрине

1. Проверьте, что seed выполнен: `make seed` (в логе «Демо-товары уже существуют» или «Создано демо-товаров»).
2. Проверьте publishable API key:

   ```bash
   curl "http://localhost:9000/store/products?limit=1" \
     -H "x-publishable-api-key: $(grep ^MEDUSA_PUBLISHABLE_KEY= .env | cut -d= -f2)"
   ```

3. Если .env был воссоздан заново при существующем volume, ключ в `.env` может не совпадать с базой — seed синхронизирует его автоматически (`make seed`).

### После пересборки образов код не видит новых зависимостей

Обновились `package.json`/`pnpm-lock.yaml` — пересоберите образы и обновите анонимные тома `node_modules`:

```bash
make build && make up
```

(`make up` уже содержит `--renew-anon-volumes`.)

### Полный сброс окружения (осторожно: удалит все данные!)

```bash
docker compose down -v   # удаляет volumes PostgreSQL и Meilisearch
rm .env && cp .env.example .env
make init
```

### Конфликт портов

Порты по умолчанию: 3000 (Nuxt), 9000 (Medusa), 5173 (Admin dev-сервер). Занятые порты меняются в `.env` (`NUXT_PORT`, `MEDUSA_PORT`); для 5173 — правка `docker-compose.yml` и `backend/medusa-config.ts` (секция `admin.vite`).

### Зависла нативная разработка (вне Docker)

```bash
pnpm install          # в корне (workspace)
pnpm --filter @ecommerce-starter/storefront dev   # нужен локальный PostgreSQL/Redis
```

Нативный запуск бэкенда требует собственных `DATABASE_URL`/`REDIS_URL` — Docker-имена (`postgres`, `redis`) с хоста недоступны. Рекомендуемый путь — Docker.

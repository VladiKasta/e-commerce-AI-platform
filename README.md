# eCommerce Starter Kit

Переиспользуемый технический фундамент для быстрого создания и развертывания интернет-магазинов: готовый коммерческий бэкенд на **Medusa v2**, SSR-витрина на **Nuxt 4** и вся необходимая инфраструктура в Docker.

Проект позволяет frontend-разработчику за несколько минут получить рабочий бэкенд с документированным API, демо-каталогом и админкой — и сосредоточиться на дизайне storefront.

## Технологический стек

| Технология | Версия (зафиксирована) | Назначение |
|---|---|---|
| Medusa | 2.23.0 | Коммерческий бэкенд: Store API, Admin API, Medusa Admin |
| Nuxt | 4.7.0 | SSR-витрина (Vue 3.5, TypeScript strict) |
| PostgreSQL | 17.12 (alpine) | База данных |
| Redis | 8.8.4 (alpine) | Сессии, кэш, шина событий, движок workflows |
| Meilisearch | 1.58.0 | Поисковая инфраструктура (индексация — этап 3) |
| Node.js (Docker) | 24.22.3 (alpine3.24) | Среда выполнения backend и storefront |
| Tailwind CSS | 4.3.5 | Стили витрины |
| pnpm | 12.23.0 | Менеджер пакетов (monorepo workspace) |

## Системные требования

На хост-машине нужны только:

- **Docker** (с `docker compose` v2) — [установка](https://docs.docker.com/get-docker/)
- **GNU make**
- **openssl**, **curl**

Устанавливать PostgreSQL, Redis, Meilisearch, Node.js или pnpm на хост **не требуется** — все сервисы работают в Docker. Node.js на хосте опционален (нужен только для нативной разработки вне Docker).

## Быстрый старт

```bash
cp .env.example .env
make init
```

Команда сама: проверит окружение, сгенерирует отсутствующие секреты, запустит инфраструктуру, применит миграции Medusa, выполнит идемпотентный seed (магазин, регион «Россия», RUB, канал продаж, склад, способы доставки, publishable API key, 10 демо-товаров), создаст администратора и запустит бэкенд с витриной.

Альтернатива без Makefile:

```bash
cp .env.example .env
bash infrastructure/scripts/check-prerequisites.sh
bash infrastructure/scripts/generate-secrets.sh
docker compose up -d --build --wait
docker compose run --rm init        # миграции + seed + администратор
docker compose up -d --renew-anon-volumes --wait
```

## Адреса сервисов

| Сервис | URL | Доступность |
|---|---|---|
| Storefront (Nuxt, SSR) | <http://localhost:3000> | публичный |
| Medusa API | <http://localhost:9000> | публичный |
| Medusa Admin | <http://localhost:9000/app> | публичный (вход по паре из `.env`) |
| Health check | <http://localhost:9000/health> | публичный |
| PostgreSQL, Redis, Meilisearch | только внутри Docker-сети | наружу не публикуются |

## Доступ к Medusa Admin

1. Откройте <http://localhost:9000/app>.
2. Логин и пароль — значения `ADMIN_EMAIL` и `ADMIN_PASSWORD` из корневого `.env`.
   Пароль генерируется автоматически при первом `make init`.

## Команды управления

```bash
make init      # полная инициализация с нуля (идемпотентна, данные не удаляет)
make up        # запустить все сервисы в фоне
make down      # остановить (данные и volumes сохраняются)
make dev       # запуск в foreground с логами (hot reload backend + storefront)
make build     # пересобрать Docker-образы
make logs      # логи всех сервисов
make status    # проверить доступность всех сервисов
make migrate   # применить миграции Medusa
make seed      # повторно выполнить seed (идемпотентен)
make lint      # линтинг backend (medusa lint) и storefront (eslint)
make typecheck  # проверка типов backend (tsc) и storefront (vue-tsc)
make test      # автотесты storefront: unit + интеграционные на живой Medusa
```

`lint`, `typecheck` и `test` выполняются внутри Docker — Node.js на хосте не нужен. Повторный запуск любой команды не удаляет данные и не создает дубликаты.

## Что уже работает

- Автоматическая инициализация всего стека одной командой, включая publishable API key и администратора.
- Идемпотентный seed: магазин «Demo Store», регион «Россия» (валюта RUB), канал продаж, склад, стандартная и экспресс-доставка, тестовый платежный провайдер `pp_system_default`.
- Демо-каталог: 3 категории, 10 товаров (28 вариантов) с ценами в рублях и остатками, включая товары без наличия.
- **Типизированный Commerce Client** (этап 2): `useCommerce()` поверх официального Medusa JS SDK — товары, категории, коллекции, регионы; региональные рассчитанные цены, пагинация, таймаут, отмена запросов, единая обработка ошибок.
- **Composables**: `useStore()` — регионы, валюта, форматирование цен; обе SSR-совместимы.
- Демо-страницы витрины (SSR): главная, `/catalog` (пагинация), `/product/:handle` (варианты, характеристики, 404 для отсутствующего товара).
- Автотесты: 31 unit + 20 интеграционных на живой Medusa (`make test`).
- Meilisearch запущен и доступен внутри Docker-сети (индексация — этап 3).
- Документированные API-маршруты: [docs/api.md](docs/api.md); клиент: [docs/commerce-client.md](docs/commerce-client.md); composables: [docs/composables.md](docs/composables.md).

## Документация

- [Установка и диагностика](docs/installation.md)
- [Переменные окружения](docs/configuration.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [API-справочник](docs/api.md)
- [Commerce Client](docs/commerce-client.md)
- [Composables](docs/composables.md)
- [Дорожная карта](docs/ROADMAP.md)
- [Прогресс проекта](docs/PROGRESS.md)

## Известные ограничения (этап 2)

- Конфигурация Docker-стека ориентирована на **разработку** (development): `medusa develop` и `nuxt dev` с hot reload. Production-сборка и развертывание — этап 10.
- Meilisearch подготовлен как инфраструктура, но индексация и поиск будут реализованы на этапе 3.
- Корзина, checkout, авторизация покупателя, SEO и платежные системы — последующие этапы (см. ROADMAP).
- Демо-данные (товары, изображения) предназначены только для тестирования.
- Русские названия в seed-данных чувствительны к кодировке UTF-8 (убедитесь, что терминал и git настроены корректно).

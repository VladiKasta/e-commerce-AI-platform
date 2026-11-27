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
| Meilisearch | 1.58.0 | Полнотекстовый поиск и фасетная фильтрация (официальный Search Module Medusa) |
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
make search-init      # инициализация поиска: индексы, настройки, первичная индексация
make search-reindex   # полная переиндексация (новая версия индекса + атомарное переключение)
make search-status    # здоровье поиска, версии индекса, счетчики документов
make search-reconcile # сверка индекса с PostgreSQL, точечный ремонт расхождений
```

`lint`, `typecheck` и `test` выполняются внутри Docker — Node.js на хосте не нужен. Повторный запуск любой команды не удаляет данные и не создает дубликаты.

## Что уже работает

- Автоматическая инициализация всего стека одной командой, включая publishable API key и администратора.
- Идемпотентный seed: магазин «Demo Store», регион «Россия» (валюта RUB), канал продаж, склад, стандартная и экспресс-доставка, тестовый платежный провайдер `pp_system_default`.
- Демо-каталог: 3 категории, 10 товаров (28 вариантов) с ценами в рублях и остатками, включая товары без наличия; 6 характеристик с 51 допустимым значением и привязками к категориям.
- **Поиск и фасетная фильтрация (этап 3)**: Meilisearch через официальный Search Module Medusa — версионированные индексы с атомарным переключением, автоматическая индексация по событиям (товары/варианты/цены/остатки/характеристики, ~1–2 с), периодическая сверка с PostgreSQL и точечный ремонт (scheduled job + `make search-reconcile`).
- **Store API каталога/поиска**: `GET /store/catalog` (товары + фасеты с точными счетчиками уникальных товаров + точная пагинация одним запросом), `GET /store/search` (полнотекстовый поиск с опечатками и поиском по артикулу), `GET /store/search/suggestions` (typeahead). Вариант-ориентированная фильтрация, OR внутри фильтра / AND между фильтрами, disjunctive-пересчет фасетов.
- **Характеристики товаров (модуль catalog_attributes)**: Admin API (CRUD, допустимые значения, привязки к категориям, значения товаров) и Medusa Admin UI — раздел «Характеристики», настройки фильтрации, виджет на карточке товара.
- **Типизированный Commerce Client** (этап 2): `useCommerce()` поверх официального Medusa JS SDK — товары, категории, коллекции, регионы; региональные рассчитанные цены, пагинация, таймаут, отмена запросов, единая обработка ошибок.
- **Composables**: `useStore()` — регионы, валюта, форматирование цен; обе SSR-совместимы.
- **Корзина, checkout и заказы (этап 4)**: полный гостевой цикл работает на штатном Store API Medusa без собственных маршрутов — корзина, позиции, серверные цены и итоги, промокоды, доставка, платежные коллекции/сессии (`pp_system_default`), завершение → заказ, чтение заказа; завершение корзины сериализовано на backend (два одновременных запроса не создают дубликатов заказов); закрыт 157 автотестами (`make test`), практическое руководство — [docs/checkout.md](docs/checkout.md).
- Демо-страницы витрины (SSR): главная, `/catalog` (пагинация), `/product/:handle` (варианты, характеристики, 404 для отсутствующего товара).
- Автотесты: 157 (unit + интеграционные на живых Medusa/Meilisearch, `make test`).
- Документированные API-маршруты: [docs/api.md](docs/api.md) + OpenAPI-спецификация собственных маршрутов: [docs/openapi.yaml](docs/openapi.yaml); поиск: [docs/search.md](docs/search.md); фильтры: [docs/filters.md](docs/filters.md); индексация: [docs/indexing.md](docs/indexing.md).

## Документация

- [Установка и диагностика](docs/installation.md)
- [Переменные окружения](docs/configuration.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [API-справочник](docs/api.md) · [OpenAPI (поиск и характеристики)](docs/openapi.yaml)
- [Поиск (Meilisearch)](docs/search.md)
- [Фасетная фильтрация и характеристики](docs/filters.md)
- [Индексация каталога](docs/indexing.md)
- [Commerce Client](docs/commerce-client.md)
- [Composables](docs/composables.md)
- [Checkout: практическое руководство](docs/checkout.md)
- [Дорожная карта](docs/ROADMAP.md)
- [Прогресс проекта](docs/PROGRESS.md)

## Известные ограничения

- Конфигурация Docker-стека ориентирована на **разработку** (development): `medusa develop` и `nuxt dev` с hot reload. Production-сборка и развертывание — этап 10.
- Цены в поисковом индексе — минимальная цена варианта в валюте (прайс-листы исключены): фильтрация/сортировка корректны, точная рассчитанная цена — через `/store/products` (полный список ограничений — [docs/search.md](docs/search.md)).
- Композаблы каталога/поиска/фильтров витрины — этап 9; демо-страницы этапа 2 используют Commerce Client без фасетов.
- Авторизация покупателя, реальные платежи (ЮKassa/Т-Банк), SEO и страницы корзины/checkout витрины — этапы 5–10 по принципу Backend First, Frontend Last (см. ROADMAP).
- ~~Два одновременных запроса complete одной корзины могут создать два заказа~~ — устранено этапом 4.5: завершение корзины сериализовано на backend (транзакционный advisory-лок PostgreSQL по cart_id); повторный/одновременный complete возвращает тот же заказ.
- Демо-данные (товары, изображения) предназначены только для тестирования.
- Русские названия в seed-данных чувствительны к кодировке UTF-8 (убедитесь, что терминал и git настроены корректно).

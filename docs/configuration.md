# Переменные окружения

Единый источник конфигурации — корневой `.env` (шаблон: `.env.example`). Compose подставляет значения в контейнеры; каждый сервис получает только нужные ему переменные (см. `docker-compose.yml`).

Обозначения в колонке «Доступ»:
- **private** — только серверная сторона; никогда не передается в браузер;
- **public** — доступна и серверу, и браузеру (по дизайну не является секретом);
- **—** — не попадает в приложения, используется скриптами/образами.

Обозначения в колонке «Заполнение»:
- **[auto]** — генерируется `make init`, если пусто; существующее значение не перезаписывается;
- **[seed]** — заполняется seed-скриптом автоматически;
- **вручную** — задает пользователь (значение по умолчанию подходит для локальной разработки).

## Application

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `NODE_ENV` | `development` | да | вручную | private | Режим окружения. Compose запускает dev-серверы с hot reload. |
| `STORE_NAME` | `"Demo Store"` | да | вручную | private/public | Название магазина: seed передает его в Medusa, витрина показывает на главной (публичная копия — `NUXT_PUBLIC_STORE_NAME`). |
| `STORE_LOCALE` | `ru-RU` | да | вручную | public | Локаль витрины (форматирование цен через `Intl.NumberFormat`). |
| `STORE_CURRENCY` | `rub` | да | вручную | public | Валюта магазина (ISO-код в нижнем регистре); seed использует ее для региона, цен и магазина. |

## PostgreSQL

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `POSTGRES_HOST` | `postgres` | да | вручную | private | Хост **внутри Docker-сети** (с хоста недоступен). |
| `POSTGRES_PORT` | `5432` | да | вручную | private | Порт внутри Docker-сети. |
| `POSTGRES_DB` | `medusa` | да | вручную | private | Имя базы; создается автоматически при первом старте postgres. |
| `POSTGRES_USER` | `medusa` | да | вручную | private | Пользователь БД; создается автоматически. |
| `POSTGRES_PASSWORD` | — | да | [auto] | private | Пароль БД (hex, 32 символа). Compose собирает из этих переменных `DATABASE_URL` для Medusa. |

## Redis

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `REDIS_URL` | `redis://redis:6379` | да | вручную | private | URL Redis внутри Docker-сети. Используется Medusa для сессий, кэша (`cache-redis`), событий (`event-bus-redis`) и workflows (`workflow-engine-redis`). |

## Medusa

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `MEDUSA_PORT` | `9000` | да | вручную | private | Порт Medusa (API + Admin + `/health`). Если меняете — обновите также `MEDUSA_INTERNAL_URL`, `MEDUSA_PUBLIC_URL` и CORS. |
| `MEDUSA_INTERNAL_URL` | `http://medusa:9000` | да | вручную | private | Внутренний Docker-URL Medusa для серверной стороны Nuxt (`NUXT_MEDUSA_URL`). |
| `MEDUSA_PUBLIC_URL` | `http://localhost:9000` | да | вручную | — | Публичный URL Medusa для документации и curl-примеров. |
| `MEDUSA_PUBLISHABLE_KEY` | — | нет | [seed] | public | Publishable API key Store API. Создается seed-скриптом и записывается в `.env`; не секрет. Пустое значение допустимо только до первой инициализации. |
| `JWT_SECRET` | — | да | [auto] | private | Секрет JWT Medusa (hex, 64 символа). Значение `supersecret` отклоняется валидатором. |
| `COOKIE_SECRET` | — | да | [auto] | private | Секрет cookies Medusa (hex, 64 символа). |
| `STORE_CORS` | `http://localhost:3000` | да | вручную | private | Разрешенные origins для Store API (через запятую, без слэша в конце). |
| `ADMIN_CORS` | `http://localhost:9000,http://localhost:5173` | да | вручную | private | Разрешенные origins для Admin API. |
| `AUTH_CORS` | `http://localhost:3000,http://localhost:9000,http://localhost:5173` | да | вручную | private | Разрешенные origins для `/auth/*` (объединение store и admin origins). |

## Administrator

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `ADMIN_EMAIL` | `admin@example.com` | да | вручную | private | Email администратора Medusa Admin; создается один раз, повторно не пересоздается. |
| `ADMIN_PASSWORD` | — | да | [auto] | private | Пароль администратора (hex, 16 символов; минимум 8). Передается только init-контейнеру. |

## Nuxt (storefront)

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `NUXT_PORT` | `3000` | да | вручную | private | Порт витрины (внутри и снаружи Docker). |
| `NUXT_PUBLIC_SITE_URL` | `http://localhost:3000` | да | вручную | public | Публичный URL витрины. Используется как `storefrontUrl` в admin-ссылках. |
| `NUXT_PUBLIC_MEDUSA_TIMEOUT_MS` | `15000` | нет | вручную | public | Таймаут запросов Commerce Client к Medusa (мс). Передается витрине compose-ом; `0` отключает. |

Дополнительные переменные для витрины собираются из других секций:

- `NUXT_MEDUSA_URL` ← `MEDUSA_INTERNAL_URL` — приватный (SSR) адрес Medusa;
- `NUXT_PUBLIC_MEDUSA_URL` ← `MEDUSA_PUBLIC_URL` — публичный адрес Medusa для запросов из браузера (Commerce Client);
- `NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` ← `MEDUSA_PUBLISHABLE_KEY` — publishable API key (публичен по определению).

Роль переменной `MEDUSA_PUBLISHABLE_KEY` для витрины выполняет `NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` — compose транслирует значение `MEDUSA_PUBLISHABLE_KEY` в публичный runtimeConfig Nuxt.

## Meilisearch

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `MEILISEARCH_HOST` | `http://meilisearch:7700` | да | вручную | private | Внутренний Docker-URL Meilisearch (наружу не публикуется). Используется провайдером поиска и сверкой индекса. |
| `MEILISEARCH_MASTER_KEY` | — | да | [auto] | private | Master key Meilisearch (hex, 32 символа; минимум 16). Используется только внутри backend-контейнеров: провижинирование API-ключей с минимальными правами (search/индексация) и чтение сырых документов сверкой индекса. |
| `MEILISEARCH_INDEX_PREFIX` | `store` | да | вручную | private | Префикс физических поисковых индексов (`store_products_vN`). |
| `MEILISEARCH_STOP_WORDS` | — (встроенный набор `["и","в","с","для","на"]`) | нет | вручную | private | Стоп-слова полнотекстового поиска: JSON-массив строк (`MEILISEARCH_STOP_WORDS=["и","в","с","the"]`). Читается при загрузке определения индекса; применяется к физическому индексу при создании/миграции версии (`make search-init` / `make search-reindex`). Некорректный JSON не роняет backend — значение по умолчанию + предупреждение в логах. |
| `MEILISEARCH_SYNONYMS` | — (пусто) | нет | вручную | private | Синонимы полнотекстового поиска: JSON-объект `{"слово":["синоним1","синоним2"]}` (двунаправленные синонимы Meilisearch). Способ применения — как у стоп-слов. Формат и примеры — [docs/search.md](search.md). |
| `SEARCH_RECONCILE_CRON` | `0 * * * *` | нет | вручную | private | Расписание (cron) scheduled job сверки индекса с PostgreSQL (этап 3.6.2): обнаруживает отсутствующие/устаревшие/лишние документы и точечно ремонтирует затронутые товары через Search Module. Ручной запуск — `make search-reconcile`. |

## Initialization

| Переменная | Значение по умолчанию | Обязательна | Заполнение | Доступ | Назначение |
|---|---|---|---|---|---|
| `SEED_DEMO_DATA` | `true` | да | вручную | private | `true` — seed создает демо-каталог (3 категории, 10 товаров, остатки). `false` — только базовая конфигурация магазина. |
| `STATUS_TIMEOUT` | `180` | нет | вручную | — | Таймаут ожидания готовности сервисов в `status.sh --wait` (секунды). Используется только `make init`/`make up`. |

## Правила безопасности

1. `.env` никогда не коммитится (`.gitignore`) и не копируется в Docker-образы (`.dockerignore`).
2. В браузер попадают только `NUXT_PUBLIC_*` и publishable API key — серверные секреты (`JWT_SECRET`, `COOKIE_SECRET`, `ADMIN_PASSWORD`, пароли БД) в клиентский код не передаются.
3. Compose-конфигурация использует синтаксис `${VAR:?error}` — запуск с незаполненной обязательной переменной падает с понятным сообщением до старта контейнеров.
4. При добавлении новой переменной: обновите `.env.example`, этот файл и при необходимости `validate-env.mjs` и `docker-compose.yml`.

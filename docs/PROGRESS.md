# Прогресс проекта

Дата обновления: 26 ноября 2026 г.

## Текущий этап

**Этап 3. Meilisearch, полнотекстовый поиск и фасетная фильтрация — в разработке.**

Ядро поиска работает на живых данных; Store API каталога/поиска/подсказков отвечает HTTP 200 и закрыт интеграционными тестами (25 сценариев). Оставшиеся задачи этапа: Admin API характеристик, минимальное расширение Medusa Admin, job сверки индекса, unit-тесты трансформации документов, docs/search.md + docs/filters.md + docs/indexing.md, OpenAPI, обновление .env.example (MEILISEARCH_SYNONYMS/STOP_WORDS).

## Выполненные задачи этапа 3 (фактически)

- [x] Технический прототип модели индекса против Meilisearch 1.58 (`infrastructure/scripts/search-prototype.mjs`, 37/37 проверок): документ = вариант × валюта; distinct=product_id; **точный** totalHits в page-режиме; facetDistribution считает варианты → стратегия точного подсчета уникальных товаров через multi-search count-запросы; критический сценарий black+M+in_stock; POST /swap-indexes.
- [x] Интеграция через **официальный Search Module Medusa 2.23** (`defineSearchIndex`, провайдеры, версионированные индексы, встроенный ingestion-subscriber, seeding при старте): создан провайдер Meilisearch (`backend/src/modules/search-meilisearch/`, fetch-клиент без новых зависимостей, два API-ключа с минимальными правами из master key) и определение индекса `products` (`backend/src/search/products.ts`: seed/consume, резолвинг событий товаров/вариантов/цен/остатков/категорий/коллекций/характеристик).
- [x] Модуль `catalog_attributes` (Attribute, AttributeOption, ProductAttributeValue, CategoryAttribute) + миграция; seed расширен: 6 характеристик, 51 значение, привязки к категориям, 2 коллекции, 2 демо-товара, критические остатки (TEE-MED-M-BLK → 0, LONG-MED-M-BLK → 0). Seed идемпотентен (3 прогона — стабильные 51 значение).
- [x] Индекс: 31 документ, синхронизация по событиям подтверждена (обнуление остатка → `in_stock:false` в индексе; создание товаров в seed-процессе → автоиндексация), атомарная переиндексация с заменой версии (`make search-reindex`).
- [x] Store API: `GET /store/catalog`, `GET /store/search`, `GET /store/search/suggestions` — HTTP 200 на живых данных; проверены: критический сценарий (0 товаров), disjunctive-пересчет фасетов, OR внутри атрибута, точные счетчики уникальных товаров (сумма фасета brand = total), подсказки по префиксу.
- [x] Логирование неожиданных ошибок поисковых маршрутов (стек в логах medusa).
- [x] Интеграционные тесты поиска на живых Medusa + Meilisearch: `storefront/tests/integration/catalog-search.spec.ts` — 25 тестов поверх демо-данных (каталог и точные счетчики, поиск по названию и артикулу, подсказки, фильтры цены/наличия, OR/AND, disjunctive-пересчет, критический сценарий, сортировка/пагинация без дубликатов, пустая выдача и невалидные параметры, 400 без publishable key).

## Результаты фактических проверок (26.11.2026)

| # | Проверка | Результат |
|---|---|---|
| 1 | Индексы Meilisearch: `store_products_v1/v2`, 31 документ; критический сценарий прямым запросом (Чёрный+M+в наличии → 0) | ✅ |
| 2 | `GET /store/catalog?limit=2` → 200; `pagination.total=12` (точное число товаров); фасеты с точными счетчиками уникальных товаров (brand: 4+3+3+2=12) | ✅ |
| 3 | Критический сценарий через API: `filter[color]=Чёрный&filter[size]=M&in_stock=true` → 0 товаров; без `in_stock` → 2 товара | ✅ |
| 4 | Disjunctive-фасеты: `filter[color]=Чёрный&filter[size]=M` — фасет size пересчитан без собственного фильтра (S:2, OS:1, M:2 selected); выбранное значение color доступно для снятия | ✅ |
| 5 | OR внутри атрибута: `filter[brand]=deep-sea,urban-basic` → 6 товаров (3+3) | ✅ |
| 6 | `GET /store/search?q=футболка` → 200, `total=3`, найдены все 3 футболки | ✅ |
| 7 | `GET /store/search/suggestions?q=футб` → 200, 4 подсказки (включая префикс «футб» → «футер» в описании свитшота) | ✅ |
| 8 | Защита: без publishable key → 400; `tsc --noEmit` чисто; `medusa lint` 0 ошибок (5 предупреждений) | ✅ |
| 9 | Регрессия этапа 2: витринные тесты 51/51 проходят | ✅ |
| 10 | `make test` с новым набором: **76/76** (51 этап 1–2 + 25 этап 3) — unit + интеграционные на живых Medusa/Meilisearch; `make typecheck` (vue-tsc) — exit 0 | ✅ (26.11.2026) |

## Принятые решения этапа 3 (продолжение журнала)

11. **Официальный Search Module Medusa 2.23** вместо собственного Catalog Indexer: индексация/версионирование/ingestion/seeding — штатные механизмы; собственный код — только провайдер и определение индекса. Выбор соответствует правилу №1 AGENTS.md.
12. **Документ = вариант × валюта + distinct** — единственная модель, одновременно дающая вариант-совместную фильтрацию (критический сценарий) и точную пагинацию (прототип, 37/37).
13. **Точные счетчики уникальных товаров**: facetDistribution Meilisearch считает варианты → per-value count-запросы (multi-search, hitsPerPage=0, page-режим с точным totalHits).
14. **Динамические характеристики** фильтруются через родительский объект `attributes` в filterableAttributes Meilisearch (проверено прототипом): новые характеристики работают без изменения настроек индекса. Маршруты валидируют коды фильтров по реестру характеристик; валидатор полей Search Module для динамических путей не используется (обход задокументирован).
15. **В v2 сервисы создаются только в модулях** (официальная документация): `src/services` приложения не регистрируются. CatalogSearchService инстанцируется маршрутами напрямую с request scope.
16. **Доступ к Meilisearch из каталога** — через публичный конструктор собственного провайдера; активная версия индекса резолвится публичным `getIndex()` + `listIndexes()` (TTL-кэш 30 с; при переиндексации старая версия продолжает отдавать корректные данные).

## Известные проблемы (актуальные)

- Цены в индексе — минимальная цена варианта в валюте (региональные записи одной валюты и прайс-листы сведены к одной величине): фильтрация/сортировка корректна, точная рассчитанная цена — только через `/store/products` (задокументировано).
- Две физические версии индекса (`_v1`, `_v2`) сосуществуют; выбор активной — максимальный номер версии (окно 30 с после swap может отдавать предыдущую версию).
- Кириллица в query-параметрах должна быть percent-encoded (стандартное поведение браузеров/SDK; сырой curl без кодирования получает 400 от HTTP-слоя до приложения).
- Семантика `in_stock=false`: «есть отсутствующие варианты» (согласовано со счетчиком фасета) — задокументировано в docs/api.md.
- Остатки этапа: Admin API/UI, job сверки, полная документация — см. «Текущий этап».

## Следующий этап

Завершение этапа 3 (см. «Текущий этап»), затем этап 4 по ROADMAP.md.

## Этап 2 (завершен) — архив отчета

## Выполненные задачи этапа 2

- [x] Изучены контракты Store API Medusa 2.23 на живом backend: товары (список/ID/handle), категории (список/ID/handle, особенность 200-`{}` для несуществующей категории), коллекции, регионы, рассчитанные цены (`region_id` + `fields=+*variants.calculated_price`), формат сумм (основные единицы), контракт ошибок (`{type, message}`, 400 для неверного publishable key — исправлена ошибка этапа 1, где указывался 401).
- [x] Подключен официальный `@medusajs/js-sdk@2.23.0` (версия backend) + `@medusajs/types@2.23.0` (devDep, HttpTypes) к storefront.
- [x] Типизированный Commerce Client: `storefront/shared/utils/commerce-client.ts` (фабрика `createCommerceClient`) поверх Medusa SDK — группы `products`, `categories`, `collections`, `regions`; официальные типы `HttpTypes`; транспортные опции (`signal`, `timeoutMs`, `headers`); таймаут через `AbortSignal.timeout` с объединением сигналов (`AbortSignal.any`); авто-добавление `fields=+*variants.calculated_price` при региональном контексте; нормализация особенности Medusa с категориями (200-`{}` → 404).
- [x] Единая нормализация ошибок: `storefront/shared/utils/commerce-error.ts` (`CommerceError`, `toCommerceError`, `serializeCommerceError`): сеть → 503 `medusa_unreachable`, таймаут → 504 `timeout`, отмена → 499 `aborted`, HTTP 4xx/5xx → статус + код, безопасные сообщения (без stack/secrets).
- [x] Composable `useCommerce()` (`app/composables/useCommerce.ts`): runtimeConfig (SSR — `NUXT_MEDUSA_URL` внутренняя сеть, браузер — `NUXT_PUBLIC_MEDUSA_URL`), publishable key из публичного конфига, кэш инстанса на `nuxtApp` (один на запрос на сервере — без утечек между пользователями).
- [x] Composable `useStore()` (`app/composables/useStore.ts`): `storeName`, `locale`, `currency`, `region`, `regionId`, `regions`, `pending`, `error`, `initialize()` (идемпотентна, регион по умолчанию — по валюте магазина, без хардкода ID), `setRegion()`, `formatPrice()` (Intl.NumberFormat, суммы в основных единицах, без ÷100). Состояние — `useState` (payload), инициализация — `callOnce` в `app.vue`.
- [x] Утилиты витрины: `app/utils/format-price.ts` (перенос и адаптация `format.ts`), `app/utils/product-price.ts` (`resolveProductPrice` — приоритет calculated_price, fallback на сырые цены по валюте; `getProductPriceText` — «от X ₽»).
- [x] Компонент `ProductCard.vue`; демонстрационные страницы: главная (регион, валюта, товары), `/catalog` (пагинация `?page=N`, skeleton загрузки, состояния ошибки/пусто), `/product/[handle]` (варианты, характеристики, цены, 404 через `createError`).
- [x] Удален proxy-маршрут этапа 1 `storefront/server/api/products.get.ts` (его роль выполняет `useCommerce().products.list()`); `/api/health` сохранен (Docker health check). Новых Nitro-маршрутов не потребовалось.
- [x] Конфигурация: `runtimeConfig.public.{medusaUrl, medusaTimeoutMs}`; compose передает `NUXT_PUBLIC_MEDUSA_URL` (из `MEDUSA_PUBLIC_URL`) и `NUXT_PUBLIC_MEDUSA_TIMEOUT_MS` (по умолчанию 15000); `.env.example` дополнен опциональным `NUXT_PUBLIC_MEDUSA_TIMEOUT_MS`.
- [x] Автотесты: vitest 5.1.2; 31 unit (нормализация ошибок, логика фасада на моке fetch — заголовки/query/fields/таймаут/отмена/404, форматирование цен, разрешение цен товара, реальный timeout на висячем HTTP-сервере) + 20 интеграционных на живой Medusa (регионы, товары с calculated_price, by-handle, категории, коллекции, пагинация без пересечений, 404, недоступность backend 503, таймаут 504). Скрипты `pnpm test/test:unit/test:integration`, Makefile-цель `make test` (в Docker).
- [x] Документация: `docs/api.md` (полностью актуализирован по проверенным маршрутам, последовательности запросов витрины, исправлен код ошибки ключа), `docs/commerce-client.md` (новый), `docs/composables.md` (новый), ARCHITECTURE.md, README.md, configuration.md, ROADMAP.md, этот файл.

## Результаты фактических проверок (25.11.2026)

Окружение: macOS (Docker Desktop), Node 24.22.1, pnpm 12.23.0; стек поднят через `docker compose up -d --wait` (данные этапа 1 сохранены, seed не перезапускался — товары/админ/ключ на месте).

| # | Проверка | Результат |
|---|---|---|
| 1 | Инфраструктура этапа 1 работает после изменений (`make status`) | ✅ все 6 сервисов healthy, данные сохранены |
| 2 | `make lint` (medusa lint + eslint) | ✅ 0 проблем в обоих приложениях |
| 3 | `make typecheck` (tsc + vue-tsc, strict) | ✅ обе части; все замечания TS устранены в процессе |
| 4 | `make test` (vitest в контейнере storefront) | ✅ 5 файлов, 51 тест (31 unit + 20 integration) |
| 5 | Интеграционные сценарии на живой Medusa: регионы, регион по ID, 404 региона | ✅ |
| 6 | Товары: список, пагинация (страницы не пересекаются, count=10), товары по ID, по handle, null для несуществующего handle, 404 для несуществующего ID | ✅ |
| 7 | Рассчитанные цены: `region_id` → `calculated_price.calculated_amount` (число, валюта региона, основные единицы); без региона — отсутствуют | ✅ |
| 8 | Категории: список (3), по handle, по ID, нормализация 200-`{}` → 404, товары категории (`category_id`, count=3) | ✅ |
| 9 | Коллекции: список (200, пуст — seed этапа 1 коллекции не создает), 404 по ID | ✅ |
| 10 | Недоступность backend: соединение отвергнуто → `CommerceError` 503 `medusa_unreachable`; висячий адрес → 504 `timeout` | ✅ (интеграционно) |
| 11 | SSR-страницы (curl, полный HTML): `/` — 6 товаров с ценами («3 490 ₽») и регионом «Россия»; `/catalog` — «Всего товаров: 10 · Страница 1 из 2»; `/catalog?page=2` — вторая страница; `/product/futbolka-meduza` — варианты (8), артикулы, цены; `/product/takogo-net` — HTTP 404 | ✅ |
| 12 | Браузер (реальный Chromium): после hydration 0 запросов к Medusa (данные из SSR-payload); клиентская навигация → прямые запросы браузера к `localhost:9000` (CORS OK) с `region_id` и авто-`fields`; пагинация `/catalog?page=2` из браузера | ✅ |
| 13 | Деградация при недоступной Medusa (`docker compose stop medusa`): страницы отвечают 200 с понятными сообщениями об ошибках, без stack trace; после старта Medusa — 200 с данными | ✅ |
| 14 | Production-сборка storefront (`nuxt build` в контейнере) | ✅ client 390.27 kB (113.65 kB gzip), server/Nitro 2.25 MB |
| 15 | Отсутствие серверных секретов в клиентском bundle (grep по `.output/public`): `JWT_SECRET`, `COOKIE_SECRET`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `MEILISEARCH_MASTER_KEY`, внутренний URL `medusa:9000` — не найдены | ✅ |
| 16 | `make migrate`, `make seed` — не затронуты (backend не изменялся) | ✅ без изменений |

Ограничение: production-сборка выполнялась в одноразовом контейнере без тома `.output` (в dev-контейнере `.output` — точка монтирования анонимного тома, `nuxt build` получает EBUSY/EACCES при попытке пересоздать каталог). Сборка этапа 10 (production-режим compose) снимет это ограничение.

## Принятые решения этапа 2 (архитектурный журнал)

1. **Официальный Medusa JS SDK как транспорт** (`@medusajs/js-sdk@2.23.0`, версия = backend). Фасад вызывает публичный `sdk.client.fetch` с generics `HttpTypes` вместо сахарных методов `sdk.store.*`: typed-методы SDK не принимают `signal`/timeout, а требования этапа включают настраиваемый таймаут и отмену запросов. Фасад — «минимальная обертка»: base URL, publishable key, сериализация query и `FetchError` остаются на SDK.
2. **Таймаут/отмена на транспортном уровне**: каждый запрос получает `AbortSignal.timeout(timeoutMs)`; внешний `signal` объединяется через `AbortSignal.any` — отмена реальная, а не promise-race.
3. **Браузер → Medusa напрямую** (после hydration), SSR → внутренняя Docker-сеть. Стандартная схема storefront Medusa; исключает proxy-дублирование маршрутов; CORS уже настроен; publishable key и публичный URL не секреты.
4. **Регион по умолчанию без хардкода**: первый регион с валютой магазина (`STORE_CURRENCY`), иначе первый доступный — соответствует seed этапа 1 и масштабируется на мультирегиональность.
5. **`error` в `useStore` хранит сериализуемый снимок** `CommerceErrorData`, а не экземпляр Error — Error не сериализуется в Nuxt payload корректно.
6. **Авто-`fields` только для calculated_price** при переданном контексте ценообразования; все прочие query-параметры проходят из компонентов без магии (явность).
7. **Нормализация особенности Medusa 2.23**: `/store/product-categories/:id` возвращает 200 `{}` для несуществующей категории — клиент превращает это в честный 404 (`CommerceError`), инкапсулируя особенность от компонентов.
8. **Данные после hydration — из payload** (`useAsyncData` + `callOnce` + `useState`): повторных запросов нет (проверено в браузере по network).
9. **Пустых групп и заглушек нет**: cart/checkout/auth появятся вместе с соответствующими этапами; фабрика в `shared/` доступна и серверным Nitro-маршрутам, когда они понадобятся (cookies/сессии — этапы 6–7).
10. **Тесты**: unit — моки fetch только для логики самой обертки; контракт Medusa — исключительно интеграционные тесты на живом backend (`make test` в Docker с реальным publishable key).

## Известные проблемы (актуальные)

- `medusa develop` в контейнере логирует предупреждение vite о deprecated-формате `server.hmr.*` (vite 8) — не влияет на работу (унаследовано с этапа 1).
- Демо-изображения товаров хостятся в публичном S3 Medusa — при отсутствии интернета картинки не загрузятся (товары и цены работают) (унаследовано).
- `pnpm peers check` показывает предупреждения по eslint-плагинам из цепочки `@nuxt/eslint` (eslint 9.x против unicorn>=10) — существовало до этапа 2, не влияет на lint.
- Production-сборка в dev-контейнере невозможна из-за anon-volume на `.output` (см. ограничение выше); для проверки сборки этапа 2 использован одноразовый контейнер.

## Следующий этап

**Этап 3. Meilisearch, индексация, полнотекстовый поиск и фасетная фильтрация** — по ROADMAP.md. Вход в этап требует: актуальный этот файл, чистые `make lint`/`make typecheck`, рабочую витрину на реальных данных (все выполнено).

# Прогресс проекта

Дата обновления: 25 ноября 2026 г.

## Текущий этап

**Этап 2. Commerce API и типизированный API-клиент — завершен.**

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

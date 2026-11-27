# Commerce Client — типизированный API-клиент витрины

Единый механизм взаимодействия storefront с Medusa Store API (этап 2). Frontend-разработчик не формирует HTTP-запросы и заголовки вручную — он вызывает типизированные методы и получает официальные типы Medusa.

## Архитектура

```text
Vue Components / Pages
        |
        v
Composables (useCommerce, useStore)
        |
        v
Typed Commerce Client (shared/utils/commerce-client.ts)
        |
        v
Medusa JS SDK (@medusajs/js-sdk) — транспорт: publishable key, query, JSON, FetchError
        |
        v
Medusa Store API
  ├─ SSR (Nitro):   http://medusa:9000   — внутренняя Docker-сеть (NUXT_MEDUSA_URL)
  └─ Браузер:       http://localhost:9000 — публичный URL (NUXT_PUBLIC_MEDUSA_URL)
```

### Структура файлов

| Файл | Назначение |
|---|---|
| `storefront/shared/utils/commerce-client.ts` | Фабрика `createCommerceClient(options)` — фасад над Medusa JS SDK: группы методов, таймаут, отмена, нормализация ошибок, авто-поля цен |
| `storefront/shared/utils/commerce-error.ts` | `CommerceError` + `toCommerceError()` — единая нормализация ошибок; `serializeCommerceError()` — сериализуемый снимок для payload |
| `storefront/shared/types/commerce.ts` | Интерфейсы клиента: `CommerceClient`, параметры методов (`HttpTypes` + транспортные опции), `CommerceErrorData` |
| `storefront/app/composables/useCommerce.ts` | Nuxt-интеграция: runtimeConfig, кэш инстанса на nuxtApp |
| `storefront/app/composables/useStore.ts` | Публичный контекст магазина (регионы, валюта, цены) |

Код клиента лежит в `shared/`, поэтому он доступен и приложению, и серверу Nitro (для будущих серверных маршрутов, где нужны cookies/секреты — этапы 6–7). На этапе 2 серверные маршруты Nuxt не потребовались: клиент сам ходит в Medusa по внутренней сети (SSR) и по публичному URL (браузер).

## Подключение Medusa SDK

Транспорт — **официальный `@medusajs/js-sdk@2.23.0`** (версия совпадает с Medusa backend; зафиксирована в `storefront/package.json`). SDK берет на себя:

- добавление заголовка `x-publishable-api-key` ко всем запросам;
- сериализацию query-параметров (включая массивы `category_id[]`);
- парсинг JSON и `FetchError` с HTTP-статусом;
- заголовки `content-type`/`accept`.

Фасад добавляет то, чего в SDK нет: единый `CommerceError`, настраиваемый таймаут каждого запроса (реальный `AbortSignal.timeout`), отмена запроса (`AbortSignal` вызывающего) и автоматический запрос рассчитанных цен.

## Runtime configuration

`storefront/nuxt.config.ts`:

```ts
runtimeConfig: {
  medusaUrl: "http://localhost:9000",        // приватно: только SSR (NUXT_MEDUSA_URL)
  public: {
    medusaUrl: "http://localhost:9000",       // публично: браузер (NUXT_PUBLIC_MEDUSA_URL)
    medusaPublishableKey: "",                // NUXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    medusaTimeoutMs: 15_000,                 // NUXT_PUBLIC_MEDUSA_TIMEOUT_MS
    // ... siteUrl, storeName, storeLocale, storeCurrency
  },
}
```

Выбор URL в `useCommerce()`:

- **Серверный рендеринг (SSR)** — `runtimeConfig.medusaUrl`: внутренний адрес Docker-сети (`http://medusa:9000`). Никогда не передается браузеру.
- **Браузер** — `runtimeConfig.public.medusaUrl`: публичный адрес Medusa (`MEDUSA_PUBLIC_URL`). Publishable API key публичен по определению Medusa, серверные секреты (`JWT_SECRET`, `COOKIE_SECRET`, `ADMIN_PASSWORD`, пароли БД) в клиентский bundle не попадают (проверено по production-сборке).

Publishable key передается SDK через конструктор и попадает во **все** запросы автоматически — компоненты о нем не знают.

## Серверные и клиентские запросы

- **SSR**: `useAsyncData(...)` вызывает методы клиента внутри серверного рендера. Данные попадают в Nuxt payload и **не запрашиваются повторно после hydration**.
- **Клиентская навигация** (смена страницы каталога, региона): тот же метод вызывает Medusa из браузера по публичному URL. CORS для Store API уже настроен (`STORE_CORS`).
- **Nitro Server API** используется только там, где нужны серверные секреты/cookies/валидация. На этапе 2 это единственный маршрут `/api/health`; proxy-маршрут `/api/products` этапа 1 удален как дублирующий Medusa.

## Обработка ошибок

Любая ошибка нормализуется в `CommerceError` (`shared/utils/commerce-error.ts`):

```ts
interface CommerceErrorData {
  statusCode?: number   // HTTP-код (400/404/503/504...)
  code?: string         // not_found, bad_request, server_error, timeout,
                        // aborted, medusa_unreachable, unknown
  message: string       // безопасное пользовательское сообщение
}
```

| Ситуация | statusCode | code |
|---|---|---|
| HTTP 4xx от Medusa | как в ответе | `bad_request`, `not_found`, `unauthorized`… |
| HTTP 5xx от Medusa | 500+ | `server_error` (сообщение — безопасная заглушка, internals только в `details`) |
| Medusa недоступна (ECONNREFUSED, DNS) | 503 | `medusa_unreachable` |
| Таймаут (`AbortSignal.timeout`) | 504 | `timeout` |
| Отмена вызывающим кодом | 499 | `aborted` |
| Неизвестная ошибка | 500 | `unknown` |

Правила:

- сообщение для пользователя никогда не содержит stack trace, URL внутренней сети и секреты;
- при фактической ошибке API метод **всегда** бросает исключение — «молчаливых» пустых успехов нет (`getByHandle` возвращает `null` только для честного «не найдено»);
- автоматических повторов нет: идемпотентность повторов будущих не-GET операций требует отдельной стратегии;
- особенности Medusa нормализуются: 200 с пустым телом для несуществующей категории превращается в `CommerceError 404 not_found`.

## Региональный контекст и цены

- `useStore()` хранит текущий регион (`useState`, сериализуется в payload) и выбирает регион по умолчанию по валюте магазина (без хардкода ID).
- Методы `products.*` принимают официальный параметр `region_id` (или `country_code`/`cart_id`).
- Если контекст ценообразования передан, клиент автоматически добавляет `fields=+*variants.calculated_price` (дедупликация: не добавляет, если поле уже запрошено). Так компоненты получают рассчитанные цены вариантов без знания о внутреннем формате `fields` Medusa.
- Суммы — в основных единицах (1490 = 1490 ₽), форматирование — `Intl.NumberFormat` в `useStore().formatPrice()`; деление/умножение на 100 не используется.

## Таймаут и отмена

- Клиент создается с `timeoutMs` (по умолчанию 15 000, конфигурируется через `NUXT_PUBLIC_MEDUSA_TIMEOUT_MS`; `0` — отключить).
- Каждый запрос получает `AbortSignal.timeout(timeoutMs)`; вызов метода принимает `signal?: AbortSignal` — сигналы объединяются (`AbortSignal.any`), отмена работает на транспортном уровне.
- Таймаут можно переопределить per-request: `commerce.products.list({ timeoutMs: 30_000 })`.

## Интерфейс

```ts
const commerce = useCommerce()

// Товары
await commerce.products.list({
  limit: 24,
  offset: 0,
  region_id: regionId,           // включает calculated_price
  category_id: ["pcat_..."],     // фильтр по категориям
  order: "-created_at",
})
const { product } = await commerce.products.getById("prod_...")
const product = await commerce.products.getByHandle("futbolka-meduza") // StoreProduct | null

// Категории
await commerce.categories.list()
const { product_category } = await commerce.categories.getById("pcat_...")
const category = await commerce.categories.getByHandle("t-shirts")     // StoreProductCategory | null

// Коллекции
await commerce.collections.list()
const { collection } = await commerce.collections.getById("pcol_...")

// Регионы
await commerce.regions.list()
const { region } = await commerce.regions.getById("reg_...")

// Транспортные опции доступны в любом методе
await commerce.products.list({ signal: controller.signal, timeoutMs: 5_000 })
```

Типы ответов и параметров — официальные `HttpTypes` из `@medusajs/types@2.23.0` (совпадает с backend). Дублирования контрактов Medusa в витрине нет; собственные типы — только транспортные обертки (`signal`, `timeoutMs`, `headers`).

## Правила расширения

1. **Новые группы** добавляются в `CommerceClient` (интерфейс в `shared/types/commerce.ts`, реализация в `createCommerceClient`): `commerce.cart`, `commerce.auth`, `commerce.customer`, `commerce.orders` и т.д. — по мере выхода соответствующих этапов ROADMAP. Не создавать пустых групп-заглушек.
2. **Новый метод** = путь Medusa + официальный `HttpTypes` тип + `request()`-обертка (она уже дает таймаут/отмену/нормализацию ошибок). Например:
   ```ts
   // в createCommerceClient, группа cart (этап 9):
   create: (body, params = {}) => {
     const { init, timeoutMs, query } = splitOptions(params)
     return request<HttpTypes.StoreCartResponse>("/store/carts", { ...init, method: "POST", body, query }, timeoutMs)
   }
   ```
3. **Авторизационный контекст** (этапы 5/9): SDK уже поддерживает JWT/session (`Medusa` constructor `auth`-опции); при появлении пользовательских сессий инстанс клиента останется прежним, добавится управление токеном (серверные cookies — через Nitro-маршруты, которые импортируют ту же фабрику из `shared/`).
4. **Никаких** собственных repository/factory/adapter-слоев поверх фасада: один фасад, один транспорт.
5. Изменение контракта любого маршрута — обновить `docs/api.md` в том же изменении.

## Ограничения этапа 2

- Поиск, фасетная фильтрация, Meilisearch — этап 3.
- Корзина/checkout/авторизация — этапы 6–7; соответствующих методов в клиенте **нет** (нет и заглушек).
- Клиентский инстанс не содержит пользовательского состояния: на сервере он кэшируется на один запрос (nuxtApp), в браузере — один на приложение.

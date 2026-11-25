# Composables витрины

Документация composables storefront (этап 2). Общие принципы:

- все composables SSR-совместимы: состояние — через `useState` (сериализуется в payload), никаких глобальных синглтонов с пользовательским состоянием;
- серверные секреты не используются; браузеру доступны только `runtimeConfig.public` и publishable API key;
- composables не зависят от UI-библиотек.

---

## useCommerce()

**Файл**: `storefront/app/composables/useCommerce.ts`

**Назначение**: единая точка доступа к типизированному Commerce Client (транспортный и интеграционный слой). Не содержит данных каталога, корзины или авторизации.

**Входные параметры**: нет.

**Возвращаемое значение**: `CommerceClient` (см. [docs/commerce-client.md](commerce-client.md)):

```ts
{
  products: {
    list(params?: CommerceProductListParams): Promise<HttpTypes.StoreProductListResponse>
    getById(id: string, params?: CommerceProductParams): Promise<HttpTypes.StoreProductResponse>
    getByHandle(handle: string, params?: CommerceProductParams): Promise<HttpTypes.StoreProduct | null>
  }
  categories: {
    list(params?): Promise<HttpTypes.StoreProductCategoryListResponse>
    getById(id, params?): Promise<HttpTypes.StoreProductCategoryResponse>
    getByHandle(handle, params?): Promise<HttpTypes.StoreProductCategory | null>
  }
  collections: {
    list(params?): Promise<HttpTypes.StoreCollectionListResponse>
    getById(id, params?): Promise<HttpTypes.StoreCollectionResponse>
  }
  regions: {
    list(params?): Promise<HttpTypes.StoreRegionListResponse>
    getById(id, params?): Promise<HttpTypes.StoreRegionResponse>
  }
}
```

**Используемые API-маршруты** (Medusa Store API): `/store/products`, `/store/products/:id`, `/store/product-categories`, `/store/product-categories/:id`, `/store/collections`, `/store/collections/:id`, `/store/regions`, `/store/regions/:id` — см. [docs/api.md](api.md).

### Параметры методов

Параметры каждого метода = официальные query-параметры Store API (типы `HttpTypes` из `@medusajs/types`) + транспортные опции:

| Опция | Тип | Описание |
|---|---|---|
| `signal` | `AbortSignal` | Отмена запроса вызывающим кодом |
| `timeoutMs` | `number` | Таймаут запроса; `0` — отключить |
| `headers` | `Record<string, string>` | Дополнительные заголовки |

Примеры query-параметров `products.list`: `limit`, `offset`, `order`, `handle`, `category_id`, `q`, `region_id`, `country_code`, `cart_id`, `fields`.

### TypeScript-типы

```ts
import type { CommerceClient } from "#shared/types/commerce"
import type { HttpTypes } from "@medusajs/types"

const commerce: CommerceClient = useCommerce()
const response: HttpTypes.StoreProductListResponse = await commerce.products.list({ limit: 6 })
const product: HttpTypes.StoreProduct | null = await commerce.products.getByHandle("hudi-polyarnoe")
```

### Особенности SSR

- Инстанс клиента кэшируется на `nuxtApp`: на сервере — один на запрос (нет утечек между пользователями), в браузере — один на приложение (пользовательского состояния нет).
- Серверные запросы идут по `runtimeConfig.medusaUrl` (внутренняя Docker-сеть), браузерные — по `runtimeConfig.public.medusaUrl`.
- Publishable API key добавляется SDK автоматически.

### Обработка ошибок

Любая ошибка методов — `CommerceError` (`name: "CommerceError"`, поля `statusCode`, `code`, `message`, `details`). Нормализация сетевых ошибок, таймаутов, HTTP-кодов и особенностей Medusa — внутри клиента (см. [commerce-client.md](commerce-client.md#обработка-ошибок)).

### Примеры

```vue
<script setup lang="ts">
import type { HttpTypes } from "@medusajs/types"

const commerce = useCommerce()

// Список товаров с рассчитанными ценами региона
const { data } = await useAsyncData(
  "products",
  () => commerce.products.list({ limit: 12, region_id: "reg_..." }),
)

// Товар по handle: null = не найден
const product = await commerce.products.getByHandle("futbolka-meduza")
</script>
```

---

## useStore()

**Файл**: `storefront/app/composables/useStore.ts`

**Назначение**: публичный контекст магазина — название, локаль, доступные регионы, текущий регион, валюта, форматирование цен. Предоставляет региональный контекст другим composables и страницам.

**Входные параметры**: нет.

**Возвращаемое значение** (`UseStoreReturn`):

| Свойство/метод | Тип | Описание |
|---|---|---|
| `storeName` | `ComputedRef<string>` | Название магазина (`runtimeConfig.public.storeName`) |
| `locale` | `ComputedRef<string>` | Локаль витрины (`storeLocale`, напр. `ru-RU`) |
| `currency` | `ComputedRef<string>` | Валюта текущего региона, fallback — `storeCurrency` |
| `region` | `ComputedRef<HttpTypes.StoreRegion \| null>` | Полный объект текущего региона |
| `regionId` | `Ref<string \| null>` | ID текущего региона |
| `regions` | `Ref<HttpTypes.StoreRegion[]>` | Все доступные регионы (после `initialize`) |
| `pending` | `Ref<boolean>` | Идет загрузка регионов |
| `error` | `Ref<CommerceErrorData \| null>` | Сериализуемый снимок ошибки инициализации |
| `initialize()` | `() => Promise<void>` | Загрузка регионов и выбор региона по умолчанию (идемпотентна) |
| `setRegion(id)` | `(regionId: string) => void` | Переключение текущего региона (только на существующий) |
| `formatPrice(amount, currencyCode?)` | `(amount: CommerceMoneyAmount \| null \| undefined, currencyCode?: string) => string` | Форматирование суммы Medusa через `Intl.NumberFormat` |

**Используемые API-маршруты**: `GET /store/regions` через `useCommerce().regions.list()`.

### Методы

**`initialize()`** — вызывается один раз в `app.vue` через `callOnce("store:initialize", ...)`:

- запрашивает регионы, сохраняет в `useState` (сериализуется в payload — повторного запроса после hydration нет);
- выбирает регион по умолчанию: сначала регион с валютой магазина (`storeCurrency`), иначе первый доступный. Идентификаторы регионов не хардкодятся;
- идемпотентен: повторный вызов при загруженных регионах — no-op;
- при ошибке записывает снимок в `error` (успешный результат при ошибке не возвращается).

**`setRegion(regionId)`** — переключает регион только на существующий ID; после переключения зависимые `useAsyncData` (с `watch: [regionId]`) перезапрашивают данные, цены пересчитываются.

**`formatPrice(amount, currencyCode?)`** — форматирует сумму в валюте текущего региона (или явно переданной). Суммы Medusa — основные единицы (1490 = 1490 ₽); `Intl.NumberFormat` с локалью `locale`; для целых сумм дробная часть не выводится; `null`/`undefined`/нечисло → «Цена не указана».

### TypeScript-типы

```ts
import type { HttpTypes } from "@medusajs/types"
import type { CommerceErrorData, CommerceMoneyAmount } from "#shared/types/commerce"

const {
  storeName,                      // ComputedRef<string>
  region,                         // ComputedRef<HttpTypes.StoreRegion | null>
  regionId,                       // Ref<string | null>
  regions,                        // Ref<HttpTypes.StoreRegion[]>
  pending,                        // Ref<boolean>
  error,                          // Ref<CommerceErrorData | null>
  initialize,                     // () => Promise<void>
  setRegion,                      // (id: string) => void
  formatPrice,                    // (amount: CommerceMoneyAmount | null | undefined, currencyCode?: string) => string
} = useStore()
```

### Особенности SSR

- Состояние (`regions`, `regionId`, `pending`, `error`) — `useState`: на сервере изолировано по запросу, после hydration восстановлено из payload без повторного запроса.
- `error` хранит сериализуемый снимок `CommerceErrorData` (не экземпляр Error) — безопасно передается через payload.

### Обработка ошибок

Ошибка загрузки регионов фиксируется в `error.value` и НЕ прерывает рендер: страницы продолжают работу без регионального контекста (цены не рассчитываются, выводится деградированный UI). Сообщение безопасно для пользователя.

### Примеры

```vue
<script setup lang="ts">
// app.vue — инициализация один раз за цикл SSR→hydration
const store = useStore()
await callOnce("store:initialize", () => store.initialize())
</script>
```

```vue
<script setup lang="ts">
// catalog.vue — региональный контекст для запроса товаров
const { regionId, currency, formatPrice } = useStore()
const commerce = useCommerce()

const { data } = await useAsyncData(
  "catalog-products",
  () => commerce.products.list({
    limit: 6,
    offset: 0,
    region_id: regionId.value ?? undefined, // рассчитанные цены
  }),
  { watch: [regionId] },                     // смена региона → перезапрос
)

const priceText = (product) => getProductPriceText(product, formatPrice, currency.value)
</script>
```

```vue
<script setup lang="ts">
// Вспомогательное: цена товара (app/utils/product-price.ts)
import type { HttpTypes } from "@medusajs/types"

const price = resolveProductPrice(product) // { minAmount, maxAmount, currencyCode }
const text = formatPrice(price.minAmount, price.currencyCode) // "1 490 ₽"
</script>
```

---

## Вспомогательные утилиты (auto-import из `app/utils`)

| Функция | Файл | Назначение |
|---|---|---|
| `formatPrice(amount, currency, locale)` | `app/utils/format-price.ts` | Форматирование суммы Medusa через `Intl.NumberFormat` |
| `resolveProductPrice(product, fallbackCurrency?)` | `app/utils/product-price.ts` | Разрешение цены: `calculated_price` → сырые `prices` по валюте → null |
| `getProductPriceText(product, formatPrice, currency)` | `app/utils/product-price.ts` | Готовый текст цены: «1 490 ₽» / «от 1 490 ₽» / «Цена не указана» |

# Справочник API

Актуально для **Medusa v2.23.0** (зафиксирована в `backend/package.json`) и **Commerce Client** витрины (этап 2).

Перечислены только маршруты, которые **реально используются или проверены** на текущем этапе. Документ расширяется после реализации каждого модуля — актуальная документация API является критерием приемки этапа.

Базовый URL в примерах: `http://localhost:9000` (переменная `MEDUSA_PUBLIC_URL`).

Официальная документация Store API: <https://docs.medusajs.com/api/store>

---

## Содержание

- [Общие сведения](#общие-сведения)
  - [Publishable API key](#publishable-api-key)
  - [Формат сумм](#формат-сумм)
  - [Выбор полей ответа (fields)](#выбор-полей-ответа-fields)
  - [Пагинация](#пагинация)
  - [Контракт ошибок Medusa](#контракт-ошибок-medusa)
- [Товары](#товары)
  - [Список товаров](#1-список-товаров)
  - [Товар по ID](#2-товар-по-id)
  - [Товар по handle](#3-товар-по-handle)
  - [Рассчитанные цены в контексте региона](#рассчитанные-цены-в-контексте-региона)
- [Категории](#категории)
  - [Список категорий](#4-список-категорий)
  - [Категория по ID](#5-категория-по-id)
  - [Категория по handle и дерево категорий](#категория-по-handle-и-дерево-категорий)
  - [Товары категории](#товары-категории)
- [Коллекции](#коллекции)
  - [Список коллекций](#6-список-коллекций)
  - [Коллекция по ID](#7-коллекция-по-id)
- [Каталог и поиск (Meilisearch, этап 3)](#каталог-и-поиск-meilisearch-этап-3)
  - [12. Каталог с фасетами](#12-каталог-с-фасетами)
  - [13. Полнотекстовый поиск](#13-полнотекстовый-поиск)
  - [14. Поисковые подсказки](#14-поисковые-подсказки)
- [Регионы](#регионы)
  - [Список регионов](#8-список-регионов)
  - [Регион по ID](#9-регион-по-id)
- [Nuxt Server API](#nuxt-server-api)
  - [Health check витрины](#10-health-check-витрины)
- [Справочно: аутентификация администратора](#11-аутентификация-администратора-справочно)
- [Последовательности запросов витрины](#последовательности-запросов-витрины)
- [Что будет добавлено на следующих этапах](#что-будет-добавлено-на-следующих-этапах)

---

## Общие сведения

### Publishable API key

Все маршруты `/store/*` требуют заголовок `x-publishable-api-key`. Ключ создается автоматически при инициализации (`make init`) и записывается в корневой `.env` как `MEDUSA_PUBLISHABLE_KEY`.

Ключ **публичен по определению Medusa** — это идентификатор канала продаж, а не секрет; он передается и серверу, и браузеру витрины. Commerce Client добавляет заголовок ко всем запросам автоматически.

**Без ключа или с недействительным ключом Medusa отвечает `400` (не 401):**

```json
HTTP 400
{"type":"not_allowed","message":"Publishable API key required in the request header: x-publishable-api-key. You can manage your keys in settings in the dashboard."}
```

> Примечание: в документации этапа 1 ошибочно указывался код 401. Проверено на Medusa 2.23: фактический код — **400**.

### Формат сумм

Medusa хранит и возвращает суммы в **основных денежных единицах**: `1490` = 1490 ₽ (не в копейках). Подтверждено официальным линт-правилом `prices-in-major-units` и реальными ответами API.

- `calculated_price.calculated_amount` — число (`number`).
- `prices[].amount` — обычно число; для BigNumber-значений Medusa дополнительно возвращает `raw_amount.value` строкой. Компоненты витрины приводят суммы через `Number(...)`.
- Витрина форматирует суммы через `Intl.NumberFormat` (`useStore().formatPrice`). Деление/умножение на 100 **не выполняется**.

### Выбор полей ответа (fields)

Параметр `fields` выбирает поля и связи (через запятую). Префикс `+` **добавляет** связь к значениям по умолчанию; без префикса — заменяет набор полей; `*` — все поля связи.

Дефолтный ответ `GET /store/products` уже включает: `variants` (с `options`), `options` (с `values`), `images`, `tags`, `type`, `collection`. Цены при этом **не входят** в дефолт — их нужно запросить явно:

- `+*variants.calculated_price` — рассчитанные цены (требуется региональный контекст, см. ниже);
- `+*variants.prices` — сырые ценовые записи.

Commerce Client автоматически добавляет `+*variants.calculated_price`, если в параметрах передан `region_id` / `country_code` / `cart_id` и поле еще не запрошено явно.

### Пагинация

Все списковые маршруты Medusa используют `limit` + `offset` (не постраничную нумерацию) и возвращают метаданные:

```json
{ "count": 10, "limit": 6, "offset": 0 }
```

`count` — общее число записей, доступных по ключу. Витрина переводит номер страницы в `offset`: `offset = (page - 1) * limit` (страница каталога `/catalog?page=2` → `limit=6&offset=6`).

### Контракт ошибок Medusa

Формат тела ошибки: `{ "type": "...", "message": "..." }`. Проверенные типы:

| HTTP | `type` | Когда возникает |
|---|---|---|
| 400 | `not_allowed` | Отсутствует/недействителен publishable API key |
| 400 | `invalid_data` | Неверный тип query-параметра (например, `limit=abc`) |
| 404 | `not_found` | Ресурс не существует или не виден через ключ |
| 5xx | — | Внутренняя ошибка backend (тело не детерминировано) |

Commerce Client нормализует любые ошибки к `CommerceError` (`statusCode`, `code`, `message`) — см. [docs/commerce-client.md](commerce-client.md).

---

## Товары

Официальная документация: [List Products](https://docs.medusajs.com/api/store/products/list-products), [Get Product](https://docs.medusajs.com/api/store/products/get-product).

### 1. Список товаров

| | |
|---|---|
| **Назначение** | Список опубликованных товаров канала продаж: главная, каталог, пагинация, фильтры по категории/handle |
| **Метод** | `GET` |
| **URL** | `/store/products` |
| **Принадлежность** | Medusa Store API (вызывается Commerce Client напрямую: сервер SSR — по внутренней сети, браузер — по публичному URL) |
| **Авторизация** | Publishable API key (заголовок, без пользовательской авторизации) |
| **Заголовки** | `x-publishable-api-key: <MEDUSA_PUBLISHABLE_KEY>` |
| **Commerce Client** | `useCommerce().products.list(params)` |

#### Path parameters

Нет.

#### Query parameters (проверенные)

| Параметр | Тип | Описание |
|---|---|---|
| `limit` | `number` | Максимум товаров в ответе (по умолчанию 50) |
| `offset` | `number` | Сколько товаров пропустить (пагинация) |
| `order` | `string` | Сортировка, например `-created_at` |
| `handle` | `string` | Фильтр по handle товара (используется для получения товара по handle) |
| `category_id` | `string[]` | Фильтр по категориям (товары категории) |
| `q` | `string` | Поиск по названию/описанию |
| `region_id` | `string` | Контекст ценообразования: включает `calculated_price` вариантов в валюте региона |
| `country_code` | `string` | Альтернативный контекст ценообразования (наследует регион по стране) |
| `cart_id` | `string` | Контекст ценообразования из корзины |
| `fields` | `string` | Выбор полей/связей (см. выше) |

Полный официальный список фильтров: [StoreProductListParams](https://docs.medusajs.com/api/store/products/list-products#body-parameters).

#### Пример curl

```bash
curl "http://localhost:9000/store/products?limit=2&order=-created_at&region_id=reg_01M87JXH28ZWDP5S4FJTY79RPF&fields=+*variants.calculated_price" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

#### Пример ответа (200 OK)

Фрагмент реального ответа (сокращено; идентификаторы будут отличаться):

```json
{
  "products": [
    {
      "id": "prod_01M87JXH5R6WX9T1HH0G6DG3EA",
      "title": "Худи «Полярное»",
      "handle": "hudi-polyarnoe",
      "is_giftcard": false,
      "discountable": true,
      "thumbnail": null,
      "options": [
        {
          "id": "opt_01M87JXH5AY0YKZM1281ECE836",
          "title": "Размер",
          "values": [
            { "id": "optval_01M87JXH5A8ZH2X8HJMMJT3PFF", "value": "L" },
            { "id": "optval_01M87JXH5AVR58BJENV1JBCAXT", "value": "M" },
            { "id": "optval_01M87JXH5AZWJ6NY17PP081JY0", "value": "OS" },
            { "id": "optval_01M87JXH5AMXV3ZMG1AXMVNVMK", "value": "S" },
            { "id": "optval_01M87JXH5AAKCK9D76VX31PETT", "value": "XL" }
          ]
        }
      ],
      "images": [],
      "variants": [
        {
          "id": "variant_01M87JXH78C4ESGHPEMMCBHZWA",
          "title": "L",
          "sku": "HOODIE-POL-L",
          "manage_inventory": true,
          "options": [
            { "id": "optval_01M87JXH5A8ZH2X8HJMMJT3PFF", "value": "L", "option_id": "opt_01M87JXH5AY0YKZM1281ECE836" }
          ],
          "calculated_price": {
            "id": "pset_01M87JXH8GNDV16W63BSC3QC40",
            "is_calculated_price_price_list": false,
            "calculated_amount": 4590,
            "original_amount": 4590,
            "currency_code": "rub"
          }
        }
      ],
      "created_at": "2026-11-24T20:10:52.991Z",
      "updated_at": "2026-11-24T20:10:52.991Z"
    }
  ],
  "count": 10,
  "offset": 0,
  "limit": 2
}
```

Без `region_id` поле `calculated_price` у вариантов **отсутствует**.

#### Возможные HTTP-коды

| Код | Причина |
|---|---|
| 200 | Успех (в т.ч. пустой результат) |
| 400 `not_allowed` | Проблема с publishable API key |
| 400 `invalid_data` | Неверный тип параметра (например, `limit=abc`) |

#### Пример ошибки

```json
HTTP 400
{"type":"invalid_data","message":"Invalid request: Expected type: 'number' for field 'limit', got: 'abc'"}
```

---

### 2. Товар по ID

| | |
|---|---|
| **Назначение** | Карточка товара по внутреннему ID |
| **Метод** | `GET` |
| **URL** | `/store/products/{id}` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |
| **Заголовки** | `x-publishable-api-key: <MEDUSA_PUBLISHABLE_KEY>` |
| **Commerce Client** | `useCommerce().products.getById(id, params)` |

#### Path parameters

| Параметр | Тип | Описание |
|---|---|---|
| `id` | `string` | ID товара (`prod_...`) |

#### Query parameters

Те же, что у списка: `region_id` / `country_code` / `cart_id` (контекст цен), `fields`.

#### Пример curl

```bash
curl "http://localhost:9000/store/products/prod_01M87JXH5R6WX9T1HH0G6DG3EA?region_id=reg_01M87JXH28ZWDP5S4FJTY79RPF&fields=+*variants.calculated_price" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

#### Пример ответа (200 OK)

```json
{
  "product": {
    "id": "prod_01M87JXH5R6WX9T1HH0G6DG3EA",
    "title": "Худи «Полярное»",
    "description": "Утепленное худи для холодного сезона. Высокий ворот, плотный трикотаж.",
    "handle": "hudi-polyarnoe",
    "variants": [
      {
        "id": "variant_01M87JXH78C4ESGHPEMMCBHZWA",
        "title": "L",
        "sku": "HOODIE-POL-L",
        "calculated_price": {
          "calculated_amount": 4590,
          "original_amount": 4590,
          "currency_code": "rub"
        }
      }
    ]
  }
}
```

#### Возможные HTTP-коды

| Код | Причина |
|---|---|
| 200 | Успех |
| 400 `not_allowed` | Проблема с publishable API key |
| 404 `not_found` | Товар не существует или не виден через ключ |

#### Пример ошибки

```json
HTTP 404
{"type":"not_found","message":"Product with id: prod_nonexistent was not found"}
```

Commerce Client нормализует это в `CommerceError { statusCode: 404, code: "not_found" }`.

---

### 3. Товар по handle

Отдельного маршрута «по handle» в Store API нет — используется **штатный фильтр** `handle` маршрутa «Список товаров». Commerce Client инкапсулирует это в `products.getByHandle(handle)` (запрос `limit=1`, первый элемент или `null`).

```bash
curl "http://localhost:9000/store/products?handle=futbolka-meduza&region_id=reg_01M87JXH28ZWDP5S4FJTY79RPF&fields=+*variants.calculated_price" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Ответ — стандартный список; `count: 1` при существующем handle, `count: 0, products: []` — при отсутствии (HTTP 200, не 404). Страница товара витрины (`/product/:handle`) превращает `null` в 404 Nuxt.

### Рассчитанные цены в контексте региона

Проверено на Medusa 2.23: при передаче `region_id` и запросе `fields=+*variants.calculated_price` каждый вариант содержит `calculated_price`:

| Поле | Тип | Описание |
|---|---|---|
| `calculated_price.calculated_amount` | `number` | Итоговая цена варианта в основных единицах |
| `calculated_price.original_amount` | `number` | Цена до применения price list |
| `calculated_price.currency_code` | `string` | Валюта региона (`rub`) |
| `calculated_price.is_calculated_price_price_list` | `boolean` | Цена из price list |
| `calculated_price.raw_calculated_amount.value` | `string` | BigNumber-сырое значение |

Без регионального контекста (`region_id` / `country_code` / `cart_id`) поле `calculated_price` не возвращается. Альтернатива без региона — сырые записи `fields=+*variants.prices` (все цены всех валют варианта).

---

## Категории

Официальная документация: [List Product Categories](https://docs.medusajs.com/api/store/product-categories/list-product-categories), [Get Product Category](https://docs.medusajs.com/api/store/product-categories/get-a-product-category).

### 4. Список категорий

| | |
|---|---|
| **Назначение** | Категории каталога (навигация, каталог по категориям — этап 5) |
| **Метод** | `GET` |
| **URL** | `/store/product-categories` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |
| **Заголовки** | `x-publishable-api-key: <MEDUSA_PUBLISHABLE_KEY>` |
| **Commerce Client** | `useCommerce().categories.list(params)` / `categories.getByHandle(handle)` |

#### Path parameters

Нет.

#### Query parameters (проверенные)

| Параметр | Тип | Описание |
|---|---|---|
| `limit` / `offset` | `number` | Пагинация |
| `handle` | `string` | Фильтр по handle категории (используется `getByHandle`) |
| `parent_category_id` | `string` | Фильтр по родительской категории (обход дерева) |
| `fields` | `string` | Выбор полей/связей, например `+parent_category,+category_children` |

#### Пример curl

```bash
curl "http://localhost:9000/store/product-categories?limit=5" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

#### Пример ответа (200 OK)

Реальный ответ (сокращено):

```json
{
  "product_categories": [
    {
      "id": "pcat_01M87JXH52XRX3DV0D5SWRZR25",
      "name": "Футболки",
      "description": "",
      "handle": "t-shirts",
      "rank": 0,
      "external_id": null,
      "parent_category_id": null,
      "metadata": null,
      "parent_category": null,
      "category_children": []
    },
    {
      "id": "pcat_01M87JXH53E6DJXF589Y7AP3JE",
      "name": "Худи и свитшоты",
      "handle": "hoodies",
      "rank": 1
    },
    {
      "id": "pcat_01M87JXH53KD998NHJQB3P64T2",
      "name": "Аксессуары",
      "handle": "accessories",
      "rank": 2
    }
  ],
  "count": 3,
  "offset": 0,
  "limit": 5
}
```

#### Возможные HTTP-коды

| Код | Причина |
|---|---|
| 200 | Успех |
| 400 `not_allowed` | Проблема с publishable API key |

### 5. Категория по ID

| | |
|---|---|
| **Назначение** | Отдельная категория |
| **Метод** | `GET` |
| **URL** | `/store/product-categories/{id}` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |
| **Commerce Client** | `useCommerce().categories.getById(id)` |

```bash
curl "http://localhost:9000/store/product-categories/pcat_01M87JXH52XRX3DV0D5SWRZR25" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Реальный ответ (сокращено):

```json
{
  "product_category": {
    "id": "pcat_01M87JXH52XRX3DV0D5SWRZR25",
    "name": "Футболки",
    "handle": "t-shirts",
    "rank": 0,
    "external_id": null,
    "parent_category_id": null,
    "parent_category": null,
    "category_children": []
  }
}
```

#### ⚠ Особенность Medusa 2.23 (проверено)

Для **несуществующей** категории маршрут возвращает **200 с пустым объектом** `{}` вместо 404:

```json
HTTP 200
{}
```

Commerce Client нормализует это в `CommerceError { statusCode: 404, code: "not_found" }` — вызывающий код получает честную ошибку.

### Категория по handle и дерево категорий

- **По handle**: штатный фильтр `?handle=t-shirts` списка категорий → `count: 1` (или 0). Инкапсулировано в `categories.getByHandle()` (первый элемент или `null`).
- **Дерево**: список возвращает `parent_category_id` / `parent_category` / `category_children`; вложенность фильтруется через `parent_category_id` и запрашивается через `fields`. В демо-данных этапа 1 дерево плоское (3 корневые категории, `category_children: []`).

### Товары категории

Штатный фильтр `category_id` маршрута «Список товаров»:

```bash
curl "http://localhost:9000/store/products?limit=5&category_id=pcat_01M87JXH52XRX3DV0D5SWRZR25" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Проверено: для категории «Футболки» возвращается `count: 3` (`futbolka-prostaya`, `futbolka-meduza`, `futbolka-kraken`). Commerce Client: `products.list({ category_id })`.

---

## Коллекции

Официальная документация: [List Collections](https://docs.medusajs.com/api/store/collections/list-collections), [Get Collection](https://docs.medusajs.com/api/store/collections/get-a-collection).

### 6. Список коллекций

| | |
|---|---|
| **Назначение** | Список коллекций товаров |
| **Метод** | `GET` |
| **URL** | `/store/collections` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |
| **Commerce Client** | `useCommerce().collections.list(params)` |

Query parameters: `limit` / `offset`, `handle`, `q`, `fields` (официальные).

```bash
curl "http://localhost:9000/store/collections?limit=10" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Реальный ответ (после seed этапа 1 коллекции не создаются — маршрут проверен на живом API):

```json
{
  "collections": [],
  "count": 0,
  "offset": 0,
  "limit": 10
}
```

Возможные коды: 200; 400 `not_allowed`.

### 7. Коллекция по ID

| | |
|---|---|
| **Назначение** | Отдельная коллекция |
| **Метод** | `GET` |
| **URL** | `/store/collections/{id}` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |
| **Commerce Client** | `useCommerce().collections.getById(id)` |

```bash
curl "http://localhost:9000/store/collections/pcol_nonexistent" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Проверенный контракт ошибок (в отличие от категорий — корректный 404):

```json
HTTP 404
{"type":"not_found","message":"Collection with id: pcol_nonexistent was not found"}
```

---

## Каталог и поиск (Meilisearch, этап 3)

Поисковые маршруты каталога поверх Meilisearch через официальный Search Module Medusa (структура индекса, региональные цены и вариант-ориентированная фильтрация — см. [docs/search.md](search.md) по мере готовности; модель индекса — [docs/ARCHITECTURE.md](ARCHITECTURE.md)).

Контракт ответа един для каталога и поиска: `{products, pagination, facets, sortOptions}`. TypeScript-контракты — `backend/src/types/catalog.ts`. Этап 3 в разработке: Admin API характеристик, тесты и полная документация добавляются по ходу этапа.

Ключевые свойства (проверено на живых данных 26.11.2026):

- Счетчики фасетов — **точное число уникальных товаров** (не вариантов): фасет `brand` на всем каталоге суммируется ровно в `pagination.total`.
- Фильтрация **вариант-ориентированная**: значения, определенные покупаемым вариантом (цвет/размер из штатных опций Medusa), фильтруются по одному варианту. Пример (критический сценарий): у футболки «Медуза» вариант Чёрный/M отсутствует, а Чёрный/S и Белый/M — в наличии; фильтр `color=Чёрный AND size=M AND in_stock=true` не находит этот товар.
- Логика фильтров: между разными характеристиками — AND, между значениями одной характеристики — OR (`filter[brand]=deep-sea,urban-basic` — товары любого из брендов).
- Счетчики фасетов disjunctive: считаются с учетом остальных фильтров, но без фильтра самого фасета; выбранные значения остаются в списке для снятия фильтра.
- Валюта и канал продаж определяются на backend: регион проверяется по модулю Region, канал — из контекста publishable API key, статус — всегда `published`.

### 12. Каталог с фасетами

| | |
|---|---|
| **Назначение** | Каталог: товары + фасеты + точная пагинация одним запросом |
| **Метод** | `GET` |
| **URL** | `/store/catalog` |
| **Авторизация** | Publishable API key |
| **Заголовки** | `x-publishable-api-key: <MEDUSA_PUBLISHABLE_KEY>` |

#### Query parameters

| Параметр | Тип | Описание |
|---|---|---|
| `q` | `string` | Полнотекстовый запрос (необязателен для каталога) |
| `category` | `string` | Хэндл категории |
| `collection` | `string` | Хэндл коллекции |
| `region_id` | `string` | Регион ценообразования; без него — регион по умолчанию (валюта магазина) |
| `filter[code]` | `string` | Значения характеристики через запятую: `filter[brand]=deep-sea,urban-basic`. Коды — из реестра характеристик; неизвестный код → 400 |
| `price_min` / `price_max` | `number` | Диапазон цен в валюте региона (основные единицы) |
| `in_stock` | `boolean` | Фильтр по наличию: `true` — есть хотя бы один вариант в наличии; `false` — есть хотя бы один отсутствующий вариант (согласовано со счетчиком фасета) |
| `sort` | `string` | `relevance` (по умолчанию), `price_asc`, `price_desc`, `newest`, `title_asc` |
| `limit` / `offset` | `number` | Пагинация (`limit` 1–100, по умолчанию 24) |

#### Пример curl

```bash
curl "http://localhost:9000/store/catalog?filter%5Bbrand%5D=deep-sea,urban-basic&limit=6" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

#### Пример ответа (200 OK, реальные данные, сокращено)

```json
{
  "products": [
    {
      "id": "prod_01M87JXH5R6WX9T1HH0G6DG3EA",
      "variant_id": "variant_01M87JXH78C4ESGHPEMMCBHZWA",
      "title": "Худи «Полярное»",
      "handle": "hudi-polyarnoe",
      "sku": "HOODIE-POL-L",
      "price": { "amount": 4590, "currency_code": "rub" },
      "in_stock": true,
      "category_handles": ["hoodies"],
      "collection_handles": ["eko"],
      "attributes": { "brand": "north-polar", "material": ["cotton", "polyester"], "rating": 4.7, "eco": true, "size": "L" }
    }
  ],
  "pagination": { "total": 12, "limit": 2, "offset": 0, "hasMore": true },
  "facets": [
    { "code": "price", "label": "Цена", "type": "range", "unit": "RUB", "min": 390, "max": 4590 },
    { "code": "in_stock", "label": "Наличие", "type": "boolean", "options": [
      { "value": "true", "label": "В наличии", "count": 10, "selected": false },
      { "value": "false", "label": "Нет в наличии", "count": 4, "selected": false }
    ]},
    { "code": "brand", "label": "Бренд", "type": "checkbox", "options": [
      { "value": "medusa-originals", "label": "Medusa Originals", "count": 4, "selected": false },
      { "value": "deep-sea", "label": "Deep Sea", "count": 3, "selected": false }
    ]}
  ],
  "sortOptions": ["relevance", "price_asc", "price_desc", "newest", "title_asc"]
}
```

`id` — ID товара (выдача сгруппирована по товарам, `variant_id` — вариант-представитель). Карточка товара и checkout обязаны использовать штатный `/store/products` с рассчитанными ценами: поисковый документ — производная проекция, не источник истины.

#### Возможные HTTP-коды

| Код | Причина |
|---|---|
| 200 | Успех (в т.ч. пустая выдача) |
| 400 `invalid_query` | Некорректные параметры (неизвестная характеристика в фильтре, `limit=abc`, неизвестный регион и т.п.) |
| 503 `search_unavailable` | Meilisearch недоступен |
| 500 | Внутренняя ошибка (логируется) |

### 13. Полнотекстовый поиск

`GET /store/search` — тот же контракт ответа, что и каталог; параметр `q` обязателен. Поиск идет по названию, описанию, артикулу и значениям характеристик; поддерживаются русский язык, опечатки и поиск по неполному слову (проверено прототипом на Meilisearch 1.58).

```bash
curl "http://localhost:9000/store/search?q=%D1%84%D1%83%D1%82%D0%B1%D0%BE%D0%BB%D0%BA%D0%B0&limit=3" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Проверенный ответ (26.11.2026): `total: 3` — найдены «Футболка «Простая»», «Футболка «Медуза»», «Футболка «Кракен»».

> Примечание: кириллица в curl-примерах должна быть percent-encoded (браузеры и Medusa JS SDK делают это автоматически).

### 14. Поисковые подсказки

`GET /store/search/suggestions?q=...` — подсказки для typeahead: до 8 уникальных товаров по префиксу (название/артикул/характеристики).

```bash
curl "http://localhost:9000/store/search/suggestions?q=%D1%84%D1%83%D1%82%D0%B1" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

```json
{
  "suggestions": [
    { "text": "Футболка «Простая»", "product_id": "prod_...", "handle": "futbolka-prostaya", "sku": "TEE-BASIC-OS" },
    { "text": "Футболка «Медуза»", "product_id": "prod_...", "handle": "futbolka-meduza", "sku": "TEE-MED-L-WHT" }
  ]
}
```

#### Ограничения (актуальные для этапа 3, в разработке)

- Значения фасетов ограничены 25 на фасет, `limit` — 100; диапазон цен фасета `price` — min/max без бакетов.
- При смене активной версии индекса (переиндексация) до 30 секунд запросы может обслуживать предыдущая версия — корректные, но пред-переиндексационные данные.
- Admin API характеристик, Admin UI, интеграционные тесты и полные docs/search.md / docs/filters.md / docs/indexing.md — оставшиеся задачи этапа.

---

## Регионы

Официальная документация: [List Regions](https://docs.medusajs.com/api/store/regions/list-regions), [Get Region](https://docs.medusajs.com/api/store/regions/get-a-region).

### 8. Список регионов

| | |
|---|---|
| **Назначение** | Доступные регионы магазина (валюта, страны). Используется `useStore()` при инициализации витрины |
| **Метод** | `GET` |
| **URL** | `/store/regions` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |
| **Commerce Client** | `useCommerce().regions.list()` (вызывается в `useStore().initialize()`) |

Query parameters: `limit` / `offset`, `q`, `fields` (официальные).

```bash
curl "http://localhost:9000/store/regions" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Реальный ответ (сокращено):

```json
{
  "regions": [
    {
      "id": "reg_01M87JXH28ZWDP5S4FJTY79RPF",
      "name": "Россия",
      "currency_code": "rub",
      "created_at": "2026-11-24T20:10:52.875Z",
      "metadata": null,
      "countries": [
        {
          "iso_2": "ru",
          "iso_3": "rus",
          "num_code": "643",
          "display_name": "Russian Federation",
          "region_id": "reg_01M87JXH28ZWDP5S4FJTY79RPF"
        }
      ]
    }
  ],
  "count": 1,
  "offset": 0,
  "limit": 50
}
```

Возможные коды: 200; 400 `not_allowed`.

### 9. Регион по ID

| | |
|---|---|
| **Назначение** | Отдельный регион |
| **Метод** | `GET` |
| **URL** | `/store/regions/{id}` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |
| **Commerce Client** | `useCommerce().regions.getById(id)` |

```bash
curl "http://localhost:9000/store/regions/reg_nonexistent" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Проверенный контракт ошибок (корректный 404):

```json
HTTP 404
{"type":"not_found","message":"Region with id: reg_nonexistent was not found"}
```

---

## Nuxt Server API

Единственный серверный маршрут витрины. Stage 2 не добавляет новых: Commerce Client работает с Medusa напрямую (серверная сторона — по внутренней Docker-сети, браузер — по публичному URL), а серверные proxy-маршруты не требуются (KISS, см. [docs/commerce-client.md](commerce-client.md)).

> Маршрут `/api/products` (proxy этапа 1) **удален** — его роль полностью выполняет `useCommerce().products.list()`.

### 10. Health check витрины

| | |
|---|---|
| **Назначение** | Docker health check контейнера storefront и статус Medusa на демо-страницах |
| **Метод** | `GET` |
| **URL** | `http://localhost:3000/api/health` |
| **Принадлежность** | Nuxt Server API (Nitro) |
| **Авторизация** | Не требуется |
| **Заголовки** | Не требуются |

```bash
curl http://localhost:3000/api/health
```

Реальный ответ:

```json
{"status":"ok","medusa":"ok"}
```

При недоступной Medusa: `{"status":"ok","medusa":"unreachable"}` — маршрут отвечает всегда (200).

---

## 11. Аутентификация администратора (справочно)

Используется Medusa Admin (`http://localhost:9000/app`). Проверено в этапе 1 для подтверждения учетных данных из `.env`.

| | |
|---|---|
| **Метод** | `POST` |
| **URL** | `/auth/user/emailpass` |
| **Тело** | `{"email": "<ADMIN_EMAIL>", "password": "<ADMIN_PASSWORD>"}` |
| **Авторизация** | Не требуется |

```bash
curl -X POST 'http://localhost:9000/auth/user/emailpass' \
  -H 'Content-Type: application/json' \
  --data-raw '{"email": "admin@example.com", "password": "<ADMIN_PASSWORD>"}'
```

Успех (200 OK): `{"token": "<jwt>"}`. JWT передается в `Authorization: Bearer <jwt>` в маршруты `/admin/*`. Ошибки: 401 `invalid_credentials`.

---

## Последовательности запросов витрины

### Главная страница `/`

```text
1. SSR: GET /store/regions                      → регионы; useStore выбирает регион по умолчанию
              (валюта RUB → регион «Россия»)
2. SSR: GET /store/products?limit=6&order=-created_at&region_id=<id>
              &fields=+*variants.calculated_price  → 6 товаров с рассчитанными ценами
3. HTML рендерится на сервере; данные передаются в payload —
   после hydration запросы не повторяются.
4. Клиентская навигация (например, в /catalog) → запрос выполняет
   браузер напрямую к публичному URL Medusa.
```

### Страница каталога `/catalog?page=N`

```text
1. SSR: GET /store/regions (из payload/по необходимости) — контекст региона
2. SSR: GET /store/products?limit=6&offset=(N-1)*6&order=-created_at&region_id=<id>
              &fields=+*variants.calculated_price
3. count → число страниц; ссылки ?page=N; смена страницы при клиентской
   навигации → запрос из браузера к Medusa напрямую.
```

### Страница товара `/product/:handle`

```text
1. SSR: GET /store/products?handle=<handle>&limit=1&region_id=<id>
              &fields=+*variants.calculated_price  (products.getByHandle)
2. products[0] отсутствует → Nuxt 404 (error.vue)
3. Иначе: варианты (options, sku, calculated_price), изображения,
   характеристики (options + values) рендерятся на сервере.
```

---

## Что будет добавлено на следующих этапах

- Этап 3: поисковые маршруты поверх Meilisearch (`/store/products` с `q` + поиск Meilisearch).
- Этап 6: корзина, доставка, checkout (`/store/carts*`, `/store/checkout-*`, payment providers).
- Этап 7: авторизация покупателя (`/auth/customer/*`, `/store/customers/*`, `/store/orders*`).

Каждый новый модуль обязан сопровождаться разделом в этом файле.

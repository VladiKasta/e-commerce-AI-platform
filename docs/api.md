# Справочник API

Актуально для **Medusa v2.23.0** (зафиксирована в `backend/package.json`) и **Commerce Client** витрины (этап 2).

Перечислены только маршруты, которые **реально используются или проверены** на текущем этапе. Документ расширяется после реализации каждого модуля — актуальная документация API является критерием приемки этапа.

Машиночитаемая OpenAPI-спецификация собственных маршрутов поиска и характеристик (16 операций) — [docs/openapi.yaml](openapi.yaml).

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
- [Admin API характеристик каталога (модуль catalog_attributes, этап 3)](#admin-api-характеристик-каталога-модуль-catalog_attributes-этап-3)
  - [Общие сведения Admin API](#общие-сведения-admin-api)
  - [15. Список характеристик](#15-список-характеристик)
  - [16. Создание характеристики](#16-создание-характеристики)
  - [17. Характеристика по ID](#17-характеристика-по-id)
  - [18. Редактирование характеристики](#18-редактирование-характеристики)
  - [19. Удаление характеристики](#19-удаление-характеристики)
  - [20. Добавление допустимых значений](#20-добавление-допустимых-значений)
  - [21. Редактирование допустимого значения](#21-редактирование-допустимого-значения)
  - [22. Удаление допустимого значения](#22-удаление-допустимого-значения)
  - [23. Привязка характеристики к категориям](#23-привязка-характеристики-к-категориям)
  - [24. Значения характеристик товара: получение](#24-значения-характеристик-товара-получение)
  - [25. Значения характеристик товара: перезапись](#25-значения-характеристик-товара-перезапись)
  - [26. Значения характеристик товара: удаление](#26-значения-характеристик-товара-удаление)
  - [27. Сверка поискового индекса с PostgreSQL](#27-сверка-поискового-индекса-с-postgresql)
  - [Целостность данных и синхронизация с индексом](#целостность-данных-и-синхронизация-с-индексом)
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

Поисковые маршруты каталога поверх Meilisearch через официальный Search Module Medusa: структура индекса и события — [docs/indexing.md](indexing.md); полнотекстовый поиск, подсказки, настройки индекса, синонимы/стоп-слова — [docs/search.md](search.md); модель характеристик и фасетов — [docs/filters.md](filters.md); модель индекса — [docs/ARCHITECTURE.md](ARCHITECTURE.md).

Контракт ответа един для каталога и поиска: `{products, pagination, facets, sortOptions}`. TypeScript-контракты — `backend/src/types/catalog.ts`.

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

#### Ограничения (фактические)

- Значения фасетов ограничены 25 на фасет, до 10 фасетов; `limit` ≤ 100, `offset` ≤ 10 000, длина `q` ≤ 128 символов.
- Диапазонный фасет `price` (и числовые характеристики) — min/max без бакетов.
- Цены в поисковом ответе — минимальная цена варианта в валюте (прайс-листы исключены); точная рассчитанная цена — только `/store/products`.
- При смене активной версии индекса (переиндексация) до 30 секунд запросы может обслуживать предыдущая версия — корректные, но пред-переиндексационные данные.
- `pagination.maxTotalHits` Meilisearch = 5000 — предел глубокой пагинации по документам одной валюты.
- Полный список ограничений поисковой подсистемы — [docs/search.md](search.md).

---

## Admin API характеристик каталога (модуль catalog_attributes, этап 3)

Управление универсальными характеристиками товаров (бренд, материал, технические параметры): реестр характеристик, их допустимые значения, привязки к категориям и значения товаров. Использует сервис модуля `catalog_attributes` (модели Attribute, AttributeOption, CategoryAttribute, ProductAttributeValue — см. [docs/filters.md](filters.md)).

Реализация: `backend/src/api/admin/` — маршруты + zod-валидаторы (`backend/src/api/admin/catalog-attributes/validators.ts`), валидация применяется штатными middleware Medusa (`validateAndTransformBody` / `validateAndTransformQuery`, `src/api/middlewares.ts`).

### Общие сведения Admin API

- **Авторизация:** все маршруты `/admin/*` (включая эти) защищены штатной аутентификацией Medusa — заголовок `Authorization: Bearer <jwt>` (см. [аутентификацию администратора](#11-аутентификация-администратора-справочно)). **Без токена — HTTP 401.**
- **Валидация:** тела и query-параметры проверяются zod-схемами до обработчика; ошибки — 400 `invalid_data` с перечнем проблем (контракт `{type, message}`).
- **Формат ответов:** обертка по имени сущности (`attribute`, `attribute_options`, `product_attribute_values`, …); удаление — `{id|ids, object, deleted: true}`.
- **Формат сумм** — не применяется (модуль не оперирует деньгами).
- `data_type` и `code` характеристики — неизменяемые поля (ключи поискового индекса и типизированных колонок значений); попытка изменить — 400.

#### Управление характеристиками через Medusa Admin

Стандартный Medusa Admin (`http://localhost:9000/app`) покрывает весь цикл без обращения к API вручную:

- **Список и реестр** — раздел «Характеристики» в навигации: таблица всех характеристик (код, название, тип данных, тип фильтра, число допустимых значений), создание через «Создать», удаление с подтверждением (каскад: значения товаров, допустимые значения, привязки).
- **Детальная страница** — редактирование названия, типа фильтра, единицы измерения, позиции и признака «участвует в фильтрации» (неизменяемые `code`/`data_type` — только чтение); секция «Категории» — привязки с добавлением из каталога категорий и удалением (порядок = позиция привязки в каталоге категории); секция «Допустимые значения» — добавление, изменение подписи/позиции, удаление (вместе со значениями товаров).
- **Карточка товара** — блок «Характеристики товара»: показывает характеристики, определенные категориями товара (у категорий без привязок доступны все), и уже назначенные значения (они не удаляются при смене категорий). Значения редактируются контролами по типу данных (текст/число/флажок/выбор значения/набор чипов для мультивыбора), сохраняются построчно; иконка корзины удаляет значения характеристики у товара. Характеристики со штатной опцией (цвет/размер) в блоке не показываются — они задаются опциями вариантов Medusa.

Изменения характеристик попадают в поисковый индекс **автоматически по событиям модуля** (назначение/изменение/удаление значения — ~1–2 с, проверено сквозным сценарием 27.11.2026) или через `make search-reindex` (см. раздел о синхронизации ниже).

Сущности ответа:

| Поле | Тип | Описание |
|---|---|---|
| `attribute` | `object` | Характеристика: `id`, `code`, `name`, `data_type` (`text`\|`number`\|`boolean`\|`select`\|`multi_select`), `filter_type` (`checkbox`\|`select`\|`radio`\|`range`\|`color`\|`boolean`), `unit`, `filterable`, `searchable`, `position`, `option_title`, `options[]`, `categories[]`, `created_at`, `updated_at` |
| `attribute.options[]` | `object[]` | Допустимые значения: `id`, `value` (машинное), `label`, `position` |
| `attribute.categories[]` | `object[]` | Привязки: `id`, `category_id`, `position` |
| `product_attribute_values[]` | `object[]` | Значения товара: `id`, `attribute_id`, `product_id`, `variant_id`, типизированные колонки (`text_value` / `numeric_value` / `boolean_value` — заполнена ровно одна) |

### 15. Список характеристик

| | |
|---|---|
| **Назначение** | Реестр характеристик с допустимыми значениями и привязками к категориям |
| **Метод** | `GET` |
| **URL** | `/admin/catalog-attributes` |
| **Авторизация** | Bearer JWT администратора |

#### Query parameters

| Параметр | Тип | Описание |
|---|---|---|
| `q` | `string` | Подстрока в `code` или `name` (без учета регистра) |
| `limit` | `number` | 1–100, по умолчанию 20 |
| `offset` | `number` | ≥ 0, по умолчанию 0 |

#### Пример curl

```bash
curl "http://localhost:9000/admin/catalog-attributes?limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

#### Пример ответа (200 OK, сокращено)

```json
{
  "attributes": [
    {
      "id": "attr_01MC...",
      "code": "brand",
      "name": "Бренд",
      "data_type": "select",
      "filter_type": "checkbox",
      "unit": null,
      "filterable": true,
      "searchable": true,
      "position": 1,
      "option_title": null,
      "options": [
        { "id": "attopt_01MC...", "attribute_id": "attr_01MC...", "value": "medusa-originals", "label": "Medusa Originals", "position": 1 }
      ],
      "categories": [
        { "id": "catattr_01MC...", "category_id": "pcat_...", "attribute_id": "attr_01MC...", "position": 1 }
      ]
    }
  ],
  "count": 6,
  "limit": 20,
  "offset": 0
}
```

Возможные коды: 200; 401 (без токена); 400 `invalid_data` (параметры).

### 16. Создание характеристики

| | |
|---|---|
| **Метод** | `POST` |
| **URL** | `/admin/catalog-attributes` |
| **Авторизация** | Bearer JWT администратора |

#### Тело запроса

| Поле | Тип | Обязателен | Описание |
|---|---|---|---|
| `code` | `string` | да | Уникальный код (латиница kebab/snake, `[a-z0-9][a-z0-9_-]*`) |
| `name` | `string` | да | Название |
| `data_type` | `string` | нет | `text` (по умолчанию), `number`, `boolean`, `select`, `multi_select` |
| `filter_type` | `string` | нет | `checkbox` (по умолчанию), `select`, `radio`, `range`, `color`, `boolean` |
| `unit` | `string\|null` | нет | Единица измерения |
| `filterable` | `boolean` | нет | По умолчанию `true` |
| `searchable` | `boolean` | нет | По умолчанию `true` |
| `position` | `number` | нет | По умолчанию 0 |
| `option_title` | `string\|null` | нет | Название штатной опции Medusa для вариант-специфичных значений |
| `options` | `object[]` | нет | Допустимые значения: `{value, label, position?}` |

```bash
curl -X POST "http://localhost:9000/admin/catalog-attributes" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-raw '{"code":"season","name":"Сезон","data_type":"select","options":[{"value":"summer","label":"Лето"},{"value":"winter","label":"Зима"}]}'
```

Ответ — **201 Created** с объектом `attribute` (включая созданные `options`, `categories: []`).

Возможные коды: 201; 400 `invalid_data` (неуникальный `code`, дубликаты значений в `options`, ошибки схемы); 401.

### 17. Характеристика по ID

`GET /admin/catalog-attributes/{id}` — 200 с объектом `attribute` (включая `options` и `categories`).

```bash
curl "http://localhost:9000/admin/catalog-attributes/attr_01MC..." \
  -H "Authorization: Bearer $TOKEN"
```

Возможные коды: 200; 404 `not_found` (`Attribute with id: ... was not found`); 401.

### 18. Редактирование характеристики

| | |
|---|---|
| **Метод** | `POST` |
| **URL** | `/admin/catalog-attributes/{id}` |
| **Авторизация** | Bearer JWT администратора |

Тело — частичное: `name`, `filter_type`, `unit`, `filterable`, `searchable`, `position`, `option_title`. Переданные `code`/`data_type` допустимы только со значением, равным текущему (иначе 400 — неизменяемые ключи индекса).

```bash
curl -X POST "http://localhost:9000/admin/catalog-attributes/attr_01MC..." \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-raw '{"name":"Сезонность","filterable":false}'
```

Ответ — 200 с обновленным `attribute`. Возможные коды: 200; 400 (изменение `code`/`data_type`); 404; 401.

### 19. Удаление характеристики

| | |
|---|---|
| **Метод** | `DELETE` |
| **URL** | `/admin/catalog-attributes/{id}` |
| **Авторизация** | Bearer JWT администратора |

Каскад (soft delete): значения товаров → допустимые значения → привязки к категориям → сама характеристика. «Осиротевших» записей не остается.

```bash
curl -X DELETE "http://localhost:9000/admin/catalog-attributes/attr_01MC..." \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "id": "attr_01MC...", "object": "catalog-attribute", "deleted": true }
```

Возможные коды: 200; 404; 401.

### 20. Добавление допустимых значений

| | |
|---|---|
| **Назначение** | Добавление опций характеристики (для select/multi_select и подписей фасетов) |
| **Метод** | `POST` |
| **URL** | `/admin/catalog-attributes/{id}/options` |
| **Авторизация** | Bearer JWT администратора |

Тело: `{ "options": [{ "value": "demi", "label": "Межсезонье", "position": 3 }] }` — минимум один элемент; дубликаты значений (в запросе или среди существующих) → 400.

```bash
curl -X POST "http://localhost:9000/admin/catalog-attributes/attr_01MC.../options" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-raw '{"options":[{"value":"demi","label":"Межсезонье"}]}'
```

Ответ — **201** с `{ "attribute_options": [...] }`. Возможные коды: 201; 400; 404; 401.

### 21. Редактирование допустимого значения

`POST /admin/catalog-attributes/{id}/options/{option_id}` — изменяет `label` и/или `position`. Машинное `value` неизменяемо (400 при попытке — на него ссылаются значения товаров и индекс). Ответ — 200 с `{ "attribute_option": {...} }`.

Возможные коды: 200; 404 (в т.ч. если опция принадлежит другой характеристике); 401.

### 22. Удаление допустимого значения

`DELETE /admin/catalog-attributes/{id}/options/{option_id}` — soft delete опции **и всех значений товаров, ссылающихся на нее** (значения удаляются первыми — их события переиндексируют товары). Ответ — `{ "id": "...", "object": "attribute-option", "deleted": true }`.

Возможные коды: 200; 404; 401.

### 23. Привязка характеристики к категориям

| | |
|---|---|
| **Назначение** | Идемпотентная замена всего набора привязок: какие фильтры показывать в категории каталога и в каком порядке |
| **Метод** | `POST` |
| **URL** | `/admin/catalog-attributes/{id}/categories` |
| **Авторизация** | Bearer JWT администратора |

Тело: `{ "category_ids": ["pcat_...", "pcat_..."] }` — порядок задает `position`; пустой массив снимает все привязки. Категории проверяются на существование (Product Module): несуществующие → 400 с их списком.

```bash
curl -X POST "http://localhost:9000/admin/catalog-attributes/attr_01MC.../categories" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-raw '{"category_ids":["pcat_01M87JXH52XRX3DV0D5SWRZR25"]}'
```

Ответ — 200 с `{ "category_attributes": [...] }` (новый набор привязок). Возможные коды: 200; 400; 404 (характеристика); 401.

### 24. Значения характеристик товара: получение

| | |
|---|---|
| **Назначение** | Все значения характеристик товара (уровень товара и вариантов) |
| **Метод** | `GET` |
| **URL** | `/admin/products/{id}/attribute-values` |
| **Авторизация** | Bearer JWT администратора |

```bash
curl "http://localhost:9000/admin/products/prod_01M8.../attribute-values" \
  -H "Authorization: Bearer $TOKEN"
```

Ответ — 200 с `{ "product_attribute_values": [...] }`; несуществующий товар → 404 `not_found`. Возможные коды: 200; 404; 401.

### 25. Значения характеристик товара: перезапись

| | |
|---|---|
| **Назначение** | Идемпотентная перезапись значений: для каждой пары (характеристика × товар/вариант) набор значений заменяется целиком |
| **Метод** | `POST` |
| **URL** | `/admin/products/{id}/attribute-values` |
| **Авторизация** | Bearer JWT администратора |

Тело: `{ "values": [{ "attribute_id": "attr_...", "variant_id": "variant_..." (опционально), "value": string|number|boolean }] }`.

Проверки перед записью (некорректные связи исключены):

- товар существует, `variant_id` (если передан) принадлежит этому товару — иначе 404/400;
- `attribute_id` существуют — иначе 400 со списком;
- тип `value` соответствует `data_type` характеристики (string для text/select/multi_select, number, boolean) — иначе 400;
- для `select`/`multi_select` значение обязано быть допустимым (`attribute_options`) — иначе 400. Для нескольких значений multi_select передается несколько элементов с одним `attribute_id`.

```bash
curl -X POST "http://localhost:9000/admin/products/prod_01M8.../attribute-values" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-raw '{"values":[{"attribute_id":"attr_01MC...","value":"medusa-originals"}]}'
```

Ответ — **201** с `{ "product_attribute_values": [...] }` (созданные строки).

Возможные коды: 201; 400 (все проверки выше); 404 (товар); 401.

### 26. Значения характеристик товара: удаление

| | |
|---|---|
| **Назначение** | Удаление значений одной характеристики в области товара или конкретного варианта |
| **Метод** | `DELETE` |
| **URL** | `/admin/products/{id}/attribute-values?attribute_id=attr_...[&variant_id=variant_...]` |
| **Авторизация** | Bearer JWT администратора |

Без `variant_id` удаляются значения уровня товара (variant_id IS NULL); с `variant_id` — значения этого варианта.

```bash
curl -X DELETE "http://localhost:9000/admin/products/prod_01M8.../attribute-values?attribute_id=attr_01MC..." \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "ids": ["prodattr_01MC..."], "object": "product-attribute-value", "deleted": true, "product_id": "prod_01M8...", "attribute_id": "attr_01MC...", "variant_id": null }
```

Возможные коды: 200 (в т.ч. при отсутствии значений — `ids: []`); 404 (товар/характеристика); 401.

### 27. Сверка поискового индекса с PostgreSQL

| | |
|---|---|
| **Назначение** | Ручной запуск сверки индекса (та же логика, что у scheduled job `search-index-reconcile` и `make search-reconcile`): обнаружение отсутствующих/устаревших/лишних документов и сирот, точечный ремонт затронутых товаров через Search Module |
| **Метод** | `POST` |
| **URL** | `/admin/search/reconcile` |
| **Авторизация** | Bearer JWT администратора |

Полная переиндексация не выполняется. Параллельный запуск пропускается (lock).

```bash
curl -X POST "http://localhost:9000/admin/search/reconcile" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "status": "completed",
  "summary": {
    "physicalName": "store_products_v3",
    "checkedProducts": 12, "checkedDocs": 30,
    "missing": 0, "stale": 0, "extra": 0,
    "orphanProducts": 0, "orphanDocs": 0,
    "reindexedProducts": 0, "deletedDocs": 0, "errors": 0
  }
}
```

Возможные коды: 200 (`"status": "completed"` с итогами или `"status": "skipped"` — предыдущий запуск еще выполняется); 401.

### Целостность данных и синхронизация с индексом

- **Каскадные удаления.** Удаление характеристики удаляет (soft delete) все зависимые записи: значения товаров, допустимые значения, привязки к категориям. Удаление допустимого значения удаляет ссылающиеся на него значения товаров. Проверено SQL-запросом: после удаления характеристики живых строк во всех таблицах модуля не остается.
- **Неизменяемые ключи.** `code`/`data_type` характеристики и `value` допустимого значения — на них ссылается поисковый индекс (ключ документа `attributes.<code>`) и типизированные колонки значений.
- **Синхронизация с поисковым индексом (проверено на Medusa 2.23, 27.11.2026).** Операции Admin API со значениями характеристик синхронизируют индекс автоматически через события модуля `catalog_attributes.product-attribute-value.*` (назначение/изменение — событие `created`, удаление — `deleted`): документ затронутого товара пересобирается из БД за ~1–2 с (замер сквозным сценарием с ограниченным polling). Нюансы реализации: (1) Medusa 2.23 строит имена событий моделей модуля в kebab-case (`product-attribute-value`, не `product_attribute_value`); (2) событие `deleted` несет только id строк, поэтому значения удаляются soft delete-ом (контракт маршрутов не меняется — list-методы и витрина видят только живые строки), а подписчик `catalog-attribute-values-search` резолвит затронутые товары через сервис модуля (`withDeleted`) и подает обогащенное событие в официальный ingestion-конвейер Search Module (`searchModule.ingest` — тот же вход, что у встроенного подписчика). Каскадные удаления (характеристика/опция) переиндексируют затронутые товары тем же механизмом. Периодическая сверка индекса с PostgreSQL (этап 3.6.2, scheduled job `search-index-reconcile`, расписание `SEARCH_RECONCILE_CRON`; ручной запуск — маршрут №27 или `make search-reconcile`) закрывает разрывы автоматически; полная переиндексация `make search-reindex` нужна только для массовых операций.


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

- Этап 6: корзина, доставка, checkout (`/store/carts*`, `/store/checkout-*`, payment providers).
- Этап 7: авторизация покупателя (`/auth/customer/*`, `/store/customers/*`, `/store/orders*`).

Каждый новый модуль обязан сопровождаться разделом в этом файле.

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
- [Корзина, checkout и заказы (аудит этапа 4)](#корзина-checkout-и-заказы-аудит-этапа-4)
  - [28. Создание корзины](#28-создание-корзины)
  - [29. Получение и обновление корзины](#29-получение-и-обновление-корзины)
  - [30. Позиции: добавление](#30-позиции-добавление)
  - [31. Позиции: изменение количества](#31-позиции-изменение-количества)
  - [32. Позиции: удаление](#32-позиции-удаление)
  - [33. Промокоды](#33-промокоды)
  - [34. Способы доставки: список](#34-способы-доставки-список)
  - [35. Способ доставки корзины](#35-способ-доставки-корзины)
  - [36. Пересчет налогов](#36-пересчет-налогов)
  - [37. Платежные коллекции и сессии](#37-платежные-коллекции-и-сессии)
  - [38. Завершение корзины (complete)](#38-завершение-корзины-complete)
  - [39. Заказ по ID](#39-заказ-по-id)
  - [Безопасность (проверено)](#безопасность-корзины-и-заказов-проверено)
- [Авторизация и покупатели (аудит этапа 5)](#авторизация-и-покупатели-аудит-этапа-5)
  - [40. Регистрация покупателя: auth identity](#40-регистрация-покупателя-auth-identity)
  - [41. Регистрация покупателя: профиль](#41-регистрация-покупателя-профиль)
  - [42. Вход (JWT)](#42-вход-jwt)
  - [43. Сессия: обмен токена и выход](#43-сессия-обмен-токена-и-выход)
  - [44. Обновление JWT](#44-обновление-jwt)
  - [45. Сброс пароля: запрос токена](#45-сброс-пароля-запрос-токена)
  - [46. Смена пароля](#46-смена-пароля)
  - [47. Текущий покупатель](#47-текущий-покупатель)
  - [48. Изменение профиля](#48-изменение-профиля)
  - [49. Адреса покупателя](#49-адреса-покупателя)
  - [50. Привязка корзины к покупателю (claim)](#50-привязка-корзины-к-покупателю-claim)
  - [51. История заказов покупателя](#51-история-заказов-покупателя)
  - [52. Заказ по ID и авторизованные заказы](#52-заказ-по-id-и-авторизованные-заказы)
  - [53. Перенос гостевого заказа (transfer)](#53-перенос-гостевого-заказа-transfer)
  - [Безопасность авторизации и покупателей (проверено)](#безопасность-авторизации-и-покупателей-проверено)
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
| 409 | `conflict` | Конфликт состояния (например, complete корзины, чья блокировка занята дольше 30 с) |
| 429 | `rate_limited` | Превышен лимит попыток защищаемого маршрута (этап 5.2.2) — с заголовком `Retry-After` |
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
| **Назначение** | Категории каталога (навигация, каталог по категориям — этапы 9–10) |
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

## Корзина, checkout и заказы (аудит этапа 4)

Все маршруты раздела — **штатный Store API Medusa 2.23.0**; собственных маршрутов этап не создает. Проверено реальными HTTP-запросами на живом окружении: подэтап 4.1 — аудит штатного Cart API (полный гостевой цикл от создания корзины до заказа), подэтап 4.3 — покрытие интеграционными тестами (`storefront/tests/integration/store-cart-checkout.spec.ts`, 26 тестов, `make test`). Результаты аудита и решения — [PROGRESS.md](PROGRESS.md).

Ключевые свойства (проверено фактически):

- **Корзина гостя** не требует авторизации: адресуется непредсказуемым id (`cart_…`), доступ — publishable API key + id.
- **Цены и итоги считает сервер**: `unit_price` позиции берется из прайс-листа региона и совпадает с `calculated_price` каталога; денежные поля в payload не принимаются.
- **Наличие проверяется сервером** при добавлении и изменении количества.
- **Промокоды**: применяются только активные промоушены (`status: "active"`); промоушен, созданный через Admin API без явного `status`, находится в `draft` и скидку не дает.
- **Платеж**: провайдер `pp_system_default` доступен из коробки; payment collection создается явно; отдельного store-маршрута авторизации платежной сессии в 2.23 нет — авторизация системного провайдера происходит при завершении корзины (`order.payment_status = "authorized"`, проверено через Admin API).
- **Особенность totals**: `subtotal` корзины и заказа **включает доставку** (`subtotal = item_subtotal + shipping_subtotal`); «итог без доставки» — поле `item_subtotal`.
- **Sales channel**: seed связывает ключ витрины только с каналом «Веб-витрина» (задача 4.2, 27.11.2026) — `sales_channel_id` в теле создания корзины можно не передавать. Поведение Medusa при ключе с несколькими каналами сохраняется: без явного `sales_channel_id` — 400.

### 28. Создание корзины

| | |
|---|---|
| **Назначение** | Создание гостевой корзины (контекст: регион, валюта, канал продаж) |
| **Метод** | `POST` |
| **URL** | `/store/carts` |
| **Принадлежность** | Medusa Store API |
| **Авторизация** | Publishable API key |

Тело: `{ "region_id": "reg_…" }`. `sales_channel_id` передавать не требуется: ключ витрины связан только с каналом «Веб-витрина», Medusa подставляет его из publishable API key (ключ с несколькими каналами потребовал бы явный `sales_channel_id` — 400).

```bash
curl -X POST "http://localhost:9000/store/carts" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  --data-raw '{"region_id":"reg_01M87JXH28ZWDP5S4FJTY79RPF"}'
```

Пример ответа (200 OK, реальный, сокращено):

```json
{
  "cart": {
    "id": "cart_01M8EM2ZZ51P5ZYCC7NSWYH4P9",
    "currency_code": "rub",
    "region_id": "reg_01M87JXH28ZWDP5S4FJTY79RPF",
    "sales_channel_id": "sc_01M87JXH172AS6PG13N2QSWNPG",
    "email": null,
    "items": [],
    "subtotal": 0, "discount_total": 0, "shipping_total": 0, "tax_total": 0, "total": 0
  }
}
```

`sales_channel_id` в ответе — канал из publishable API key (проверено 27.11.2026 после задачи 4.2). Возможные коды: 200; 400 `not_allowed` — «key has multiple associated sales channels» (для ключей с несколькими каналами без явного `sales_channel_id`) или проблема ключа; 400 `invalid_data` — несуществующий регион.

### 29. Получение и обновление корзины

`GET /store/carts/{id}` — дефолтный ответ уже содержит `items`, адреса и полный набор totals (`item_subtotal`, `discount_total`, `shipping_total`, `tax_total`, `original_total` и др.).

`POST /store/carts/{id}` — обновление: `email`, `shipping_address`, `region_id`, `sales_channel_id`, `metadata`. Привязка покупателя выполняется отдельным штатным маршрутом [`POST /store/carts/{id}/customer`](#50-привязка-корзины-к-покупателю-claim) (этап 5). Адрес передается объектом (`first_name`, `last_name`, `address_1`, `city`, `country_code`, `postal_code`, `phone`).

```bash
curl -X POST "http://localhost:9000/store/carts/cart_01M8EJM9QSQ571G9WXJFP228R1" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  --data-raw '{"email":"guest@example.com","shipping_address":{"first_name":"Иван","last_name":"Гость","address_1":"ул. Тестовая, 1","city":"Москва","country_code":"ru","postal_code":"101000","phone":"+7 999 000-00-00"}}'
```

Ответ — 200 с обновленной корзиной (`email` заполнен, `shipping_address` сохранен — проверено). Возможные коды: 200; 400 (невалидное тело); 404 `not_found` (`Cart with id 'null' not found`).

### 30. Позиции: добавление

`POST /store/carts/{id}/line-items` — тело `{ "variant_id": "variant_…", "quantity": 2 }`.

```bash
curl -X POST "http://localhost:9000/store/carts/cart_01M8EJM9QSQ571G9WXJFP228R1/line-items" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  --data-raw '{"variant_id":"variant_01M87JXH78C4ESGHPEMMCBHZWA","quantity":2}'
```

Пример ответа (200 OK, реальный): позиция с серверной ценой и пересчитанными totals корзины:

```json
{
  "cart": {
    "items": [
      { "id": "cali_01M8EJM9XD1RK1JFRBNQTYPM2B", "variant_id": "variant_01M87JXH78C4ESGHPEMMCBHZWA",
        "title": "Худи «Полярное»", "quantity": 2, "unit_price": 4590, "requires_shipping": true }
    ],
    "subtotal": 9180, "discount_total": 0, "shipping_total": 0, "tax_total": 0, "total": 9180
  }
}
```

`unit_price` (4590) равен `calculated_price.calculated_amount` каталога — цена назначается сервером.

> Особенность (проверено 27.11.2026): в **дефолтном** ответе суммы уровня позиции — `items[].subtotal`, `total`, `discount_total`, `adjustments` — равны `null`; заполнены только `quantity`, `unit_price` и totals корзины. Суммы позиции нужны только с явным параметром, например `?fields=+items.subtotal,+items.discount_total,+items.total,+items.adjustments` (проверено: `subtotal: 780, discount_total: 78, adjustments: [{code, amount}]`).

Возможные коды: 200; 400 `insufficient_inventory` (тело `{"code":"insufficient_inventory","type":"not_allowed","message":"Some variant does not have the required inventory"}` — проверено на варианте с нулевым остатком и при превышении доступного остатка); 400 `invalid_data` — посторонние поля (`unit_price` → `"Unrecognized fields: 'unit_price'"`), `quantity < 1` (сообщение `"Value for field 'quantity' too small, expected at least: '0'"` — отклоняет и `-1`, и `0`) или несуществующий вариант (`"Variants variant_… do not exist or belong to a product that is not published"` — проверено 27.11.2026).

### 31. Позиции: изменение количества

`POST /store/carts/{id}/line-items/{line_id}` — тело `{ "quantity": 3 }`. Ответ — 200 с обновленной корзиной (`total: 13770` при 3 × 4590 — проверено). Проверки наличия выполняются и здесь. Возможные коды: 200; 400 (`invalid_data`, `insufficient_inventory`); 404.

### 32. Позиции: удаление

`DELETE /store/carts/{id}/line-items/{line_id}` — ответ (200 OK, реальный):

```json
{ "id": "cali_01M8EJM9XD1RK1JFRBNQTYPM2B", "object": "line-item", "deleted": true,
  "parent": { "id": "cart_01M8EJM9QSQ571G9WXJFP228R1", "total": 0 } }
```

Корзина возвращается в поле `parent`. Возможные коды: 200; 404.

### 33. Промокоды

`POST /store/carts/{id}/promotions` — тело `{ "promo_codes": ["AUDIT10"] }` (массив). Снятие — `DELETE /store/carts/{id}/promotions` с тем же телом.

Проверено на живом промоушене (создан Admin API: `type: "standard"`, `application_method: {type: "percentage", value: 10, target_type: "items", allocation: "each", max_quantity: 5}`, `status: "active"` — `allocation: "each"` требует `max_quantity`, без него Admin API отвечает 400):

```json
{
  "cart": {
    "promotions": [{ "code": "AUDIT10", "status": "active" }],
    "items": [
      { "quantity": 2, "unit_price": 4590, "subtotal": 9180, "discount_total": 918, "total": 8262,
        "adjustments": [{ "code": "AUDIT10", "amount": 918 }] }
    ],
    "subtotal": 9180, "discount_total": 918, "total": 8262
  }
}
```

Особенности (проверено): несуществующий код → 400 `invalid_data` (`"The promotion code NO_SUCH_CODE is invalid"`); **`draft`-промоушен** принимается молча (200), но не привязывается и скидку не дает; снятие не примененного кода → 200 (идемпотентно).

### 34. Способы доставки: список

`GET /store/shipping-options?cart_id={cart_id}` — опции, доступные корзине (регион + shipping profile + провайдер).

```json
{
  "shipping_options": [
    { "id": "so_01M87JXH3WV1Q4QVEMWDGANTAT", "name": "Стандартная доставка", "amount": 500, "provider_id": "manual_manual" },
    { "id": "so_01M87JXH3WM9ZVK4ZR3YAXSZN4", "name": "Экспресс-доставка", "amount": 990, "provider_id": "manual_manual" }
  ]
}
```

Обе опции создаются seed; провайдер — штатный `manual_manual` (единственный включенный fulfillment provider). Возможные коды: 200; 400.

### 35. Способ доставки корзины

`POST /store/carts/{id}/shipping-methods` — тело `{ "option_id": "so_…" }`. Ответ — 200 с пересчитанными totals (`shipping_total: 500`, `total` вырос на сумму доставки — проверено). Возможные коды: 200; 400; 404.

### 36. Пересчет налогов

`POST /store/carts/{id}/taxes` — принудительный пересчет налоговых ставок корзины (тело `{}`); актуален для регионов с настроенными tax rates. Для завершенной корзины — 400 (`"Cart … is already completed"`). Возможные коды: 200; 400.

### 37. Платежные коллекции и сессии

Доступные провайдеры региона: `GET /store/payment-providers?region_id={region_id}` → `{"payment_providers":[{"id":"pp_system_default","is_enabled":true}]}` (провайдер доступен из коробки, без конфигурации).

Создание collection для корзины (явное; авто-создания при добавлении доставки нет — проверено):

```bash
curl -X POST "http://localhost:9000/store/payment-collections" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  --data-raw '{"cart_id":"cart_01M8EJPQ4RNBYM7WSJTPMCY6D5"}'
```

Ответ (200): `{"payment_collection":{"id":"pay_col_01M8EJNQ74V9EQDZ4HVDTME4YY","currency_code":"rub","amount":9680,"payment_sessions":[]}}` — `amount` равен `total` корзины на момент создания.

Сессия: `POST /store/payment-collections/{id}/payment-sessions` — тело `{ "provider_id": "pp_system_default" }`:

```json
{ "payment_collection": { "id": "pay_col_…", "amount": 9680,
  "payment_sessions": [ { "id": "payses_01M8EJNQ8HN1JC1MSCQJC048SR", "provider_id": "pp_system_default", "status": "pending", "amount": 9680 } ] } }
```

Ограничения 2.23 (проверено): маршрутов `GET /store/payment-collections/{id}` и авторизации сессии (`…/payment-sessions/{id}/authorize`) в Store API **нет** (404); состояние collection читается через корзину (`GET /store/carts/{id}?fields=+payment_collection,*payment_collection.payment_sessions`); авторизация `pp_system_default` происходит неявно при завершении корзины. Обновление данных сессии: `POST /store/payment-collections/{id}/payment-sessions/{session_id}` — тело `{ "client_data": { … } }`.

**Доступ (этап 5.3.1)**: ядро 2.23 не проверяет владельца на этих маршрутах — защита обеспечена middleware `payment-access.ts` на штатных маршрутах. Право на платежную коллекцию наследуется от права на её корзину (link `cart_payment_collection`, Query API): коллекция гостевой корзины (владелец `null`/`has_account:false`) работает по гостевой модели Medusa (id = секрет); коллекция авторизованной корзины — **только владелец**: посторонний покупатель и неавторизованный запрос получают контролируемый **404** (для создания — `Cart with id … not found`, для сессий — `Payment collection with id … was not found` — штатные форматы, без раскрытия суммы). Знание `payment_collection_id`/`payment_session_id` права не дает: сессии адресуются через id коллекции, а право определяется состоянием корзины. После claim коллекция наследует защиту владельца; конкурентный claim постоянного обхода не дает (stateless-проверка на каждом запросе). Admin API, внутренние workflows ядра (complete) и будущие webhook-маршруты провайдеров не затрагиваются.

Возможные коды: 200; 400; 404 (нет права / не существует).

### 38. Завершение корзины (complete)

`POST /store/carts/{id}/complete` — тело `{}`. Ответ — заказ:

```json
{
  "type": "order",
  "order": {
    "id": "order_01M8EJNQB9XP37Q8FZKZ8SCECY",
    "display_id": 1,
    "status": "pending",
    "email": "guest@example.com",
    "currency_code": "rub",
    "subtotal": 9680, "discount_total": 0, "shipping_total": 500, "tax_total": 0, "total": 9680,
    "items": [ { "title": "Худи «Полярное»", "quantity": 2, "unit_price": 4590, "subtotal": 9180, "total": 9180 } ]
  }
}
```

Со скидкой (реальный заказ с промокодом AUDIT10 и экспресс-доставкой): `subtotal: 10170` (9180 + 990), `discount_total: 918`, `shipping_total: 990`, `total: 9252` — все суммы серверные.

> `customer_id` в Store API-ответах заказа (complete и `GET /store/orders/:id`) **отсутствует вовсе** (проверено 27.11.2026). Гостевому заказу Medusa автоматически создает неявную запись customer с `has_account: false` и email гостя: связь видна только в Admin API (`GET /admin/orders/:id?fields=+customer_id` — в дефолтном ответе Admin API это поле тоже отсутствует).

Серверные требования (проверено изоляцией): payment collection с сессией; способ доставки, если позиции `requires_shipping` (без них — 400). **Email сервером не требуется** — заказ создается и без него (проверено, display_id 3); сбор email — ответственность витрины.

**Повторное завершение той же корзины идемпотентно (проверено 27.11.2026, уточнение аудита 4.1):** `completeCartWorkflow` возвращает **200 с тем же заказом** (`{"type":"order","order":{"id": <тот же>}}`) — дублирующий заказ не создается (`GET /admin/orders?id=…` count остается 1). Ранее здесь ошибочно указывался 400.

**Серверная сериализация завершения (этап 4.5, 27.11.2026):** маршрут защищен межпроцессной блокировкой по `cart_id` — транзакционный advisory-лок PostgreSQL через штатный Locking Module (провайдер `locking-postgres`), middleware `backend/src/api/middlewares/cart-completion.ts` на самом штатном маршруте. Блокировка охватывает весь запрос (проверку состояния корзины, выполнение workflow, коммит) и гарантированно освобождается (транзакционный лок снимается PostgreSQL при коммите/откате/обрыве соединения). Два одновременных complete одной корзины создают **ровно один заказ** (второй запрос дожидается и получает существующий); разные корзины оформляются параллельно. Блокировка не обходима прямым вызовом Store API. Покрыто регрессионным тестом (`store-cart-checkout.spec.ts`, Promise.allSettled).

Возможные коды: 200 (`{"type":"order"}` — в том числе при повторном и одновременном complete); 409 `conflict` «Cart is already being completed by another request» — блокировка той же корзины занята дольше 30 с (незавершающееся оформление); **404 — с этапа 5.2.1 для чужой авторизованной корзины** (middleware cart-access); 400 `invalid_data`: `"Payment collection has not been initiated for cart"` / `"Payment sessions are required to complete cart"` / `"No shipping method selected but the cart contains items that require shipping."`.

### 39. Заказ по ID

`GET /store/orders/{id}` — чтение заказа по id. **С этапа 5.2.1 маршрут защищен серверной проверкой права доступа** (ранее — «непредсказуемый id» без авторизации, аудит 5.1):

- авторизованный покупатель — только собственные заказы (посторонним и неавторизованным — 404);
- гостевой заказ — только по подтвержденному праву: заголовок `x-cart-id` с id корзины, из которой заказ оформлен (связь order↔cart создает ядро при complete, проверяется штатным Query API):
```bash
curl "http://localhost:9000/store/orders/order_01M8…" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "x-cart-id: cart_01M8…"   # право доступа гостя (из httpOnly-cookie витрины)
```
- любой отказ — контролируемый **404** `not_found` (`"Order with id: … was not found"`), неотличимый от несуществующего заказа: не раскрывает ни существование, ни персональные данные.

Ответ (200, сокращено): `{"order":{"id":"…","status":"pending","payment_status":"authorized","summary":{"paid_total":0,…}}}` — `payment_status` доступен прямо в Store API-ответе (`authorized` для `pp_system_default`; дополнительно подтверждено через Admin API). Перенос заказа покупателю — [маршрут 53](#53-перенос-гостевого-заказа-transfer). Возможные коды: 200; 404 (нет права/не существует).

### Безопасность корзины и заказов (проверено)

| Проверка | Результат |
|---|---|
| Любой `/store/*` без publishable key | 400 `not_allowed` |
| Подмена цены (`unit_price` в payload) | 400 `invalid_data` «Unrecognized fields» — цена назначается только сервером |
| Отрицательное/нулевое количество | 400 `invalid_data` |
| Вариант с нулевым остатком | 400 `insufficient_inventory` |
| Доступ к чужой корзине/гостевому заказу | Гостевая корзина и гостевой заказ адресуются непредсказуемыми id (`cart_…`/`order_…`, ULID) — модель Medusa для гостей; **с этапа 5.2.1 авторизованная корзина (владелец `has_account: true`) доступна только владельцу** (чтение/изменение/complete/claim чужой — 404), **гостевой заказ — по подтвержденному праву** `x-cart-id` (см. маршруты 39/50/52); id не должен раскрываться третьим сторонам (хранение id на витрине — этапы 9–10) |
| ~~Маршруты платежных коллекций (37)~~ | **Устранено этапом 5.3.1** (ранее — находка 5.3, upstream): `POST /store/payment-collections` и payment-sessions не проверяли владельца корзины; теперь право на коллекцию наследуется от права на её корзину (middleware `payment-access.ts`, link `cart_payment_collection`): гостевая корзина — по гостевой модели Medusa, авторизованная — только владелец (посторонним/неавторизованным — 404 без раскрытия суммы), после claim защита наследуется, конкурентный claim обхода не дает |
| Итоги, скидки, наличие | Вычисляются только сервером |

---

## Авторизация и покупатели (аудит этапа 5)

Все маршруты раздела — **штатные Auth API и Store API Medusa 2.23.0**; собственных маршрутов этап не создает. Проверено реальными HTTP-запросами на живом окружении (подэтап 5.1, 27.11.2026): полный цикл регистрации → входа → профиля → адресов → привязки корзины → заказа → истории; сессии и JWT; сброс/смена пароля; перенос гостевого заказа; негативные и межпользовательские сценарии безопасности. Результаты аудита — [PROGRESS.md](PROGRESS.md). **Практическое руководство разработчика — [docs/auth.md](auth.md)** (архитектура, жизненный цикл токенов, примеры, контракты composables этапа 9).

Ключевые свойства (проверено фактически):

- **Два способа авторизации**: JWT (заголовок `Authorization: Bearer <jwt>`, срок действия по умолчанию **24 ч**) и **session cookie** (`connect.sid`, HttpOnly, создается обменом JWT в `POST /auth/session`). Оба принимаются всеми маршрутами покупателя (`/store/customers/*`, `GET /store/orders`, `POST /store/carts/:id/customer`).
- **Регистрация — два шага**: сначала auth identity (`/auth/customer/emailpass/register`), затем профиль покупателя (`POST /store/customers`) по выданному «actorless» JWT.
- **Маршруты `/auth/*` не требуют publishable API key** (проверено) — ключ обязателен только для `/store/*`.
- **Выход отзывает только сессию**: JWT — stateless, действует до истечения (проверено: после `DELETE /auth/session` JWT продолжает работать).
- **Гостевые заказы не наследуются** при регистрации покупателя с тем же email — заказ виден в истории только после штатного transfer (маршрут 53).
- **Список заказов серверно фильтруется по покупателю** (`customer_id` из auth context) — требование приемки 4.4 выполняется штатно.
- **Rate limiting (этап 5.2.2)**: вход, регистрация, сброс и смена пароля, запрос переноса заказа лимитируются серверно (429 + `Retry-After`; детали и значения — [docs/configuration.md](configuration.md), механизм — решение №38 в [PROGRESS.md](PROGRESS.md)). Лимит применяется до аутентификации и одинаков для существующих/несуществующих email — перечисление аккаунтов невозможно. Штатных блокировок нет: 429 — всегда временный (окно истекает само).

### 40. Регистрация покупателя: auth identity

| | |
|---|---|
| **Назначение** | Создание учетных данных (email+пароль) покупателя; первый шаг регистрации |
| **Метод** | `POST` |
| **URL** | `/auth/customer/emailpass/register` |
| **Принадлежность** | Medusa Auth API |
| **Авторизация** | Не требуется (publishable key не нужен) |

Тело: `{ "email": "<уникальный email>", "password": "<пароль>" }`.

```bash
curl -X POST "http://localhost:9000/auth/customer/emailpass/register" \
  -H "Content-Type: application/json" \
  --data-raw '{"email":"customer@example.com","password":"<пароль>"}'
```

```json
HTTP 200
{ "token": "<jwt>" }
```

Возможные коды: 200; **401** `unauthorized` `"Identity with email already exists"` — повторная регистрация существующего email (проверено); **429** `rate_limited` — превышен лимит попыток (IP 30/60 с, email 5/ч; этап 5.2.2). Штатная семантика ядра: повторный register с тем же email **и тем же паролем** до создания профиля идемпотентно возвращает существующую identity (resume-режим); **после создания профиля** — 401 при любом пароле. Выданный токен — actorless JWT: он создает профиль (маршрут 41), но **не авторизует покупателя** в маршрутах `/store/customers/*` (`GET /store/customers/me` с ним → 401 — авторизация только после входа, маршрут 42).

### 41. Регистрация покупателя: профиль

| | |
|---|---|
| **Назначение** | Создание customer profile и привязка его к auth identity (второй шаг регистрации) |
| **Метод** | `POST` |
| **URL** | `/store/customers` |
| **Авторизация** | Publishable API key + `Authorization: Bearer <actorless JWT с шага 40>` |

Тело: `{ "email": "<тот же email>", "first_name": "...", "last_name": "...", "phone": "..." (опционально) }`.

```bash
curl -X POST "http://localhost:9000/store/customers" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  --data-raw '{"email":"customer@example.com","first_name":"Анна","last_name":"Иванова"}'
```

```json
HTTP 200
{ "customer": { "id": "cus_01M8EQSDRMVA3C…", "email": "customer@example.com",
  "first_name": "Анна", "last_name": "Иванова", "phone": null,
  "has_account": true, "addresses": [], "metadata": null } }
```

Возможные коды: 200; **401** без токена (`{"message":"Unauthorized"}` — анонимное создание профиля невозможно, проверено); **422** `duplicate_error` `"Customer with this email already has an account"` — повторное создание профиля с тем же email (проверено).

### 42. Вход (JWT)

| | |
|---|---|
| **Назначение** | Аутентификация покупателя, получение JWT |
| **Метод** | `POST` |
| **URL** | `/auth/customer/emailpass` |
| **Авторизация** | Не требуется |

Тело: `{ "email": "...", "password": "..." }`. Ответ: `{ "token": "<jwt>" }` — JWT с `actor_type: "customer"` и `actor_id` (срок действия по умолчанию 24 ч — `jwtExpiresIn`, проверено по payload).

Возможные коды: 200; **401** `unauthorized` `"Invalid email or password"` — и для неверного пароля, и для несуществующего email (одинаковый ответ — **перечисление email через вход невозможно**, проверено); **429** `rate_limited` + `Retry-After` — превышен лимит попыток (этап 5.2.2: по IP 30/60 с, по email 5/15 мин; счетчик единый для любых email).

### 43. Сессия: обмен токена и выход

`POST /auth/session` с заголовком `Authorization: Bearer <jwt>` — обмен JWT на session cookie (для витрин, предпочитающих cookie; JWT при этом клиент больше не хранит):

```bash
curl -i -X POST "http://localhost:9000/auth/session" \
  -H "Authorization: Bearer <jwt>"
```

```text
HTTP 200
Set-Cookie: connect.sid=<opaque>; Path=/; HttpOnly
{"jwtExpiresIn": 86400}
```

Дальнейшие запросы идентифицируют покупателя cookie `connect.sid` (проверено: `GET /store/customers/me` с cookie без Bearer → 200). Без Bearer → 401.

`DELETE /auth/session` (с cookie) — **выход**: сессия отзывается, тот же cookie далее → 401 (проверено). JWT при этом остается действующим до истечения срока (stateless; проверено) — вышедший по сессии клиент с сохраненным JWT продолжает доступ.

### 44. Обновление JWT

`POST /auth/token/refresh` — выпуск нового JWT по действующему Bearer или session cookie → 200 `{ "token": "<новый jwt>" }` (проверено). С истекшим токеном → 401.

### 45. Сброс пароля: запрос токена

| | |
|---|---|
| **Метод** | `POST` |
| **URL** | `/auth/customer/emailpass/reset-password` |
| **Авторизация** | Не требуется |

Тело: `{ "identifier": "<email>" }`. Ответ — **201 без тела** для существующего и несуществующего email **одинаково** (перечисление email невозможно, проверено). Одноразовый reset-токен (TTL **15 минут**, `purpose: "reset"`, jti, атомарное поглощение при использовании — по исходникам 2.23) генерируется workflow и публикуется **событием `auth.password_reset`** (фактическое имя 2.23, подтверждено live-probe; имя `auth.password_reset_token_generated` из старых версий в 2.23 не эмитится). С этапа 5.2.3 токен доставляется письмом через штатный Notification Module (провайдер `notification-smtp`, шаблон `customer-password-reset`, ссылка `/reset-password?token=…&email=…`) — для существующих identity; несуществующий email события не порождает, письма нет. Архитектура — [docs/notifications.md](notifications.md). Возможные коды: 201; **429** `rate_limited` — превышен лимит (IP 30/60 с, identifier 3/ч — этап 5.2.2, одинаково для любых email).

### 46. Смена пароля

| | |
|---|---|
| **Метод** | `POST` |
| **URL** | `/auth/customer/emailpass/update` |
| **Авторизация** | Bearer **reset-токен** из шага 45 (не обычный JWT) |

Тело: `{ "password": "<новый пароль>" }` → 200 `{ "success": true }`. Обычный JWT (вход/refresh) отклоняется: **401** `"Invalid token"` (проверено) — маршрут принимает только токены `purpose: "reset"` с jti; токен одноразовый. Возможные коды: 200; 401; **429** `rate_limited` — превышен IP-лимит 30/60 с (этап 5.2.2).

### 47. Текущий покупатель

| | |
|---|---|
| **Метод** | `GET` |
| **URL** | `/store/customers/me` |
| **Авторизация** | Publishable API key + Bearer JWT или session cookie |

```json
HTTP 200
{ "customer": { "id": "cus_…", "email": "…", "company_name": null, "first_name": "…",
  "last_name": "…", "phone": "…", "metadata": null, "has_account": true,
  "addresses": [ … ], "created_at": "…", "updated_at": "…" } }
```

Дефолтные поля 2.23 (проверено): `id`, `email`, `company_name`, `first_name`, `last_name`, `phone`, `metadata`, `has_account`, `addresses[]` (полные объекты адресов с флагами `is_default_shipping`/`is_default_billing`). Поля `default_shipping_address_id`/`default_billing_address_id` в Store API-ответе **не возвращаются даже с явным `fields`** (проверено) — дефолты читаются по флагам адресов. Без авторизации → **401** `{"message":"Unauthorized"}`; с недействительным токеном → 401.

### 48. Изменение профиля

`POST /store/customers/me` — тело: частичное `{ first_name, last_name, phone, company_name, metadata }` → 200 с обновленным `customer` (проверено: имя/телефон сохраняются). **Email этим маршрутом не меняется**: поле `email` в теле отвергается валидатором ядра — 400 `invalid_data` «Unrecognized fields: 'email'» (проверено 5.3; email профиля идентифицирует transfer-семантику и историю заказов). Валюта покупателя маршрутом также не меняется.

### 49. Адреса покупателя

Все маршруты требуют publishable key + авторизацию покупателя. Дефолты доставки/выставления счета задаются флагами `is_default_shipping` / `is_default_billing` при создании.

**Создание** — `POST /store/customers/me/addresses`:

```bash
curl -X POST "http://localhost:9000/store/customers/me/addresses" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  --data-raw '{"first_name":"Анна","last_name":"Иванова","address_1":"ул. Тестовая, 5","city":"Москва","country_code":"ru","postal_code":"101000","is_default_shipping":true}'
```

Ответ — **200 с объектом `customer`** (не `address` — проверено): созданный адрес доступен в `customer.addresses[]`, дефолты — по флагам. Тело адреса: `first_name`, `last_name`, `company`, `address_1`, `address_2`, `city`, `province`, `postal_code`, `country_code`, `phone`, `metadata`, `is_default_shipping`, `is_default_billing`.

**Список** — `GET /store/customers/me/addresses` → 200 `{ "addresses": [...], "count": 2, "offset": 0, "limit": ... }` (только свои — фильтр по `customer_id` из auth context).

**Один адрес** — `GET /store/customers/me/addresses/{address_id}` → 200 `{ "address": { "id": "cuaddr_…", "city": "…", "is_default_shipping": true, … } }`; **чужой адрес (другого покупателя) → 404** `not_found` (проверено).

**Изменение** — `POST /store/customers/me/addresses/{address_id}` — частичное тело → 200 `{ "customer": … }` (проверено: город/индекс обновились).

**Удаление** — `DELETE /store/customers/me/addresses/{address_id}` → 200:

```json
{ "id": "<customer_id>", "object": "address", "deleted": true, "parent": { "customer": … } }
```

Возможные коды: 200; 404 (несуществующий/чужой адрес).

### 50. Привязка корзины к покупателю (claim)

| | |
|---|---|
| **Назначение** | Перенос гостевой корзины (с позициями) авторизованному покупателю — например, гость собрал корзину, затем вошел |
| **Метод** | `POST` |
| **URL** | `/store/carts/{id}/customer` |
| **Авторизация** | Publishable API key + Bearer JWT или session cookie |

```bash
curl -X POST "http://localhost:9000/store/carts/cart_01M8…/customer" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" --data-raw '{}'
```

```json
HTTP 200
{ "cart": { "id": "cart_01M8…", "customer_id": "cus_01M8EQSDRMVA…",
  "email": "customer@example.com", "items": [ …позиции сохранены… ] } }
```

Проверено: позиции и итоги **сохраняются** после claim; повторный claim тем же покупателем — 200 (идемпотентно). **Корзина, созданная под авторизацией, привязывается автоматически** (`POST /store/carts` с Bearer подставляет `customer_id` из auth context — проверено); для корзин, созданных до входа, нужен явный claim. Несколько корзин одного покупателя сосуществуют без ограничений (проверено).

**С этапа 5.2.1 claim защищен серверно** (`backend/src/api/middlewares/cart-access.ts`): привязать можно гостевую корзину (без владельца или с неявным покупателем `has_account: false`, которого ядро назначает при установке email) или свою собственную; присвоение чужой авторизованной корзины — 404. Проверка выполняется под тем же advisory-локом, что и complete (4.5), и повторяется после захвата: конкурентные claim/claim и claim/complete одной корзины сериализуются, победитель фиксирует владельца в транзакции workflow — конкурент получает 404; повторный claim своей корзины идемпотентен. Обход прямым вызовом Store API невозможен — middleware стоит на штатном маршруте.

### 51. История заказов покупателя

| | |
|---|---|
| **Метод** | `GET` |
| **URL** | `/store/orders` |
| **Авторизация** | Publishable API key + Bearer JWT или session cookie (**обязательна**) |

```json
HTTP 200
{ "orders": [ { "id": "order_…", "display_id": 33, "status": "pending",
  "email": "customer@example.com", "total": 5090, "currency_code": "rub", … } ],
  "count": 1, "offset": 0, "limit": 50 }
```

Список **с сервера фильтруется по `customer_id` из auth context** (требование приемки 4.4; проверено: покупатель B не видит заказы A; свежезарегистрированный покупатель с email гостевого заказа видит `count: 0`). Без авторизации → **401** `{"message":"Unauthorized"}`. Query: `limit`/`offset`, `fields`.

### 52. Заказ по ID и авторизованные заказы

`GET /store/orders/{id}` — **с этапа 5.2.1 доступ защищен серверной проверкой права** (реализация — [маршрут 39](#39-заказ-по-id) и официальный гайд Medusa «Restrict Order Retrieval»; middleware `order-access.ts` на штатном маршруте):

| Кто | Доступ |
|---|---|
| Владелец (Bearer/сессия) | 200 — свой заказ |
| Посторонний авторизованный покупатель | **404** (контролируемый отказ без раскрытия) |
| Неавторизованный запрос | **404** — голый order_id больше не авторизация |
| Гость с заголовком `x-cart-id` (корзина этого заказа) | 200 — подтвержденное право possession-типа |
| Заказ зарегистрированного покупателя + `x-cart-id` | **404** — proof открывает только гостевые заказы |

Заказ, оформленный авторизованным покупателем (claim → complete), в Store API-ответах не отличается от гостевого: `customer_id` не экспонируется; принадлежность видна через список (51) и Admin API (`fields=+customer_id`).

### 53. Перенос гостевого заказа (transfer)

Штатный механизм связывания ранее оформленных гостевых заказов с зарегистрированным покупателем. **С этапа 5.2.1 инициатор request/cancel проверяется серверно** (middleware `order-access.ts`): допустим только покупатель, чей email совпадает с email заказа (легитимная семантика Medusa «оформил гостем со своим email — забираю в аккаунт»); посторонний получает тот же 404, что и для несуществующего заказа, — ответ с полными данными заказа уходит только легитимному инициатору (закрывает утечку из аудита 5.1):

- `POST /store/orders/{id}/transfer/request` (Bearer покупателя; тело `{ "description": "..." (опц.), "update_order_email": bool (опц.) }`) → **200** `{ "order": … }`. Создает order change типа `transfer` (статус `requested`, токен-UUID внутри change-action), публикует событие `order.transfer_requested`; с этапа 5.2.3 токен доставляется **письмом на email заказа** через штатный Notification Module (провайдер `notification-smtp`, шаблон `order-transfer-request`, ссылка `/account/order-transfer?token=…&order_id=…` — см. [docs/notifications.md](notifications.md)); в API-ответе request токена нет (только письмо). Повторный request до завершения → **400** `invalid_data` `"Order (…) already has an active transfer request"` (проверено). **429** `rate_limited` — превышен лимит попыток (IP 30/60 с, покупатель 10/ч — этап 5.2.2).
- `POST /store/orders/{id}/transfer/cancel` (Bearer инициатора) → 200 — отменяет transfer change (проверено).
- `POST /store/orders/{id}/transfer/accept` — **без авторизации**, тело `{ "token": "<из письма>" }`; неверный токен → **400** `not_allowed` `"Invalid token."` (проверено).
- `POST /store/orders/{id}/transfer/decline` — аналогично, по токену.

**После accept доступ меняется (проверено 5.3)**: заказ принадлежит зарегистрированному покупателю — читается владельцем по JWT/сессии, а **гостевой proof `x-cart-id` больше не открывает заказ** (404, как и для любого заказа зарегистрированного покупателя); посторонний авторизованный — 404. До transfer (включая после регистрации с тем же email) proof продолжает работать. Токен подтверждения хранится в order change action (`details.token`, дублируется Admin API `GET /admin/orders/:id/changes`) и доставляется письмом на email заказа; одноразовый (повторный accept → 400).

### Безопасность авторизации и покупателей (проверено)

| Проверка | Результат |
|---|---|
| `GET /store/orders` без авторизации | **401** — история заказов требует JWT/сессию |
| Заказы покупателя A в списке покупателя B | **Отсутствуют** — серверный фильтр по `customer_id` из auth context |
| Профиль/адрес покупателя A из-под B | **Недоступны**: `/store/customers/me` всегда возвращает только себя; чужой `address_id` → 404 (чтение/изменение/удаление) |
| Email профиля через `POST /store/customers/me` | **Не меняется**: поле `email` → 400 `invalid_data` «Unrecognized fields» (валидатор ядра) |
| Actorless JWT регистрации на маршрутах покупателя | **401** — токен шага регистрации создает профиль, но не авторизует (`me` требует входа) |
| `GET /store/orders/:id` (чужой/без права доступа) | **404** с этапа 5.2.1: владелец — по авторизации, гость — по `x-cart-id` (маршрут 39/52); отказ неотличим от несуществующего заказа |
| Гостевой заказ после transfer accept | **Proof `x-cart-id` закрывается** (404) — заказ зарегистрированного покупателя читает только владелец (5.3) |
| Claim чужой корзины (`POST /store/carts/:id/customer`) | **404** с этапа 5.2.1: привязать можно гостевую или свою корзину; проверка под advisory-локом (конкурентные claim/claim, claim/complete сериализуются) |
| Чтение/изменение/complete чужой авторизованной корзины | **404** с этапа 5.2.1 на всех маршрутах `/store/carts/:id*` (middleware `cart-access.ts`) |
| Конкурентное изменение корзины во время claim | Владелец фиксируется атомарно, существующие позиции **не теряются**; изменение после фиксации владельца — 404 guard-а (5.3) |
| `transfer/request` чужого заказа | **404** с этапа 5.2.1 — инициатор только с email заказа; ответ с данными только легитимному |
| Customer JWT → `/admin/*` | **401** — разграничение акторов |
| Admin JWT → `/store/customers/me` | **401** — admin-токен не является customer-актором |
| Искаженный/недействительный JWT | **401** `{"message":"Unauthorized"}` |
| Перебор паролей (5×неверный вход) | **429 `rate_limited` + `Retry-After` с 6-й попытки** (этап 5.2.2: лимит email 5/15 мин, IP 30/60 с; 5×401 до лимита — как в аудите 5.1); лимит применяется до аутентификации, одинаков для любых email — перечисление невозможно; блокировка временная (окно истекает само), аккаунт не блокируется навсегда |
| Перечисление email (вход / сброс пароля) | **Невозможно**: одинаковые ответы 401 (вход) и 201 (сброс) для существующих/несуществующих email |
| Выход (`DELETE /auth/session`) | Отзывает **сессию**; JWT остается действующим до истечения (stateless) |
| Смена пароля | Только по одноразовому reset-токену (TTL 15 мин, атомарное поглощение); обычный JWT → 401 |

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

### Гостевой checkout (проверенная последовательность, этап 4)

```text
 1. GET  /store/regions                                            → регион/валюта
 2. POST /store/carts {region_id}                                   → корзина (канал из publishable key)
 3. POST /store/carts/:id/line-items {variant_id, quantity} (×N)   → позиции, серверные цены
 4. POST /store/carts/:id/line-items/:line_id {quantity}            → изменение количества
    DELETE /store/carts/:id/line-items/:line_id                     → удаление позиции
 5. POST /store/carts/:id {email, shipping_address}                 → контактные данные и адрес
 6. POST /store/carts/:id/promotions {promo_codes:[...]}            → скидка (активные промоушены)
 7. GET  /store/shipping-options?cart_id=:id                       → доступные способы доставки
    POST /store/carts/:id/shipping-methods {option_id}              → выбранная доставка
 8. GET  /store/payment-providers?region_id=:region                → pp_system_default
    POST /store/payment-collections {cart_id}                       → collection (amount = total)
    POST /store/payment-collections/:pc/payment-sessions
         {provider_id:"pp_system_default"}                          → сессия (pending)
 9. POST /store/carts/:id/complete                                  → {type:"order", order}
    (авторизация pp_system_default происходит здесь)
10. GET  /store/orders/:order_id                                   → подтверждение заказа
```

Серверные требования complete: payment collection с сессией и способ доставки для позиций `requires_shipping`; email обязателен только на уровне витрины (шаг 5 рекомендуется выполнять до создания payment collection, чтобы сумма платежа соответствовала финальной корзине).

### Checkout авторизованного покупателя (этап 5)

```text
 0. Регистрация/вход (при необходимости):
    POST /auth/customer/emailpass/register → actorless JWT → POST /store/customers
    POST /auth/customer/emailpass → JWT (или POST /auth/session → cookie)
 1–8. Те же шаги, что и гостевой checkout (выше);
    корзина, созданная под Bearer/cookie, получает customer_id автоматически
    (или явный claim: POST /store/carts/:id/customer — позиции сохраняются)
 9. POST /store/carts/:id/complete {}            → заказ (с customer_id покупателя)
10. GET  /store/orders (Bearer)                   → история: только свои заказы
    GET  /store/orders/:id                        → конкретный заказ: владелец —
                                                    по JWT/сессии (гостевой заказ —
                                                    по праву x-cart-id, этап 5.2.1)
```

Гостевые заказы, оформленные до регистрации (даже с тем же email), в истории не появляются — их переносят штатным transfer (маршрут 53); после accept заказ читает только владелец.

---

## Что будет добавлено на следующих этапах

- Этап 5 (завершение): 5.3 — интеграционные тесты авторизации и покупателей ✅ (28.11.2026, `store-auth-customers.spec.ts`, 14 тестов); 5.3.1 — серверная защита платежных коллекций и сессий ✅ (28.11.2026, middleware `payment-access.ts`, +5 тестов); 5.4 — приемка этапа.
- Этап 6 (обновлен 28.11.2026, решение №40): демонстрационные способы оплаты на штатном Payment Module (тестовая онлайн-оплата, оплата при получении), тесты жизненного цикла платежа (успех/отказ/отмена/возврат), запрет фиктивной онлайн-оплаты в production, `docs/payments.md` — руководство по самостоятельному подключению реальных платежных сервисов (реальные интеграции исключены из V1); базовая доставка сохранена.
- Этапы 9–10: группы Commerce Client/composables и страницы витрины (каталог, корзина, checkout, авторизация, личный кабинет; страницы писем — `/reset-password`, `/account/order-transfer` — контракт ссылок в [docs/notifications.md](notifications.md)).

Каждый новый модуль обязан сопровождаться разделом в этом файле.

## Admin API: уведомления (штатный, этап 5.2.3)

С этапа 5.2.3 в БД появляются строки уведомлений (штатный Notification Module); их читает штатный Admin API (только администраторы):

- `GET /admin/notifications` (Bearer JWT администратора) — список уведомлений; фильтры `to`, `template`, `trigger_type`, `resource_id`, `channel`; поля по умолчанию включают `data` (в нем хранятся одноразовые токены, необходимые для отправки письма; Store API уведомления не раскрывает — см. «Ограничения безопасности» в [docs/notifications.md](notifications.md)).
- `GET /admin/notifications/{id}` — одно уведомление.

Витрина этот API не использует; публикуется здесь для полноты контракта этапа 5.2.3.

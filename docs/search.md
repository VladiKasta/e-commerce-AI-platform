# Поиск (Meilisearch, этап 3)

Поисковая подсистема каталога: полнотекстовый поиск, подсказки, поиск по артикулу и фасетная фильтрация поверх Meilisearch 1.58. Все примеры ниже проверены на живом окружении (27.11.2026, Medusa 2.23.0, индекс `store_products_v4`, 30 документов / 12 товаров).

Связанные документы: модель фильтров и характеристик — [filters.md](filters.md); индексация и восстановление — [indexing.md](indexing.md); справочник всех маршрутов — [api.md](api.md).

---

## Содержание

- [Архитектура поиска](#архитектура-поиска)
- [Роль Medusa Search Module и Meilisearch](#роль-medusa-search-module-и-meilisearch)
- [Полнотекстовый поиск](#полнотекстовый-поиск)
- [Поисковые подсказки](#поисковые-подсказки)
- [Поиск по SKU](#поиск-по-sku)
- [Настройки поискового индекса](#настройки-поискового-индекса)
- [Синонимы, стоп-слова, опечатки](#синонимы-стоп-слова-опечатки)
- [Примеры HTTP-запросов и ответов](#примеры-http-запросов-и-ответов)
- [Ограничения текущей реализации](#ограничения-текущей-реализации)

---

## Архитектура поиска

```text
Браузер / SSR витрины
        │  GET /store/catalog, /store/search, /store/search/suggestions
        │  (x-publishable-api-key; Medusa Store API)
        ▼
┌─────────────────────────────────────────────────────────────┐
│ Medusa (backend)                                            │
│                                                             │
│  api/store/{catalog,search,search/suggestions}/route.ts     │
│      └─ CatalogSearchService (src/services/catalog-search)  │
│          ├─ реестр характеристик: модуль catalog_attributes │
│          ├─ регион/валюта: модуль Region                    │
│          ├─ канал продаж: контекст publishable API key      │
│          ├─ активная версия индекса: search_index (PG)      │
│          └─ MeilisearchProviderService (наш провайдер)      │
│                 │ multi-search (page-режим, distinct)       │
└─────────────────┬───────────────────────────────────────────┘
                  ▼
          Meilisearch 1.58 (физические индексы store_products_vN)
```

Компоненты:

| Компонент | Файл | Ответственность |
|---|---|---|
| Маршруты Store API | `backend/src/api/store/{catalog,search,search/suggestions}/route.ts` | Парсинг query, контракт ошибок; бизнес-логики не содержат |
| `CatalogSearchService` | `backend/src/services/catalog-search.ts` | Единственная точка поисковой логики: валидация параметров, построение фильтров, disjunctive-фасеты, точные счетчики, сборка ответа |
| Определение индекса | `backend/src/search/products.ts` | Схема документа, настройки Meilisearch, события, seed/consume (официальный `defineSearchIndex`) |
| Провайдер Meilisearch | `backend/src/modules/search-meilisearch/providers/meilisearch/` | Реализация контракта `ISearchProvider`: CRUD индексов, запись/удаление документов, поиск и multi-search (fetch-клиент, без внешних зависимостей) |
| Резолвер активной версии | `CatalogSearchService.resolveActivePhysicalNameFromModule` | Читает активную ready-версию из таблиц Search Module (`search_index.active_version`) через `PG_CONNECTION` |
| Job сверки | `backend/src/jobs/search-index-reconcile.ts` | Периодическая сверка PG ↔ индекс и точечный ремонт (см. [indexing.md](indexing.md)) |

Ключевые архитектурные решения (обоснования — [ARCHITECTURE.md](ARCHITECTURE.md), решения №11–16, 20, 24 журнала):

- **Документ = вариант × валюта** с `distinctAttribute: product_id` — единственная модель, дающая вариант-ориентированную фильтрацию (цвет+размер+наличие одного варианта) и точную пагинацию по товарам.
- **Точные счетчики уникальных товаров** — отдельными count-запросами в одном multi-search вызове: `facetDistribution` Meilisearch при distinct считает «представителей» дедупликации, а не товары (проверено на живом индексе).
- **Индекс выбирается только по подтверждению** из таблиц Search Module; эвристика «максимальный номер версии» исключена — строящаяся версия существует до активации.

## Роль Medusa Search Module и Meilisearch

**Medusa Search Module (официальный, 2.23)** владеет жизненным циклом индекса:

- версионированные физические индексы (`store_products_v1`, `_v2`, …) и атомарное переключение активной версии (swap);
- встроенный ingestion-конвейер: события → `consume` определения индекса → мутации документов;
- seeding при старте (boot-seeding), `reindex({filters})` для частичной переиндексации in-place, `deleteDocuments({filters})`;
- хранение активной версии в собственных таблицах (`search_index`, `search_index_version`).

Собственный код — только провайдер Meilisearch и определение индекса; коммерческая логика Medusa не дублируется (правило №1 AGENTS.md).

**Meilisearch** — производная проекция каталога, поисковый движок. PostgreSQL остается единственным источником истины: **точные рассчитанные цены, остатки и данные карточки товара витрина обязана читать через штатный `/store/products`**, а не из поискового ответа. Поисковый документ служит для выдачи, фильтрации, сортировки и фасетов.

Каталог-сервис не использует `searchModule.search()`: валидатор полей Search Module отклоняет динамические пути `attributes.<code>`, не объявленные в статической схеме (обход задокументирован в [filters.md](filters.md)). Поиск выполняется напрямую через публичный конструктор нашего провайдера, активная версия — через публичный `getIndex()` модуля + SQL-резолвер ready-версии.

## Полнотекстовый поиск

`GET /store/search?q=...` — тот же контракт ответа `{products, pagination, facets, sortOptions}`, что и каталог; параметр `q` обязателен.

Механика (Meilisearch 1.58, проверено):

- searchable-поля: `title`, `description`, `sku`, вложенный объект `attributes` (поиск по всем значениям характеристик через `searchable_parents: ["attributes"]`);
- русский язык поддерживается штатным токенайзером; кириллица в query-параметрах должна быть percent-encoded (браузеры и Medusa JS SDK делают это автоматически, сырой curl — нет);
- поиск по неполному слову (префикс последнего слова): `q=футб` находит и «футб**олка**», и «фут**ер**» (слово в описании свитшота);
- опечатки: одна опечатка для слов ≥ 4 символов, две — ≥ 8 (`minWordSizeForTypos`); на `sku` опечатки отключены;
- релевантность определяется порядком `searchableAttributes`: `title` → `description` → `sku` → `attributes`.

Пример (живой ответ, сокращено):

```bash
curl -G "http://localhost:9000/store/search" \
  --data-urlencode "q=фудболка" \
  --data-urlencode "limit=3" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

```json
{
  "products": [
    { "id": "prod_01M87JXH5RP3Y4PPCAC5KG3RRF", "title": "Футболка «Простая»", "handle": "futbolka-prostaya", "sku": "TEE-BASIC-OS", "price": { "amount": 990, "currency_code": "rub" }, "in_stock": true, "...": "..." }
  ],
  "pagination": { "total": 3, "limit": 3, "offset": 0, "hasMore": false },
  "facets": [],
  "sortOptions": ["relevance", "price_asc", "price_desc", "newest", "title_asc"]
}
```

Запрос с опечаткой («фудболка» вместо «футболка») находит все 3 футболки демо-каталога — total: 3.

## Поисковые подсказки

`GET /store/search/suggestions?q=...` — typeahead: до 8 уникальных товаров (distinct по `product_id`), извлекаются `product_id`, `title`, `handle`, `sku`. Тот же полнотекстовый механизм (префикс, опечатки, синонимы), без фасетов и пагинации. Пустой `q` → 400.

```bash
curl -G "http://localhost:9000/store/search/suggestions" \
  --data-urlencode "q=футб" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Реальный ответ (27.11.2026):

```json
{
  "suggestions": [
    { "text": "Футболка «Простая»", "product_id": "prod_01M87JXH5RP3Y4PPCAC5KG3RRF", "handle": "futbolka-prostaya", "sku": "TEE-BASIC-OS" },
    { "text": "Футболка «Медуза»", "product_id": "prod_01M87JXH5RQG8G7NCBAQME8JPG", "handle": "futbolka-meduza", "sku": "TEE-MED-L-WHT" },
    { "text": "Футболка «Кракен»", "product_id": "prod_01M87JXH5RRF8TKCG71D97EC4H", "handle": "futbolka-kraken", "sku": "TEE-KRAKEN-L" },
    { "text": "Свитшот «Атлантика»", "product_id": "prod_01M87JXH5RKASP3P59Z9P2NNB7", "handle": "svitshot-atlantika", "sku": "SWEAT-ATL-M" }
  ]
}
```

Четвертая подсказка найдена по слову «футер» в описании — подсказки не ограничены названием товара.

## Поиск по SKU

`sku` — полноценное searchable-поле (артикулы вариантов, попавшие в документы как `sku` документа):

```bash
curl -G "http://localhost:9000/store/search" \
  --data-urlencode "q=HOODIE-POL" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

Реальный ответ: `total: 2` — `HOODIE-POL-L` (худи «Полярное») и `HOODIE-MED-S` (худи «Медуза»); префиксное совпадение `HOODIE-POL` находит артикул без полной строки. Особенности:

- опечатки на `sku` **отключены** (`disabled_on_attributes: ["sku"]`) — артикулы ищутся строго;
- `sku` также filterable — используется провайдером и сверью (`docs/fetch`), в Store API фильтра по SKU нет (не требуется этапом);
- подсказки включают артикул — typeahead срабатывает и по SKU.

## Настройки поискового индекса

Определены в `backend/src/search/products.ts` (`defineSearchIndex`), применяются провайдером при создании/обновлении физического индекса. Фактические настройки живого индекса `store_products_v4` (проверено запросом `GET /indexes/{uid}/settings`, 27.11.2026):

| Настройка | Значение | Назначение |
|---|---|---|
| `searchableAttributes` | `["title", "description", "sku", "attributes"]` | Полнотекстовый поиск; порядок задает релевантность; `attributes` покрывает все динамические характеристики |
| `filterableAttributes` | `product_id`, `status`, `sku`, `currency_code`, `price`, `in_stock`, `category_ids`, `category_handles`, `collection_ids`, `collection_handles`, `sales_channel_ids`, `attributes` | Фильтрация и фасеты; родительский объект `attributes` делает фильтруемыми все вложенные поля — **новые характеристики не требуют изменения настроек** |
| `sortableAttributes` | `["created_at", "price", "title", "updated_at"]` | Сортировки `price_asc/price_desc`, `newest`, `title_asc` |
| `distinctAttribute` | `product_id` | Выдача сгруппирована по товарам; page-пагинация возвращает точный `totalHits` |
| `typoTolerance` | `enabled: true`, oneTypo: 4, twoTypos: 8, `disableOnAttributes: ["sku"]` | Опечатки кроме SKU |
| `faceting.maxValuesPerFacet` | `100` | Верх per-facet распределения (точные счетчики не зависят от лимита) |
| `pagination.maxTotalHits` | `5000` | Предел выдачи Meilisearch |
| `stopWords` | из `MEILISEARCH_STOP_WORDS` (по умолчанию `["и","в","с","для","на"]`) | См. ниже |
| `synonyms` | из `MEILISEARCH_SYNONYMS` (по умолчанию `{}`) | См. ниже |

Способ применения настроек: при создании новой физической версии индекса (boot-seeding, `make search-reindex`), а также планом миграций `make search-init`. Изменение настроек не требует изменения кода характеристик — динамические поля покрыты родительским объектом.

## Синонимы, стоп-слова, опечатки

**Стоп-слова** — `MEILISEARCH_STOP_WORDS` (корневой `.env`). Формат — JSON-массив строк; при отсутствии/пустом значении применяется встроенный набор по умолчанию `["и", "в", "с", "для", "на"]`:

```bash
MEILISEARCH_STOP_WORDS=["и","в","с","для","на","the","a"]
```

**Синонимы** — `MEILISEARCH_SYNONYMS`. Формат — JSON-объект `слово → массив синонимов` (двунаправленные синонимы Meilisearch):

```bash
MEILISEARCH_SYNONYMS={"худи":["толстовка","свитшот"],"кружка":["маг"]}
```

Правила применения (реализовано в `parseJsonEnv` определения индекса, провайдер передает значения в `settings.stopWords`/`settings.synonyms`):

- значения читаются при загрузке определения индекса (старт процесса Medusa);
- **некорректный JSON не роняет загрузку**: используется значение по умолчанию, в логи пишется предупреждение `[search] MEILISEARCH_... содержит некорректный JSON`;
- применения к физическому индексу: пересоздание версии (`make search-reindex`) либо план миграций `make search-init` — настройки входят в определение индекса;
- проверить фактическое состояние: `GET /indexes/store_products_vN/settings` внутри Docker-сети (см. [indexing.md](indexing.md), диагностика). На живом индексе `stopWords: ["в","для","и","на","с"]` подтверждены 27.11.2026.

**Опечатки** настраиваются в самом определении индекса (не через env): `min_word_size_for_one_typo: 4`, `min_word_size_for_two_typos: 8`, отключение на `sku`. Настройка `typo_tolerance` Search Module транслируется провайдером в `typoTolerance` Meilisearch.

## Примеры HTTP-запросов и ответов

Полный справочник параметров/ошибок — [api.md](api.md) (маршруты №12–14). Здесь — проверенные сценарии.

### Каталог с фасетами (GET /store/catalog)

```bash
curl "http://localhost:9000/store/catalog?limit=2" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

```json
{
  "products": [
    {
      "id": "prod_01M87JXH5R6WX9T1HH0G6DG3EA",
      "variant_id": "variant_01M87JXH78C4ESGHPEMMCBHZWA",
      "title": "Худи «Полярное»",
      "description": "Утепленное худи для холодного сезона. Высокий ворот, плотный трикотаж.",
      "handle": "hudi-polyarnoe",
      "sku": "HOODIE-POL-L",
      "thumbnail": null,
      "price": { "amount": 4590, "currency_code": "rub" },
      "in_stock": true,
      "category_handles": ["hoodies"],
      "collection_handles": ["eko"],
      "attributes": { "brand": "north-polar", "material": ["polyester", "cotton"], "rating": 4.7, "eco": true, "size": "L" }
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
      { "value": "deep-sea", "label": "Deep Sea", "count": 3, "selected": false },
      { "value": "urban-basic", "label": "Urban Basic", "count": 3, "selected": false },
      { "value": "north-polar", "label": "North Polar", "count": 2, "selected": false }
    ]}
  ],
  "sortOptions": ["relevance", "price_asc", "price_desc", "newest", "title_asc"]
}
```

Счетчики фасета `brand` суммируются ровно в `pagination.total` (4+3+3+2 = 12) — счетчики точные, по уникальным товарам.

### OR внутри фильтра, AND между фильтрами

```bash
curl "http://localhost:9000/store/catalog?filter%5Bbrand%5D=deep-sea,urban-basic&limit=6" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

`total: 6` (3 товара Deep Sea + 3 Urban Basic — OR внутри одного фильтра). Комбинация `filter[brand]=...&filter[size]=M` — AND между разными фильтрами.

### Disjunctive-пересчет фасетов

```bash
curl "http://localhost:9000/store/catalog?filter%5Bcolor%5D=%D0%A7%D1%91%D1%80%D0%BD%D1%8B%D0%B9&filter%5Bsize%5D=M&in_stock=true" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
```

`total: 0` (критический сценарий вариант-ориентированной фильтрации — у футболки «Медуза» варианта Чёрный/M нет в наличии), при этом фасет size в ответе пересчитан **без** собственного фильтра: `S: 2 (count 2, selected: false)`, `M: 0 (selected: true)` — выбранное значение доступно для снятия, остальные значения считаются с учетом остальных фильтров.

### Ошибки

| HTTP | Тело (реальное) | Причина |
|---|---|---|
| 400 | `{"type":"invalid_query","message":"Неизвестная характеристика в фильтре: nope"}` | Код не из реестра характеристик |
| 400 | `{"type":"invalid_query","message":"limit должен быть целым числом от 1 до 100"}` | Неверный тип параметра |
| 503 | `{"type":"search_unavailable","message":"Поисковый сервис временно недоступен..."}` | Meilisearch недоступен |
| 400 | `{"type":"not_allowed","message":"Publishable API key required..."}` | Нет/неверен заголовок ключа |

## Ограничения текущей реализации

1. **Цены в индексе** — минимальная цена варианта в валюте (региональные записи одной валюты и прайс-листы сведены к одной величине): фильтрация/сортировка корректны, точная рассчитанная цена — только через `/store/products`.
2. **Лимиты запросов** (`CATALOG_LIMITS`): `limit` ≤ 100 (по умолчанию 24), `offset` ≤ 10 000, до 10 фасетов, до 25 значений на фасет, длина `q` ≤ 128 символов.
3. **Диапазонный фасет `price`** — min/max без бакетов (гистограмма не реализована); числовые характеристики (`rating`) — тоже min/max.
4. **`pagination.maxTotalHits: 5000`** Meilisearch — глубокая пагинация за пределами 5000 документов одной валютой не поддерживается (демо-каталог далеко от предела).
5. **Фасетные count-запросы** — на каждое значение фасета выполняется отдельный count-подзапрос (в одном multi-search): на больших каталогах с широкими фасетами время ответа растет с числом значений (см. [indexing.md](indexing.md), производительность).
6. **Активная версия индекса** определяется SQL-запросом к внутренней схеме Search Module (`search_index`) — при изменении схемы модулем в следующих версиях Medusa резолверу требуется адаптация; публичного API активной версии у модуля нет. При недоступности служебного запроса сервис деградирует к последней подтвержденной ready-версии, при её отсутствии — HTTP 503.
7. **Сверка индекса** читает сырые документы master key-ом Meilisearch (Meilisearch запрещает изменять `actions` существующих API-ключей; право `documents.get` нельзя выдать провижинированным ключам) — внутренняя серверная операция, ключ не покидает backend (подробнее — [indexing.md](indexing.md)).
8. **Подсказки** не поддерживают фильтры/фасеты — всегда по всему каталогу канала и валюты магазина; таргетинг по категории отсутствует.
9. **Highlighting** (подсветка совпадений) реализован провайдером, но маршруты каталога его не запрашивают — в ответе нет `_formatted`-полей.
10. **Флаг `searchable` характеристики** хранится и редактируется, но индексатором не потребляется: все характеристики попадают в поисковый объект `attributes` независимо от флага (техдолг, см. [PROGRESS.md](PROGRESS.md)).
11. `in_stock=false` означает «есть хотя бы один отсутствующий вариант» (согласовано со счетчиком фасета), а не «полностью распродан» (см. [filters.md](filters.md), семантика in_stock).
12. Кириллица в query-параметрах требует percent-encoding на уровне HTTP-клиента (curl `-G --data-urlencode`).

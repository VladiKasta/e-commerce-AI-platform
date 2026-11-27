# Checkout: практическое руководство для разработчика storefront

Гостевой заказ в магазине на Medusa v2 — полный цикл от пустой корзины до подтверждения заказа через **штатный Store API** (без собственных маршрутов backend; аудит этапа 4.1 и интеграционные тесты 4.3 подтвердили достаточность). Справочник маршрутов с параметрами и кодами ошибок — [docs/api.md](api.md), раздел «Корзина, checkout и заказы» (маршруты 28–39). Интеграционные тесты полного цикла — `storefront/tests/integration/store-cart-checkout.spec.ts` (`make test`).

Базовый URL в примерах: `http://localhost:9000` (`MEDUSA_PUBLIC_URL`).

---

## Содержание

- [Предусловия](#предусловия)
- [Полная последовательность запросов](#полная-последовательность-запросов)
- [Обязательные заголовки и параметры](#обязательные-заголовки-и-параметры)
- [Серверный расчет стоимости](#серверный-расчет-стоимости)
- [Промокоды и скидки](#промокоды-и-скидки)
- [Обработка ошибок](#обработка-ошибок)
- [Недостаточные остатки](#недостаточные-остатки)
- [Повторное завершение и конкуренция](#повторное-завершение-и-конкуренция)
- [Особенности гостевого покупателя](#особенности-гостевого-покупателя)
- [Безопасное хранение идентификаторов](#безопасное-хранение-идентификаторов)
- [Требования, зафиксированные для последующих этапов](#требования-зафиксированные-для-последующих-этапов)

---

## Предусловия

1. **Publishable API key** — заголовок `x-publishable-api-key` обязателен для всех `/store/*` (ключ публичен по определению Medusa, хранится в `MEDUSA_PUBLISHABLE_KEY`). Без ключа и с некорректным ключом — HTTP 400 `not_allowed` (не 401).
2. **Регион** — `GET /store/regions` → первый регион (в seed — «Россия», валюта `rub`). Регион определяет валюту, цены вариантов и доступные способы доставки/платежей.
3. **Вариант товара** — `GET /store/products?handle=…&region_id=…&fields=+*variants.calculated_price` → `variants[].id` и рассчитанная цена. Витрина всегда добавляет товар в корзину по `variant_id`, не по товару.
4. **Суммы** — в основных денежных единицах: `4590` = 4590 ₽. Деление на 100 не выполняется.

## Полная последовательность запросов

Проверенная последовательность полного гостевого checkout (все ответы реальные, живое окружение):

```text
 1. GET  /store/regions                                        → регион, валюта
 2. POST /store/carts {region_id}                              → корзина (sales_channel_id из ключа)
 3. POST /store/carts/:id {email, shipping_address}            → контактные данные и адрес
 4. POST /store/carts/:id/line-items {variant_id, quantity}    → позиция, серверная цена
    POST /store/carts/:id/line-items/:line_id {quantity}       → изменение количества
    DELETE /store/carts/:id/line-items/:line_id                → удаление позиции
 5. POST /store/carts/:id/promotions {promo_codes:[…]}         → скидка (активные промоушены)
 6. GET  /store/shipping-options?cart_id=:id                   → доступные способы доставки
    POST /store/carts/:id/shipping-methods {option_id}         → выбранная доставка
 7. POST /store/payment-collections {cart_id}                  → collection (amount = total корзины)
    POST /store/payment-collections/:pc/payment-sessions
         {provider_id:"pp_system_default"}                    → сессия (pending)
 8. POST /store/carts/:id/complete {}                          → {type:"order", order}
 9. GET  /store/orders/:order_id                              → подтверждение заказа (payment_status)
```

Порядок шагов 3–6 гибкий; обязательное правило — **payment collection создается после всех изменений состава** (его `amount` фиксируется по `total` корзины на момент создания), а complete требует: позицию, способ доставки (если позиции `requires_shipping`) и payment collection с сессией. Email рекомендуется сохранить до создания collection (см. [особенности гостевого покупателя](#особенности-гостевого-покупателя)).

### Реальные примеры

**Создание корзины** (без `sales_channel_id` — канал подставляется из publishable key; ключ витрины связан только с каналом «Веб-витрина», задача 4.2):

```bash
curl -X POST "http://localhost:9000/store/carts" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  --data-raw '{"region_id":"reg_01M87JXH28ZWDP5S4FJTY79RPF"}'
```

```json
{ "cart": { "id": "cart_01M8ENBW8HNV3W2C8XF8KQ434Z", "currency_code": "rub",
  "region_id": "reg_01M87JXH28ZWDP5S4FJTY79RPF",
  "sales_channel_id": "sc_01M87JXH172AS6PG13N2QSWNPG",
  "email": null, "items": [],
  "subtotal": 0, "item_subtotal": 0, "discount_total": 0, "shipping_total": 0, "tax_total": 0, "total": 0 } }
```

**Контактные данные и адрес**:

```bash
curl -X POST "http://localhost:9000/store/carts/cart_01M8…" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  --data-raw '{"email":"guest-4-3@example.com","shipping_address":{"first_name":"Иван","last_name":"Гость","address_1":"ул. Тестовая, 1","city":"Москва","country_code":"ru","postal_code":"101000"}}'
```

```json
{ "cart": { "email": "guest-4-3@example.com",
  "shipping_address": { "first_name": "Иван", "last_name": "Гость", "address_1": "ул. Тестовая, 1",
    "city": "Москва", "postal_code": "101000", "country_code": "ru" } } }
```

**Позиция и серверные итоги** (цена каталога 390 ₽ совпадает с `unit_price`):

```json
{ "cart": { "items": [ { "id": "cali_01M8ENDG0VHYY00FZ3W8YKAJ8B", "title": "Стикерпак «Море»",
  "quantity": 2, "unit_price": 390, "requires_shipping": true } ],
  "item_subtotal": 780, "subtotal": 780, "discount_total": 0, "shipping_total": 0, "total": 780 } }
```

**Доставка** (`GET /store/shipping-options?cart_id=…` возвращает seed-опции seed: «Стандартная доставка» 500 ₽ и «Экспресс-доставка» 990 ₽, провайдер `manual_manual`):

```json
{ "cart": { "shipping_total": 500, "item_subtotal": 1170, "subtotal": 1670, "total": 1670 } }
```

**Платеж** (провайдер `pp_system_default` доступен из коробки; `GET /store/payment-providers?region_id=…` подтверждает):

```json
{ "payment_collection": { "id": "pay_col_01M8ENDGMSWG9R2YM60QCCVSQV", "amount": 1670, "currency_code": "rub" } }
```

```json
{ "payment_collection": { "payment_sessions": [ { "provider_id": "pp_system_default",
  "status": "pending", "amount": 1670 } ] } }
```

**Завершение** — `POST /store/carts/:id/complete` c телом `{}`:

```json
{ "type": "order",
  "order": { "id": "order_01M8ENDGPY4DZXMYGAZSX4A0E6", "display_id": 4, "status": "pending",
    "email": "guest-4-3@example.com", "currency_code": "rub",
    "item_subtotal": 1170, "subtotal": 1670, "shipping_total": 500,
    "discount_total": 0, "tax_total": 0, "total": 1670,
    "items": [ { "title": "Стикерпак «Море»", "quantity": 3, "unit_price": 390,
                 "subtotal": 1170, "total": 1170 } ] } }
```

**Подтверждение заказа** — `GET /store/orders/:order_id` (тем же publishable key, без авторизации):

```json
{ "order": { "id": "order_01M8…", "display_id": 4, "status": "pending",
  "payment_status": "authorized", "total": 1670 } }
```

## Обязательные заголовки и параметры

| Что | Где | Обязательность | Примечание |
|---|---|---|---|
| `x-publishable-api-key` | все `/store/*` | да | иначе 400 `not_allowed` |
| `region_id` | создание корзины | да | определяет валюту/цены/доставку/платежи |
| `sales_channel_id` | создание корзины | нет | подставляется из ключа; передавать не нужно (ключ витрины связан с одним каналом) |
| `variant_id`, `quantity` | добавление позиции | да | `quantity ≥ 1`; цена передавать нельзя |
| `option_id` | выбор доставки | да | из `GET /store/shipping-options?cart_id=` |
| `cart_id` | payment collection | да | создается после финального состава корзины |
| `provider_id` | payment session | да | `pp_system_default` (системный провайдер) |

## Серверный расчет стоимости

- **Цена назначается сервером**: `items[].unit_price` = `calculated_price.calculated_amount` каталога для региона. Попытка передать `unit_price` в payload → 400 `invalid_data` «Unrecognized fields: 'unit_price'» — позиция не добавляется, корзина не меняется.
- **Все итоги серверные**: `item_subtotal`, `discount_total`, `shipping_total`, `tax_total`, `total` пересчитываются после каждой операции (позиции, промокод, доставка).
- **Особенность Medusa 2.23**: `subtotal` корзины и заказа **включает доставку** (`subtotal = item_subtotal + shipping_subtotal`). «Итог без доставки» — поле `item_subtotal`.
- **Суммы позиции** (`items[].subtotal`, `total`, `discount_total`, `adjustments`) в дефолтном ответе равны `null` — запросите явно: `?fields=+items.subtotal,+items.discount_total,+items.total,+items.adjustments`.

## Промокоды и скидки

- **Применение**: `POST /store/carts/:id/promotions` с телом `{ "promo_codes": ["КОД"] }` (массив). Применяются только промоушены со `status: "active"`; скидка и `adjustments` считает сервер.
- Пример (10% на каждую единицу, `allocation: "each"`, `max_quantity: 5`, 3 × 390 ₽):

```json
{ "cart": { "promotions": [ { "code": "TEST43A…" } ],
  "items": [ { "quantity": 3, "unit_price": 390, "subtotal": 1170,
               "discount_total": 117, "total": 1053,
               "adjustments": [ { "code": "TEST43A…", "amount": 117 } ] } ],
  "discount_total": 117, "total": 1053 } }
```

- **Неактивный (`draft`) промокод** принимается молча: 200, код не привязывается, скидки нет. Витрина должна сообщать пользователю «промокод не применен», если `promotions` в ответе не содержит код.
- **Несуществующий код** → 400 `invalid_data` «The promotion code … is invalid».
- **Снятие**: `DELETE /store/carts/:id/promotions` с тем же телом; повторное снятие — 200 (идемпотентно). После изменения состава корзины скидка пересчитывается автоматически.

## Обработка ошибок

Формат ошибки Medusa: `{ "type": "…", "message": "…" }` (у inventory-ошибок дополнительно `"code": "insufficient_inventory"`). Проверенные сценарии:

| Сценарий | HTTP | Тело (реальное) |
|---|---|---|
| Нет publishable key | 400 | `not_allowed` «Publishable API key required in the request header: …» |
| Некорректный ключ | 400 | `not_allowed` «A valid publishable key is required to proceed with the request» |
| Подмена цены (`unit_price` в payload) | 400 | `invalid_data` «Invalid request: Unrecognized fields: 'unit_price'» |
| `quantity: -1` (и `0`) | 400 | `invalid_data` «Value for field 'quantity' too small, expected at least: '0'» |
| Несуществующий вариант | 400 | `invalid_data` «Variants variant_… do not exist or belong to a product that is not published» |
| Остатка недостаточно | 400 | `{"code":"insufficient_inventory","type":"not_allowed","message":"Some variant does not have the required inventory"}` |
| Несуществующий промокод | 400 | `invalid_data` «The promotion code … is invalid» |
| complete без payment collection | 400 | `invalid_data` «Payment collection has not been initiated for cart» |
| complete без сессии | 400 | `invalid_data` «Payment sessions are required to complete cart» |
| complete без доставки | 400 | `invalid_data` «No shipping method selected but the cart contains items that require shipping.» |
| Параллельный complete той же корзины дольше 30 с | 409 | `conflict` «Cart is already being completed by another request» (короткие параллельные запросы не конфликтуют: второй дожидается и получает тот же заказ — см. [конкуренция](#повторное-завершение-и-конкуренция)) |

Практические правила для витрины:

- Отвергнутый запрос **не меняет корзину** (проверено: после серии 400 позиций в корзине нет) — достаточно показать сообщение и оставить пользователя на том же шаге.
- При `insufficient_inventory` предложите выбор варианта в наличии: актуальное наличие читается из каталога (`/store/catalog`, фасет `in_stock`) или пересчетом корзины.

## Недостаточные остатки

Сервер проверяет наличие при добавлении и при изменении количества: доступный остаток = `stocked_quantity − reserved_quantity` (завершенные заказы резервируют инвентарь). Два проявления одной ошибки 400 `insufficient_inventory`:

- вариант с нулевым остатком (в seed: `TEE-MED-M-BLK`, `LONG-MED-M-BLK` — критический сценарий фильтрации);
- количество больше доступного остатка (в том числе у вариантов в наличии).

## Повторное завершение и конкуренция

- **Последовательное повторное complete идемпотентно**: завершенной корзине маршрут отвечает **200 с тем же заказом** (`{"type":"order","order":{"id": <тот же>}}`); дубликат не создается (проверено тестами 4.3, `GET /admin/orders?id=…` count=1).
- **Серверная сериализация (этап 4.5)**: backend держит межпроцессную блокировку по `cart_id` (транзакционный advisory-лок PostgreSQL через Locking Module, штатный middleware на самом маршруте `POST /store/carts/:id/complete`) на весь запрос — от проверки состояния корзины до коммита workflow и отправки ответа. Два одновременных complete одной корзины **создают ровно один заказ**: второй запрос дожидается освобождения и получает существующий заказ через штатную идемпотентность. Разные корзины оформляются параллельно.
- **Освобождение гарантировано**: лок — транзакционный (`pg_advisory_xact_lock`), PostgreSQL снимает его сам при коммите, откате и при падении процесса/обрыва соединения; «зависших» блокировок не остается (проверено: таблица `locking` пуста, ошибка complete не блокирует следующий запрос).
- Если блокировка занята дольше 30 секунд (незавершающееся оформление той же корзины), маршрут отвечает **409 CONFLICT** `"Cart is already being completed by another request"` (тот же контракт, что у ядра для параллельного complete).
- Защита работает на уровне штатного маршрута — обойти ее прямым вызовом Store API нельзя. Витрине все равно рекомендуется блокировать повторную отправку на время запроса (UX: пользователь не ждет и не дублирует клики), но корректность теперь обеспечена сервером.
- Предыстория: до этапа 4.5 два одновременных complete создавали два заказа (гонка `completeCartWorkflow` в Medusa 2.23.0: внутренний `releaseLockStep` снимал лок до коммита транзакции) — дефект закрыт серверной сериализацией, регрессия покрыта тестом `store-cart-checkout.spec.ts` (Promise.allSettled).

## Особенности гостевого покупателя

- **Email сервером не требуется**: complete и `GET /store/orders/:id` работают без него. Но email нужен для подтверждения заказа и переноса заказа покупателю на этапе 5 — витрина обязана собрать и сохранить его до complete (рекомендуется до создания payment collection, чтобы заказ и платеж содержали email).
- **Неявная запись customer**: при complete Medusa автоматически создает customer с `has_account: false` и email гостя; заказ ссылается на него. В Store API-ответах заказа `customer_id` **отсутствует** — связь видна только в Admin API с `fields=+customer_id`. Для витрины гость остается анонимом; на этапе 5 штатные механизмы (claim корзины при входе, transfer заказа `/store/orders/:id/transfer/*`) привяжут заказ к зарегистрированному покупателю.
- **Модель доступа**: гостевая корзина и заказ адресуются непредсказуемыми ULID (`cart_…`/`order_…`) без дополнительной авторизации — это модель безопасности Medusa для гостей. Идентификатор выполняет роль секрета (см. ниже).
- `payment_status` заказа доступен прямо в Store API (`"authorized"` для `pp_system_default` — авторизация происходит неявно при complete; отдельного store-маршрута авторизации сессии в 2.23 нет).

## Безопасное хранение идентификаторов

`cart_id` гостя — единственный «секрет» его корзины, `order_id` — его заказа: любой, знающий id, может читать и изменять корзину/читать заказ тем же publishable key. Требования к витрине (этапы 9–10):

- Хранить `cart_id` **только на серверной стороне** сессии пользователя: httpOnly-cookie (Nuxt `useCookie` на сервере) или server-side session; никогда — в localStorage.
- Не помещать `cart_id`/`order_id` в URL строкой запроса (логи, Referer, история браузера): страница подтверждения заказа берет id из cookie/session, а не из query.
- Завершенный заказ: после complete удалить/заменить сохраненный `cart_id` (повторный complete вернет тот же заказ, но держать его не нужно).
- Страница подтверждения заказа — `noindex`.

## Требования, зафиксированные для последующих этапов

Не реализованы на этапе 4 (за пределами этапа), зафиксированы в [ROADMAP.md](ROADMAP.md) и [PROGRESS.md](PROGRESS.md):

1. **Серверная валидация обязательного email** — Medusa не требует email серверно; витрина обязана валидировать и сохранять email до complete (этапы 9–10); при доказанной необходимости — минимальное серверное расширение с обоснованием в PROGRESS.
2. **Проверка принадлежности заказов покупателю** — этап 5 (авторизация): зарегистрированный покупатель видит только свои заказы; перенос гостевых заказов — только штатным механизмом transfer.
3. **Безопасное хранение cart_id** — этап 9 (composables корзины): httpOnly-cookie/серверная сессия, без localStorage и URL.
4. **Изолированная тестовая БД** — автотесты этапов 8/10 выполняются на изолированной БД (не на dev/production-данных).
5. **Отсутствие накопления тестовых заказов в production** — интеграционные тесты checkout не запускаются против production; test-заказы не создаются в рабочей БД.
6. **Налоги и фискализация** — настройка tax rates и фискальных чеков (54-ФЗ) — этап 6 вместе с реальными платежными провайдерами (ЮKassa, Т-Банк).

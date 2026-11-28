# Авторизация и покупатели: руководство для разработчика

Этап 5 (V1). Практическое руководство по штатным Auth и Customer API Medusa 2.23.0: регистрация, вход, сессии, профиль, адреса, корзина покупателя, история заказов, перенос гостевого заказа и модель безопасности. Собственных auth-механизмов, таблиц покупателей и JWT-логики проект не создает — весь функционал штатный (принцип Medusa First, Custom Last; аудит 5.1 в [PROGRESS.md](PROGRESS.md)).

Справочник маршрутов с параметрами и кодами — [docs/api.md](api.md) (разделы 40–53, «Авторизация и покупатели»). Практический сценарий checkout — [docs/checkout.md](checkout.md). Доставка одноразовых токенов письмом — [docs/notifications.md](notifications.md). Переменные окружения (rate limiting, JWT/сессии) — [docs/configuration.md](configuration.md). Интеграционные тесты всего изложенного: `storefront/tests/integration/store-auth-customers.spec.ts` (14), `store-auth-security.spec.ts` (15), `store-auth-ratelimit.spec.ts` (6), `store-auth-notifications.spec.ts` (3) — `make test`.

Официальная документация: [Authenticate Customers](https://docs.medusajs.com/resources/storefront-development/customer/login), [Customer Registration](https://docs.medusajs.com/resources/storefront-development/customer/register), [Reset Password](https://docs.medusajs.com/resources/storefront-development/customer/reset-password), [Store API: Auth](https://docs.medusajs.com/api/store), [Restrict Order Retrieval](https://docs.medusajs.com/resources/commerce-modules/order/secure-order-retrieval).

---

## Содержание

- [Архитектура авторизации](#архитектура-авторизации)
- [Регистрация в два шага](#регистрация-в-два-шага)
- [JWT и session-based авторизация](#jwt-и-session-based-авторизация)
- [Жизненный цикл токенов: login, refresh, logout](#жизненный-цикл-токенов-login-refresh-logout)
- [Восстановление пароля через email](#восстановление-пароля-через-email)
- [Профиль покупателя и адреса](#профиль-покупателя-и-адреса)
- [Привязка корзины: claim и авто-привязка](#привязка-корзины-claim-и-авто-привязка)
- [Заказы: авторизованный checkout и история](#заказы-авторизованный-checkout-и-история)
- [Перенос гостевого заказа (transfer)](#перенос-гостевого-заказа-transfer)
- [Обработка ошибок](#обработка-ошибок)
- [Ограничения безопасности](#ограничения-безопасности)
- [Контракты composables этапа 9](#контракты-composables-этапа-9)
- [Серверное хранение credentials (Nitro BFF)](#серверное-хранение-credentials-nitro-bff)

---

## Архитектура авторизации

```text
Браузер/Nuxt SSR ──► /auth/customer/*   (вход, регистрация, refresh, сессия, reset)
                 ──► /store/customers/*  (профиль, адреса; publishable key + JWT/cookie)
                 ──► /store/carts/:id*  (claim, авто-привязка; guards 5.2.1/5.3.1)
                 ──► /store/orders*    (история, transfer; серверный фильтр/guards)

Ядро Medusa 2.23:                    Серверные расширения проекта:
  Auth Module (emailpass, JWT 24 ч)    cart-access.ts   — владелец авторизованной корзины
  Customer Module                      order-access.ts   — право на заказ/transfer
  Session store Redis (10 ч)           payment-access.ts — платежные коллекции/сессии
  События (auth.password_reset,        auth-rate-limit.ts — rate limiting (Redis)
  order.transfer_requested)            Notification Module + notification-smtp (5.2.3)
```

Ключевые свойства (все проверены живыми запросами и тестами):

- **Два способа авторизации**: JWT (Bearer, 24 ч) и session cookie (`connect.sid`, HttpOnly, Redis, 10 ч; Secure+SameSite=lax автоматически в production). Оба принимаются всеми маршрутами покупателя.
- **Маршруты `/auth/*` не требуют publishable API key**; для `/store/*` он обязателен (400 без ключа).
- **Изоляция данных**: `/store/customers/me*` всегда возвращает только своего покупателя; список `/store/orders` серверно фильтруется по `customer_id` из auth context; чужие адреса/корзины/заказы/платежи — контролируемый 404 (guards 5.2.1/5.3.1).
- **Rate limiting** на вход/регистрацию/сброс/смену пароля/запрос transfer (429 + `Retry-After`, до аутентификации, без раскрытия email) — этап 5.2.2.
- **Одноразовые токены** (reset 15 мин, transfer-UUID) доставляются письмом через штатный Notification Module — этап 5.2.3.

## Регистрация в два шага

Штатная регистрация Medusa — auth identity отдельно от профиля покупателя:

```bash
# Шаг 1: создать auth identity (email+пароль). Publishable key не нужен.
curl -X POST "http://localhost:9000/auth/customer/emailpass/register" \
  -H "Content-Type: application/json" \
  --data-raw '{"email":"customer@example.com","password":"<пароль>"}'
```

```json
HTTP 200
{ "token": "<actorless JWT>" }
```

```bash
# Шаг 2: создать профиль покупателя по actorless JWT (publishable key обязателен)
curl -X POST "http://localhost:9000/store/customers" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer <actorless JWT>" -H "Content-Type: application/json" \
  --data-raw '{"email":"customer@example.com","first_name":"Анна","last_name":"Иванова"}'
```

```json
HTTP 200
{ "customer": { "id": "cus_01M8EQSDRMVA3C…", "email": "customer@example.com",
  "first_name": "Анна", "last_name": "Иванова", "has_account": true,
  "addresses": [], "metadata": null } }
```

Семантика ядра (закреплена тестами 5.3):

| Сценарий | Результат |
|---|---|
| Повторный register, тот же email, **другой пароль** | **401** `"Identity with email already exists"` |
| Повторный register, тот же email и **тот же пароль**, профиль еще не создан | **200** — штатный идемпотентный resume (та же identity) |
| Register после создания профиля (любой пароль) | **401** |
| Повторное создание профиля (`POST /store/customers`) | **422** `duplicate_error` `"Customer with this email already has an account"` |
| Actorless JWT на маршрутах покупателя (`GET /store/customers/me`) | **401** — токен регистрации не авторизует; нужен вход |

## JWT и session-based авторизация

**JWT** — вход `POST /auth/customer/emailpass` (`{email, password}`) → `{"token": "<jwt>"}` (TTL 24 ч, `actor_type: customer`). Передается заголовком `Authorization: Bearer …`.

**Сессия** — обмен JWT на cookie:

```bash
curl -i -X POST "http://localhost:9000/auth/session" \
  -H "Authorization: Bearer <jwt>"
```

```text
HTTP 200
Set-Cookie: connect.sid=<opaque>; Path=/; HttpOnly
{"jwtExpiresIn": 86400}
```

Дальнейшие запросы идентифицируют покупателя cookie — Bearer не нужен. Оба способа равнозначны для всех маршрутов покупателя; выбирайте один (рекомендация — сессия через серверный BFF, см. [ниже](#серверное-хранение-credentials-nitro-bff)).

## Жизненный цикл токенов: login, refresh, logout

```text
register ──► actorless JWT (только для создания профиля)
login ─────► customer JWT (24 ч, stateless) ──► refresh ──► новый JWT
                │
                └─ POST /auth/session ──► connect.sid (HttpOnly, Redis, 10 ч)
                                              │
                                    DELETE /auth/session ──► сессия отозвана
```

- **Login**: `POST /auth/customer/emailpass` → 200 `{token}`; неверный пароль и несуществующий email — **одинаковый 401** `"Invalid email or password"` (перечисление email невозможно).
- **Refresh**: `POST /auth/token/refresh` с действующим Bearer/cookie → 200 `{token}` (новый JWT; в ту же секунду может совпасть байт-в-байт — одинаковые iat/payload). Без токена — 401.
- **Logout**: `DELETE /auth/session` (с cookie) → сессия отзывается, cookie больше не работает. **JWT stateless — продолжает работать до истечения** (побуждайте клиент удалить его; отзыв по токену ядром не предусмотрен).
- Просроченный/недействительный JWT — 401 `{"message":"Unauthorized"}` (мусорный, искаженная подпись — тесты 5.3; просроченный проверяется на приемке 8.5 в изолированном окружении).

## Восстановление пароля

```bash
# 1. Запрос токена — одинаковый 201 для существующего/несуществующего email
curl -X POST "http://localhost:9000/auth/customer/emailpass/reset-password" \
  -H "Content-Type: application/json" \
  --data-raw '{"identifier":"customer@example.com"}'
```

Сброс эмитирует штатное событие `auth.password_reset` (только для существующих identity); письмо с одноразовой ссылкой `{SITE_URL}/reset-password?token=…&email=…` отправляет Notification Module ([docs/notifications.md](notifications.md) — шаблоны, Mailpit, повторная доставка).

```bash
# 2. Установка нового пароля по одноразовому reset-токену из письма (Bearer — сам токен)
curl -X POST "http://localhost:9000/auth/customer/emailpass/update" \
  -H "Authorization: Bearer <reset-токен>" -H "Content-Type: application/json" \
  --data-raw '{"password":"<новый пароль>"}'
```

```json
HTTP 200
{ "success": true }
```

Свойства (тесты `store-auth-notifications.spec.ts`): токен одноразовый (повторное использование — 401), TTL 15 минут, атомарное поглощение; обычный JWT маршрут не принимает (401 `"Invalid token"`); старый пароль после смены не работает; несуществующий email письма не порождает.

## Профиль покупателя и адреса

Текущий покупатель — `GET /store/customers/me` (Bearer или cookie; без авторизации — 401):

```json
{ "customer": { "id": "cus_…", "email": "…", "company_name": null,
  "first_name": "Анна", "last_name": "Иванова", "phone": null,
  "has_account": true, "addresses": [ … ], "metadata": null } }
```

- **Изменение профиля** — `POST /store/customers/me` (частичное тело: `first_name`, `last_name`, `phone`, `company_name`, `metadata`) → 200 `{customer}`. **Email этим маршрутом не меняется** — поле отвергается валидатором ядра: 400 `invalid_data` «Unrecognized fields: 'email'».
- **Адреса** — CRUD на `/store/customers/me/addresses`: создание (тело адреса + флаги `is_default_shipping`/`is_default_billing`) → 200 `{customer}` (адрес в `customer.addresses`); список → `{addresses, count}` (только свои); чтение `GET …/addresses/{id}` → `{address}`; изменение `POST …/addresses/{id}` → `{customer}`; удаление `DELETE` → `{id, object: "address", deleted: true, parent}`; удаленный и **чужой** адрес → 404 (чтение/изменение/удаление).
- **Адреса по умолчанию**: флаг проставляется при создании; новый адрес с тем же флагом **снимает флаг со старого** (ровно один default shipping/billing; `default_*_address_id` в Store API не экспонируются — читайте флаги адресов).
- Изменить чужой профиль маршрутом нельзя — `/store/customers/me` всегда оперирует покупателем из auth context.

## Привязка корзины: claim и авто-привязка

Сценарий «гость собрал корзину, затем вошел» (штатный `transferCartCustomerWorkflow`):

```bash
curl -X POST "http://localhost:9000/store/carts/cart_01M8…/customer" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" --data-raw '{}'
```

```json
HTTP 200
{ "cart": { "id": "cart_01M8…", "customer_id": "cus_01M8EQSDRMVA3C…",
  "email": "customer@example.com", "items": [ …позиции сохранены… ] } }
```

- Позиции и итоги **сохраняются**; повторный claim тем же покупателем — 200 (идемпотентно).
- **Авто-привязка**: корзина, созданная `POST /store/carts` под Bearer, сразу получает `customer_id` из auth context — claim не нужен.
- **Защита (5.2.1)**: привязать можно гостевую корзину (без владельца или с неявным покупателем `has_account: false`) или свою; чужую авторизованную — 404. Проверка выполняется под тем же advisory-локом, что complete (4.5): конкурентные claim/claim и claim/complete сериализуются, конкурентное изменение корзины во время claim не теряет позиции (тесты 5.3).
- После claim корзина наследует защиту владельца: неавторизованные и посторонние запросы к ней (и к её платежным коллекциям — 5.3.1) получают 404.

## Заказы: авторизованный checkout и история

Последовательность авторизованного checkout — [docs/checkout.md](checkout.md) (шаги 1–9 те же, что гостевой; корзина под Bearer привязывается автоматически или через claim). Заказ получает `customer_id` покупателя; Store API-ответ заказов `customer_id` не экспонирует (виден списком и Admin API).

```bash
# История — только свои заказы (серверный фильтр ядра по auth context)
curl "http://localhost:9000/store/orders?limit=50" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $JWT"
```

```json
{ "orders": [ { "id": "order_…", "display_id": 33, "status": "pending",
  "email": "customer@example.com", "total": 5090, "currency_code": "rub" } ],
  "count": 1, "offset": 0, "limit": 50 }
```

- Без авторизации — 401; заказы другого покупателя в списке отсутствуют.
- `GET /store/orders/:id` — по подтвержденному праву (владелец по JWT/сессии; гостевой заказ — по `x-cart-id`); посторонний и неавторизованный — 404, неотличимый от несуществующего.
- **Гостевые заказы не наследуются** при регистрации с тем же email (`count: 0`) — их переносит только штатный transfer.

## Перенос гостевого заказа (transfer)

Легитимный сценарий Medusa: заказ оформлен гостем на свой email → пользователь регистрируется → забирает заказ в аккаунт.

```bash
# 1. Запрос переноса — только покупатель, чей email = email заказа (guard 5.2.1)
curl -X POST "http://localhost:9000/store/orders/order_01M8…/transfer/request" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" --data-raw '{}'
```

Ответ — 200 `{order}` (полные данные заказа — только легитимному инициатору; посторонний — 404). Повторный request до завершения — 400 `"already has an active transfer request"`. Токен-подтверждение уходит **письмом на email заказа** (шаблон `order-transfer-request`, ссылка `{SITE_URL}/account/order-transfer?token=…&order_id=…` — [docs/notifications.md](notifications.md)); в Store API-ответе токена нет.

```bash
# 2. Подтверждение по одноразовому токену из письма (без авторизации)
curl -X POST "http://localhost:9000/store/orders/order_01M8…/transfer/accept" \
  -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" --data-raw '{"token":"<из письма>"}'
```

- После accept заказ появляется в истории покупателя; **гостевой доступ по `x-cart-id` закрывается** (заказ зарегистрированного покупателя читает только владелец — тесты 5.3).
- `transfer/cancel` — отмена инициатором; `transfer/decline` — отказ по токену; неверный токен — 400 `not_allowed` `"Invalid token."`; повторный accept — 400 (одноразовость).

## Обработка ошибок

Формат ошибок Medusa — `{type, message}`; торговые коды не отличаются от гостевых. Фактические ответы авторизации (тесты 5.2–5.3):

| HTTP | `type` | Когда | Тело (реальное) |
|---|---|---|---|
| 401 | — | Неверный email/пароль; несуществующий email (вход) | `{"message":"Invalid email or password"}` (одинаково) |
| 401 | — | Нет/недействительный токен, actorless JWT на me | `{"message":"Unauthorized"}` / `"Invalid token"` (update по обычному JWT) |
| 404 | `not_found` | Чужая корзина/заказ/адрес/платеж; заказ без права | `"Cart with id '…' not found"` / `"Order with id: … was not found"` — контролируемый отказ без раскрытия |
| 422 | `duplicate_error` | Повторное создание профиля | `"Customer with this email already has an account"` |
| 429 | `rate_limited` | Превышен лимит попыток (5.2.2) | `{"type":"rate_limited",…}` + заголовок `Retry-After`; email/пароли не раскрываются |
| 400 | `invalid_data` | Повторный transfer request; email в теле профиля | `"…already has an active transfer request"` / `"Unrecognized fields: 'email'"` |

Практические правила: отвергнутый запрос не меняет состояние; одинаковые ответы для существующих/несуществующих email (вход 401, сброс 201) не позволяют перечислять аккаунты; 429 — всегда временный (окно скользящее, TTL истекает сам).

## Ограничения безопасности

Защита серверная (guards 5.2.1/5.3.1 + rate limiting 5.2.2), витрина не отвечает за корректность:

- **JWT не отзывается logout-ом** (stateless, до 24 ч) — выход означает отзыв сессии; при shared-устройстве срок ограничен TTL.
- **Reset-/transfer-токены в query string** страниц витрины (`/reset-password?token=…`) — попадают в логи/историю браузера; усиление (обмен токена на серверной сессии) — техдолг 8.5.
- **Гостевая модель**: гостевая корзина/заказ адресуются непредсказуемыми id (ULID) — это штатная модель Medusa; `cart_id` — секрет и подтвержденное право чтения гостевого заказа → хранить только серверно ([docs/checkout.md](checkout.md)).
- **IP-бакеты rate limiting** за NAT/прокси общие; `AUTH_RATE_LIMIT_TRUST_PROXY=true` — только за перезаписывающим XFF прокси (этап 10). Недоступность Redis — fail-open (лимит пропускается).
- **Письма**: получатель определяется сервером; перечисление email через письма/ответы невозможно; токены не логируются. Хранение токенов в `notification.data` и конкурентность retry job — техдолг 8.5.
- Полная таблица проверок — [docs/api.md](api.md), «Безопасность авторизации и покупателей (проверено)».

## Контракты composables этапа 9

Требования зафиксированы приемкой 5.4; реализация — этап 9 (Frontend Commerce Client), не раньше. Общие принципы — [docs/composables.md](composables.md) (SSR-совместимость, `useState`, без серверных секретов в браузере). Транспорт — существующий Commerce Client ([docs/commerce-client.md](commerce-client.md)) + серверный BFF для credentials (следующий раздел).

| Composable | Ответственность | Используемые API | Ограничения |
|---|---|---|---|
| **`useAuth()`** | Статус авторизации (`loggedIn`, `customer` из `me`), login, register (два шага), logout, refresh; отправка credentials только через серверный BFF (Nitro), никогда — из браузера напрямую с секретами в localStorage | `POST /auth/customer/emailpass{,/register}`, `POST /auth/session`, `DELETE /auth/session`, `POST /auth/token/refresh`, `GET /store/customers/me` | Пароли не хранятся ни в state, ни в cookies, ни в payload SSR; JWT/session-cookie — только HttpOnly (сервер); не выставляет токены в `useState`/payload |
| **`useCustomer()`** | Профиль (`me`), обновление (`first_name/last_name/phone/company_name/metadata`), адреса CRUD и дефолты (`is_default_shipping/is_default_billing`) | `/store/customers/me`, `/store/customers/me/addresses` (+`/:id`) | Только свои данные (API сам фильтрует); email не редактируется (400) — не предлагать поле в UI; ошибки нормализуются в `CommerceError` |
| **`useOrders()`** | История заказов (пагинация `limit/offset`), чтение своего заказа по id | `GET /store/orders`, `GET /store/orders/:id` | Без авторизации не вызывается (401 — ожидаемый кейс «гость»); гостевые заказы — только через transfer-флоу, не «подгружать» их в историю |
| **`useCart()`** | Текущая корзина (создание при необходимости), позиции, промокоды; **cart_id — серверно** (httpOnly cookie/сессия Nuxt, без localStorage/URL); claim корзины после входа | `POST /store/carts`, `/store/carts/:id*`, `POST /store/carts/:id/customer` | Авторизованная корзина обслуживается с JWT/cookie сервера; после claim обновляет customer_id; полный контракт — [docs/checkout.md](checkout.md) |
| **`useCheckout()`** | Шаги checkout (email/адрес → доставка → payment collection/session → complete), блокировка повторной отправки complete, страница подтверждения (заказ из ответа complete; повторное чтение — `x-cart-id` для гостя) | Последовательность [docs/checkout.md](checkout.md); `POST /store/payment-collections*` | email обязателен до complete (витрина валидирует — сервер нет); после complete заменять сохраненный cart_id; сумма/наличие — только серверные |
| **`usePayment()`** | Доступные провайдеры региона, выбор провайдера, статусы платежа заказа (`payment_status`) | `GET /store/payment-providers`, `POST /store/payment-collections`, `…/payment-sessions` (+update `client_data`); этап 6 добавит демо-провайдеров | Платежные данные адресуются через коллекцию корзины — сервер сам проверит право (5.3.1); client_data не содержит секретов; реальные провайдеры — после V1 ([ROADMAP](ROADMAP.md), этап 6) |

## Серверное хранение credentials (Nitro BFF)

Требование приемки 5.4 для этапа 9: **JWT, session credentials и cart_id не хранятся в браузере**. Vitрина реализует тонкий серверный слой Nitro (Nuxt Server API/BFF):

- **HttpOnly cookies**: Medusa-сессия `connect.sid` проходит сквозь (или пересоздается сервером Nuxt из JWT, полученного login-ом на сервере); JWT и cart_id живут в httpOnly-cookie/серверной сессии Nuxt (`useCookie` на сервере, `useSession`), никогда — в localStorage и URL.
- **BFF-маршруты** (`/api/auth/*`, `/api/checkout/*`): login/register/refresh/logout и все операции с credentials выполняет сервер Nuxt (внутренняя сеть `NUXT_MEDUSA_URL`), браузер получает/теряет только HttpOnly cookie. Браузерные запросы без credentials (каталог, чтение корзины через BFF) — по публичному URL.
- Зачем: JWT stateless не отзывается (утечка из localStorage необратима до 24 ч); `cart_id` — секрет и подтвержденное право чтения гостевого заказа и платежей (5.3.1); session cookie уже HttpOnly — сквозная схема не создает новых секретов в браузере.
- Детали хранения cart_id — [docs/checkout.md](checkout.md) («Безопасное хранение идентификаторов»); общая схема Nuxt↔Medusa — [docs/ARCHITECTURE.md](ARCHITECTURE.md).

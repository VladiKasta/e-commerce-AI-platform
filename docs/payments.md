# Платежи: демонстрационные провайдеры и подключение собственных

Этап 6.2 (V1). Платежная основа Starter Kit — **штатный Payment Module Medusa** (`@medusajs/medusa/payment`, аудит 6.1 — [PROGRESS.md](PROGRESS.md)): жизненный цикл payment collection → session → payment, статусы, ограничения сумм, идемпотентность и webhook-и — ядро Medusa 2.23.0. Собственный платежный модуль и таблицы платежей **не создаются**; демо-провайдеры реализуют штатный контракт `AbstractPaymentProvider` (решение №41 в [PROGRESS.md](PROGRESS.md)). Реальные интеграции (ЮKassa, Т-Банк и др.) исключены из V1 (решение №40) — подключаются разработчиком самостоятельно по разделу [«Подключение собственного провайдера»](#подключение-собственного-провайдера).

Справочник маршрутов — [docs/api.md](api.md) (раздел «Корзина, checkout и заказы», маршруты 37–38; раздел «Платежи: Admin API и webhook», маршруты 54–59). Последовательность checkout — [docs/checkout.md](checkout.md).

---

## Содержание

- [Архитектура](#архитектура)
- [Способы оплаты](#способы-оплаты)
- [Статусы и жизненный цикл](#статусы-и-жизненный-цикл)
- [Конфигурация](#конфигурация)
- [Тестовые сценарии демо-провайдера](#тестовые-сценарии-демо-провайдера)
- [Webhook демо-провайдера](#webhook-демо-провайдера)
- [Production-ограничения](#production-ограничения)
- [Upstream-особенности Medusa 2.23 (аудит 6.1)](#upstream-особенности-medusa-223-аудит-61)
- [Подключение собственного провайдера](#подключение-собственного-провайдера)

---

## Архитектура

```text
Store API (витрина)                    Admin API / Medusa Admin
  POST /store/payment-collections        POST /admin/payments/:id/capture
  POST …/payment-sessions (37)          POST /admin/payments/:id/refund
  POST /store/carts/:id/complete        POST /admin/orders/:id/cancel
        │                               POST …/payment-sessions/authorize
        ▼                                        │
  completeCartWorkflow ── авторизация ──► Payment Module (штатный)
  (последний шаг)                            │
        ▲                                   ├─ pp_cod_cash      (наш модуль, контракт)
        │                                   ├─ pp_demo_online   (наш модуль, контракт)
  POST /hooks/payment/:provider ──► payment-webhook (штатный подписчик)
  (штатный webhook-маршрут 59)             └─ pp_system_default (системный, служебный)
        │
        └──► processPaymentWorkflow (штатный): автозавершение корзины,
             автокапчур, дооформление отложенной авторизации
```

- **Демо-провайдеры** — модули `backend/src/modules/payment-cod/` и `backend/src/modules/payment-demo-online/`, регистрируются в `medusa-config.ts` (модуль `@medusajs/medusa/payment`, опция `providers`); каждый — класс `AbstractPaymentProvider` с `static identifier` и минимальной реализацией контракта. Идентификаторы: `pp_{identifier}_{config id}` → `pp_cod_cash`, `pp_demo_online`.
- **Вся платежная бизнес-логика — штатная**: суммы и границы списаний (capture ≤ авторизованной суммы, refund ≤ captured), идемпотентность (повторный authorize возвращает существующий payment; повторный полный capture — no-op; refund по `idempotency_key`; конкурентные операции — `SELECT … FOR UPDATE`), пересчет коллекции при изменении корзины (ядро удаляет сессии и обновляет `amount`), запрет замены авторизованной сессии. Провайдеры собственную логику сумм не дублируют.
- **Служебный `pp_system_default`** — системный провайдер Medusa: используется внутренним `mark-as-paid` (маршрут 58), покупателю **не предлагается** (seed не связывает его с регионом). Не удаляйте его регистрацию — он нужен ядру.

## Способы оплаты

### Оплата при получении (`pp_cod_cash`, доступен в production)

Способ для офлайн-оплаты при вручении заказа. Семантика статусов — ключевой момент:

| Момент | `payment_status` заказа | `captured_at` | `summary.paid_total` | Интерпретация |
|---|---|---|---|---|
| Заказ оформлен (complete) | `authorized` | `null` | `0` | Техническая авторизация: она обязательна для completeCartWorkflow и **не означает получение денег** |
| Деньги получены (Capture в Medusa Admin) | `captured` (частичное списание — `partially_captured`) | заполнен | сумма | Администратор подтвердил получение наличных |
| Возврат | `partially_refunded` / `refunded` | — | — | **Ручная финансовая операция** (возврат наличных из кассы), деньги не отправляются покупателю автоматически |
| Отмена неоплаченного заказа | `canceled` | — | `0` | Штатный `POST /admin/orders/:id/cancel` отменяет uncaptured-платеж автоматически |

- `authorizePayment` провайдера всегда возвращает `authorized` — это ТЕХНИЧЕСКАЯ авторизация сессии; витрина обязана маркировать способ как «оплата при получении» и не показывать «оплачено» для статуса `authorized` этого способа.
- Подтверждение оплаты — штатный Capture (кнопка в Medusa Admin на платеже заказа, маршрут 55); частичный Capture фиксирует частичное получение суммы.
- Возврат (маршрут 56) — запись ручной операции; для COD деньги возвращаются покупателю вне системы (наличными при вручении/после), Medusa фиксирует бухгалтерию.

### Тестовая онлайн-оплата (`pp_demo_online`, только development/test)

Фиктивный провайдер для воспроизводимого тестирования полного жизненного цикла (этап 6.5 и локальная разработка); **денег не двигает**. Исход выбирается при создании сессии полем `data.outcome` (или через `client_data` до авторизации):

| `outcome` | Поведение `authorizePayment` | Результат complete | Заказ |
|---|---|---|---|
| `success` (по умолчанию) | `authorized` | 200 | `payment_status: authorized`, деньги не списаны (как реальный эквайринг до capture) |
| `decline` | throw `MedusaError` | 400 `not_allowed` «Demo payment declined (outcome=decline)» | не создается |
| `pending` | `pending_authorization` (штатная отложенная авторизация) | 200 | `payment_status: awaiting`, платеж не создан; подтверждение — подписанный webhook |

Суммы при capture/refund — штатные административные операции (маршруты 55–56); провайдер их подтверждает безусловно, границы контролирует ядро.

## Статусы и жизненный цикл

Подробная схема (коллекция/сессия/платеж/заказ) и фактическое поведение операций — [docs/api.md](api.md), раздел «Жизненный цикл платежа и статусы (проверено)». Краткая цепочка заказа:

```text
authorized (заказ оформлен, деньги не получены)
  → частичный Capture → partially_captured → полный Capture → captured
  → частичный Refund → partially_refunded → полный Refund → refunded
отмена заказа: uncaptured → canceled (авто-отмена платежа); captured → авто-refund
отложенная авторизация (demo pending): awaiting → webhook authorized → authorized
```

## Конфигурация

| Переменная | Значение | Обязательна | Назначение |
|---|---|---|---|
| `PAYMENT_DEMO_WEBHOOK_SECRET` | — | да (вне production; `[auto]` — генерируется `make init`) | Секрет HMAC webhook-а демо-провайдера. Только backend (`x-medusa-env` compose); в storefront не передается; в production не используется (провайдер не регистрируется). Минимум 16 символов (validate-env). |

Регистрация провайдеров — `backend/medusa-config.ts` (модуль `@medusajs/medusa/payment`):

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: {
    webhook_delay: 1_000, // задержка обработки webhook-а (штатный дефолт 5000 мс)
    providers: [
      { resolve: "./src/modules/payment-cod/providers/cod", id: "cash", options: {} },
      // pp_demo_online — только вне production (условная регистрация):
      ...(process.env.NODE_ENV !== "production"
        ? [{ resolve: "./src/modules/payment-demo-online/providers/demo",
             id: "online", options: { webhook_secret: process.env.PAYMENT_DEMO_WEBHOOK_SECRET } }]
        : []),
    ],
  },
}
```

Привязка способов к региону — link `region_payment_provider`, управляется seed идемпотентно (`backend/src/scripts/seed.ts`):

- development/test: `pp_cod_cash` + `pp_demo_online`;
- production: только `pp_cod_cash`;
- `pp_system_default` снимается во всех окружениях (служебный, не для покупателя);
- **сторонние провайдеры, подключенные вами, seed не удаляет** — синхронизация добавляет недостающие демо-способы и снимает только управляемые (`pp_system_default`, `pp_demo_online`).

Ручное управление — Admin API: `POST /admin/regions/:id` с полем `payment_providers: [...]` (полная замена набора).

## Тестовые сценарии демо-провайдера

Детерминированные сценарии для тестов/разработки (все воспроизводимы через Store/Admin API):

```bash
# 1. Сессия с исходом: успех / отказ / ожидание
POST /store/payment-collections/:id/payment-sessions
  { "provider_id": "pp_demo_online", "data": { "outcome": "success" | "decline" | "pending" } }

# 2. complete: success → заказ authorized; decline → 400; pending → заказ awaiting
# 3. Подтверждение pending — подписанный webhook (см. следующий раздел)
# 4. Capture/Refund — штатные админ-операции (api.md, маршруты 55–56)
```

Автотесты: `storefront/tests/unit/payment-providers.spec.ts` (8 — контракт провайдеров, HMAC, production-глушилка, guard) + `storefront/tests/integration/store-payment-providers.spec.ts` (11 — полный цикл обоих способов на живой Medusa). Расширенная приемка — этап 6.5.

## Webhook демо-провайдера

Штатный маршрут `POST /hooks/payment/pp_demo_online` (маршрут 59) — без авторизации по дизайну; безопасность обеспечивает подпись.

- **Тело**: `{ "event_type": "authorized" | "captured", "session_id": "payses_…", "amount": 1770 }` (`amount` — основная денежная единица).
- **Подпись**: заголовок `x-demo-signature` = HMAC-SHA256 (hex) над **raw body** с секретом `PAYMENT_DEMO_WEBHOOK_SECRET`:

```bash
BODY='{"event_type":"authorized","session_id":"payses_…","amount":1770}'
SIG=$(printf '%s' "$BODY" \
  | openssl dgst -sha256 -hmac "$PAYMENT_DEMO_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -X POST http://localhost:9000/hooks/payment/pp_demo_online \
  -H "Content-Type: application/json" -H "x-demo-signature: $SIG" -d "$BODY"
```

- **Обработка** — штатная: маршрут принимает (200), событие обрабатывается с задержкой (`webhook_delay`, у нас 1 с, дефолт 5 с) и 3 попытками; подписчик `payment-webhook` вызывает провайдера; действия `authorized|captured` запускают `processPaymentWorkflow` (автозавершение корзины → заказ, автокапчур, дооформление отложенной авторизации).
- **Гарантии**: неверная подпись/формат/действие → `not_supported` (состояние не меняется); повторная доставка идемпотентна (authorize/capture штатно дедуплицируются); capture из webhook не превышает авторизованную сумму (ядро); валюта платежа — валюта сессии (заявленная в webhook валюта игнорируется); событие без `session_id` ядро отбрасывает.
- **Подтверждение отложенной сессии**: провайдер хранит in-memory набор подтвержденных session_id (штатный `context.idempotency_key` несет id сессии) — подписанный webhook помечает сессию, повторный вызов `authorizePayment` (ядро) возвращает `authorized`. Ограничения: состояние в памяти процесса — перезапуск стирает неподтвержденные переводы (как реальный банк без подтверждения), мультиинстансность не поддерживается (демо; реальный провайдер хранит состояние у себя в API). Альтернатива без webhook — штатная кнопка «Check status» в Medusa Admin (`POST /admin/orders/:id/payment-sessions/authorize`, маршрут 58): повторный опрос провайдера для `pending_authorization`-сессии.
- **Секрет** — только backend; не логируется, в storefront не передается.

## Production-ограничения

Двойная глушилка фиктивной онлайн-оплаты (решение №41) + серверный guard:

1. **Условная регистрация**: `pp_demo_online` не регистрируется в `medusa-config.ts` при `NODE_ENV=production` — провайдер отсутствует в контейнере и БД (`is_enabled`).
2. **`static validateOptions`** провайдера бросает ошибку при `NODE_ENV=production` — принудительная регистрация ломает старт приложения (fail-fast, по образцу `MAILPIT_ENABLED`).
3. **Seed** в production связывает с регионом только `pp_cod_cash`.
4. **Серверный guard выбора провайдера** (`backend/src/api/middlewares/payment-access.ts`, `guardPaymentProviderPolicy`): в production Store-маршрут создания платежной сессии отвергает `pp_system_default` и `pp_demo_online` (400 `not_allowed`). Причина: `pp_system_default` регистрируется ядром всегда (нужен mark-as-paid), а его связь с регионом — данные, которые администратор может восстановить вручную через Admin API (проверено живой пробой 6.2 — после ручной привязки Store API принимал его сессию). Guard НЕ затрагивает: `pp_cod_cash`, реальные провайдеры, Admin API, внутренние workflows и служебный mark-as-paid (идут в обход Store-маршрута), dev/test.
5. Итог для production: покупателю доступна только **оплата при получении** (и реальные провайдеры, подключенные вами); фиктивная онлайн-оплата невозможна ни через витрину, ни прямым Store-запросом.

## Upstream-особенности Medusa 2.23 (аудит 6.1)

Зафиксированные фактические особенности ядра (не дефекты наших провайдеров; живые пробы 6.1–6.2):

- **`amount` в capture/refund по умолчанию — вся сумма платежа, а не остаток**: после частичного capture запрос без `amount` завершается 400; передавайте остаток явно. После полного capture повторный capture — идемпотентный no-op.
- **`payment_status` отсутствует в ответе `POST /store/carts/:id/complete`** — читается `GET /store/orders/:id` (с proof `x-cart-id` для гостя).
- **`canceled_at` не входит в дефолтные поля Admin API платежа** — запрашивайте `?fields=+canceled_at`.
- **mark-as-paid** (`POST /admin/payment-collections/:id/mark-as-paid`) принимает только коллекции `not_paid` и не проверяет `order_id` (workflow игнорирует значение) — для подтверждения COD-оплаты используйте Capture.
- **Изменение суммы корзины удаляет платежные сессии** (ядро обновляет `amount` коллекции и удаляет сессии) — покупателю нужно заново выбрать способ оплаты; на 6.2 это штатное поведение, витрина должна его учитывать (этап 9).
- **Webhook без `session_id`/с несуществующей сессией** безопасен: события без session_id отбрасываются подписчиком; неизвестная сессия приводит к провалу штатного workflow без изменения состояния.
- Класс `AbstractPaymentService` не существует в 2.23 — контракт называется `AbstractPaymentProvider`.

## Подключение собственного провайдера

Реальный провайдер (ЮKassa, Т-Банк, Stripe и др.) подключается после V1 **без изменения ядра и витрины** — заменой демо-модуля в конфигурации. Чек-лист:

1. **Модуль провайдера** — каталог `backend/src/modules/payment-<имя>/providers/<имя>/` по образцу демо (`index.ts` с `export default { services: [Class] }` + `service.ts` с классом `AbstractPaymentProvider<Options>`; `static identifier = "<имя>"`, `static validateOptions` для проверки обязательных опций). Реализуйте: `initiatePayment` (создание платежа у провайдера; верните `{id, data}` — `data` публична витрине, без секретов), `authorizePayment` (подтверждение при complete; для redirect/асинхронных оплат — `pending_authorization`), `capturePayment`, `refundPayment`, `cancelPayment`, `deletePayment`, `updatePayment`, `retrievePayment`, `getPaymentStatus`, `getWebhookActionAndData` (проверка подписи + маппинг события на `authorized|captured` с `{session_id, amount}`).
2. **Credentials — в корневой `.env`** (`.env.example` + `docs/configuration.md` + `validate-env.mjs`); передаются только backend-контейнерам (`x-medusa-env` в `docker-compose.yml`), никогда — storefront.
3. **Регистрация** — `medusa-config.ts`, массив `providers` модуля `@medusajs/medusa/payment`: `{ resolve: "./src/modules/payment-<имя>/providers/<имя>", id: "<суффикс>", options: {…} }` → id `pp_<имя>_<суффикс>`.
4. **Привязка к региону** — Admin API `POST /admin/regions/:id` c `payment_providers` (или добавьте id в seed-набор); seed сторонние провайдеры не удаляет.
5. **Webhook** — отдавайте провайдеру URL `{MEDUSA_PUBLIC_URL}/hooks/payment/pp_<имя>_<суффикс>`; проверяйте подпись в `getWebhookActionAndData` (HMAC/открытый ключ провайдера над raw body, timing-safe); передавайте `{session_id, amount}` — сумма списания будет ограничена ядром авторизованной суммой сессии, валюта — валютой сессии. Задержка/ретраи обработки — опции модуля `webhook_delay`/`webhook_retries`.
6. **Идемпотентность** — не дублируйте штатную: ядро идемпотентно вызывает провайдера (ключи передаются в `context.idempotency_key`: id сессии при authorize, id capture при списании, ключ refund при возврате, id платежа при отмене) и дедуплицирует capture/refund; ваш внешний API должен безопасно обрабатывать повторные вызовы с тем же ключом (стандартная поддержка идемпотентности у ЮKassa/Т-Банка/Stripe).
7. **Состояние подтверждений** держите в своем внешнем API (не in-memory, как демо): webhook-и и «Check status» повторно вызывают `authorizePayment` — ответ должен отражать фактический статус платежа у провайдера.
8. **Redirect-оплата**: витрина до redirect создает корзину/коллекцию/сессию (шаги 1–8 checkout, [docs/checkout.md](checkout.md)), данные для redirect-URL провайдер кладет в `session.data` (читается через корзину: `GET /store/carts/:id?fields=+payment_collection,*payment_collection.payment_sessions`); возврат покупателя → complete. Логика checkout не меняется — провайдер-специфичен только адаптер на витрине (этап 9).
9. **Фиктивные провайдеры в production**: после подключения реального провайдера не связывайте `pp_system_default`/`pp_demo_online` с регионом; при необходимости расширьте `PRODUCTION_BLOCKED_PAYMENT_PROVIDERS` в `payment-access.ts` — guard уже блокирует оба демо-id в production.
10. **Проверка**: живые сценарии по образцу 6.2 (success/отказ/отмена/возвраты/webhook/повторные доставки) + автотесты по образцу `store-payment-providers.spec.ts`; сверка сумм/валюты — на стороне ядра.

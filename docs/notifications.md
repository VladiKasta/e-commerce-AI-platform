# Email-уведомления (Notification Module)

Этап 5.2.3. Доставка одноразовых токенов покупателям **штатным Notification Module Medusa** (`@medusajs/medusa/notification`): сброс пароля и подтверждение переноса заказа. Собственный сервис рассылок, очередь и Event Bus не создаются — решение №39 в [PROGRESS.md](PROGRESS.md).

## Архитектура

```text
Ядро Medusa (workflow)                    Наш код (тонкий слой)               Инфраструктура
────────────────────────                  ─────────────────────────           ──────────────────────
generateResetPasswordTokenWorkflow ──► подписчик customer-password-reset ──┐
событие auth.password_reset               createNotifications(...)            │
                                          (штатный Notification Module)     ├─► SMTP-провайдер ─► SMTP-сервер
requestOrderTransferWorkflow ─────────► подписчик order-transfer-requested ─┘    notification-smtp    (production)
событие order.transfer_requested           + Query API (токен, email заказа)                      или Mailpit (dev)
                                                ▲
                                     job notification-retry (повтор FAILURE,
                                     штатная идемпотентность idempotency_key)
```

Компоненты:

| Компонент | Расположение | Назначение |
|---|---|---|
| Notification Module (штатный) | `medusa-config.ts` | Таблица `notification`, идемпотентность `idempotency_key`, вызов провайдера канала `email`, статус `success`/`failure`. |
| SMTP-провайдер `notification-smtp` | `backend/src/modules/notification-smtp/providers/smtp/` | Единственный нештатный элемент: в Medusa 2.23 нет SMTP-провайдера (встроены только `notification-local` — логирование, и `notification-sendgrid`). Реализует штатный контракт `AbstractNotificationProviderService` (nodemailer). |
| Подписчики | `backend/src/subscribers/customer-password-reset.ts`, `order-transfer-requested.ts` | Собирают `CreateNotificationDTO` из события и отдают модулю. Ошибок не бросают (см. «Обработка ошибок»). |
| Шаблоны | `backend/src/modules/notification-smtp/providers/smtp/templates.ts` | Реестр: рендер темы/HTML/plain text. Русский язык, экранирование данных, ссылки без жестко заданного домена. |
| Job повторной доставки | `backend/src/jobs/notification-retry.ts` | Scheduled job: повторяет `failure`-уведомления через ту же `createNotifications` с тем же `idempotency_key` в ограниченном окне. |
| Mailpit | `docker-compose.yml` (profile `mailpit`) | Локальный SMTP-ящик: принимает письма без аутентификации, Web UI на `127.0.0.1:8025`. |

## Поддерживаемые события

| Событие | Когда эмитится | Payload | Письмо |
|---|---|---|---|
| `auth.password_reset` | `POST /auth/customer/emailpass/reset-password` → `generateResetPasswordTokenWorkflow`. **Только для существующих identity** (несуществующий email → шаг падает, событие не эмитится). | `{entity_id (email), actor_type, token, metadata}` | получатель `entity_id` (определяется сервером), шаблон `customer-password-reset`, ключ `password-reset:<sha256(token)>` |
| `order.transfer_requested` | `POST /store/orders/:id/transfer/request` → `requestOrderTransferWorkflow`. | `{id (order_id), order_change_id}` — **токен в событии отсутствует** | подписчик резолвит токен/email заказа/номер через Query API (`order_change_action.details.token`); получатель — email заказа; шаблон `order-transfer-request`, ключ `order-transfer:<sha256(order_change_id)>` |

> Примечание: имя `auth.password_reset_token_generated`, встречающееся в старой документации Medusa, в 2.23 не эмитится — фактическое имя подтверждено live-probe (решение №39). События для `actor_type` `user` (сброс пароля администратора) письмом не доставляются.

Повторная доставка события дублей не создает: `createNotifications` с тем же `idempotency_key` при статусе `success` пропускает отправку (штатная идемпотентность модуля).

## Настройка SMTP

Все переменные — в корневом `.env` (шаблон `.env.example`); SMTP-credentials передаются только backend-контейнерам (`x-medusa-env` в `docker-compose.yml`) и никогда не попадают в storefront.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `NOTIFICATION_ENABLED` | `true` | `false` — подписчики и job повторной доставки полностью выключены (события ядра продолжают эмититься, уведомления не создаются). |
| `SMTP_HOST` | `mailpit` (в `.env.example`) | Хост SMTP-сервера. |
| `SMTP_PORT` | `587` | Порт SMTP. |
| `SMTP_SECURE` | `false` | TLS с момента соединения (порт 465); `false` — STARTTLS. |
| `SMTP_USER` / `SMTP_PASSWORD` | пусто | Аутентификация SMTP (для Mailpit не нужны). |
| `SMTP_FROM_EMAIL` | `no-reply@localhost` | Адрес отправителя. |
| `SMTP_FROM_NAME` | `STORE_NAME` | Имя отправителя. |
| `NOTIFICATION_RETRY_CRON` | `*/5 * * * *` | Расписание job-а повторной доставки. |
| `NOTIFICATION_RETRY_WINDOW_MINUTES` | `15` | Окно повторов (≈ TTL reset-токена: мертвые ссылки не рассылаются). |

Production: укажите реальный SMTP-сервер (или провайдера типа SendGrid — см. ниже), доменный `SMTP_FROM_EMAIL`, установите `MAILPIT_ENABLED=false`.

## Локальное тестирование через Mailpit

`MAILPIT_ENABLED=true` (по умолчанию) — `make init`/`make up`/`make dev` автоматически запускают сервис Mailpit (compose profile `mailpit`, письма переживают рестарт: SQLite в volume `mailpit_data`):

- SMTP: `mailpit:1025` внутри Docker-сети (наружу не публикуется);
- Web UI: **http://localhost:8025** — порт публикуется только на `127.0.0.1` хоста;
- API: `GET /api/v1/messages` (список), `GET /api/v1/message/{id}` (тело), `DELETE /api/v1/messages` (очистка).

Проверка сценария вручную:

```bash
# 1. Покупатель + запрос сброса пароля
curl -X POST http://localhost:9000/auth/customer/emailpass/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"Passw0rd!"}'
curl -X POST http://localhost:9000/auth/customer/emailpass/reset-password \
  -H 'Content-Type: application/json' -d '{"identifier":"me@example.com"}'

# 2. Письмо в Mailpit → http://localhost:8025
# 3. Смена пароля по токену из письма (токен — в Bearer-заголовке)
curl -X POST http://localhost:9000/auth/customer/emailpass/update \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <reset-токен из письма>" \
  -d '{"password":"NewPassw0rd!"}'
```

Интеграционные тесты: `storefront/tests/integration/store-auth-notifications.spec.ts` (3 теста, `make test`); письма читаются через Mailpit API, токены извлекаются и используются, но не печатаются.

## Шаблоны

Два шаблона, оба: русский язык, HTML + plain text, `STORE_NAME` в теме/подписи, ссылки из `NUXT_PUBLIC_SITE_URL` (без жестко заданного домена), `encodeURIComponent` для токена в URL, экранирование пользовательских данных в HTML.

| Шаблон | Ссылка в письме (будущая страница витрины, этап 9) |
|---|---|
| `customer-password-reset` | `{SITE_URL}/reset-password?token=…&email=…` |
| `order-transfer-request` | `{SITE_URL}/account/order-transfer?token=…&order_id=…` |

**Переопределение шаблона / добавление нового** — правка реестра `TEMPLATES` в `backend/src/modules/notification-smtp/providers/smtp/templates.ts` (или добавление файла рядом). Подписчики передают логическое имя шаблона и данные — инфраструктура не меняется. Визуальный редактор шаблонов сознательно не реализуется.

## Добавление нового уведомления

1. Найдите событие ядра (список — `@medusajs/framework/utils` `*WorkflowEvents` / `docs/events.md`) и проверьте **фактический** payload на живой окружении (probe-подписчиком — так найдено расхождение имени события сброса пароля).
2. Добавьте шаблон в реестр (раздел выше).
3. Добавьте подписчик `backend/src/subscribers/<event>.ts`: соберите `CreateNotificationDTO` (`to` — только серверные данные), `idempotency_key` по уникальной части события, вызовите `createNotification` из `backend/src/utils/notifications.ts` (он не бросает ошибки и уважает `NOTIFICATION_ENABLED`).
4. Обновите таблицу событий выше и `docs/events.md` (этап 8.4).

## Подключение другого провайдера

Замена SMTP-сервера — правка переменных `.env` (бизнес-логика, шаблоны и подписчики не меняются).

Замена провайдера (например, на SendGrid) — замена записи в `medusa-config.ts`:

```ts
{
  resolve: "@medusajs/medusa/notification",
  options: {
    providers: [
      {
        resolve: "@medusajs/medusa/notification-sendgrid", // или свой по контракту
        id: "sendgrid",
        options: { channels: ["email"], api_key: "...", /* … */ },
      },
    ],
  },
}
```

Провайдер получает `template` (логическое имя) и `data` — маппинг имен на шаблоны провайдера выполняется на его стороне (как `template id` у SendGrid). Один провайдер на канал: несколько email-провайдеров одновременно модуль не допускает.

## Обработка ошибок

- **SMTP недоступен** — `sendMail` падает → модуль помечает notification `failure`, подписчик ловит и логирует ошибку (без токенов и адресов) → HTTP-ответ штатного сценария не меняется (`reset-password` → 201, `transfer/request` → 200). Job `notification-retry` (cron `NOTIFICATION_RETRY_CRON`) повторяет `failure`-строки в окне `NOTIFICATION_RETRY_WINDOW_MINUTES` через штатную идемпотентность: `success` — пропуск, `failure` — повтор. Ретраи короткие и ограниченные окном; рассылки «взрывом» нет.
- **Неизвестный шаблон** — провайдер бросает `MedusaError` → `failure`-строка, ошибка в логах со списком поддерживаемых шаблонов.
- **Event Bus** — ядро эмитит события через `emitEventStep` без `attempts`: ретраев события на шине нет (1 попытка). Подписчики поэтому не бросают ошибки — потеря события исключена, доставка восстанавливается job-ом.
- **Параллельные запуски job-а** исключены Locking Module (advisory-лок, прием этапа 3.6.2); race «два чтения `failure` → две отправки» внутри модуля (известный TODO ядра) закрыт пропуском запуска при занятом lock-е.
- **Rate limiting** — на `reset-password` и `transfer/request` действуют лимиты этапа 5.2.2 (429 не создает уведомлений: middleware стоит до workflow).

## Ограничения безопасности

- **Получатель определяется сервером**: reset — `entity_id` события (событие эмитится только для существующих identity — перечисление email через письма невозможно); transfer — email заказа из Query API (не инициатор, не тело запроса).
- **Токены не логируются**: провайдер логирует только шаблон и текст ошибки транспорта; `notification-local` из Medusa отклонен именно потому, что логирует `data` с токеном.
- **Одноразовость reset-токена** — штатный механизм Auth Module (jti, атомарное поглощение, TTL 15 минут, новое подтверждение аннулирует старое) не изменялся; повторное использование токена → 401, старый пароль после смены не работает.
- **Хранение токенов**: письмо требует токен в `data` — он хранится в таблице `notification` (PostgreSQL). Публичные API его не раскрывают: Store API не читает notifications; Admin API (`GET /admin/notifications`, только администраторы) показывает `data` — это дублирует то, что ядро и так хранит в `order_change_action` для transfer; reset-токен одноразовый и живёт 15 минут. Событие с reset-токеном проходит через Redis (Event Bus) транзитно — штатное поведение ядра.
- **Mailpit** — только локальная разработка: `MAILPIT_ENABLED=false` в production (validate-env блокирует `true` при `NODE_ENV=production`), Web UI публикуется только на `127.0.0.1`, SMTP-порт наружу не публикуется.
- **Credentials** — только в корневом `.env`; в storefront не передаются (`x-medusa-env` — только backend-контейнеры).

## Что не входит в этот этап

SMS/Telegram, маркетинговые рассылки, подписки на товары, уведомления о заказах (`order.created` обслуживается встроенным подписчиком ядра с шаблоном `order-created-template`), визуальный редактор шаблонов, доставка писем администраторам, OTP-подтверждение гостевых заказов (предложение — в [ROADMAP.md](ROADMAP.md), раздел 5.2.3).

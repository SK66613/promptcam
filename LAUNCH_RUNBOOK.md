# PromptCam — Launch Runbook

Цель: один короткий runbook для публичного запуска, платежей, D1 recovery и rollback.

## 1. Перед открытием публичного трафика

- Включить Two-Step Verification на Telegram-аккаунте владельца BotFather.
- Проверить, что Mini App origin protection в BotFather не отключалась.
- `wrangler.jsonc` должен указывать production D1 `promptcam-prod`, `worker/security-entry.js` и `PROMPTCAM_ENV=production`.
- Cloudflare Worker secrets должны существовать:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_WEBHOOK_SECRET`
  - `OPENAI_API_KEY`
- Wrangler `secrets.required` должен блокировать deploy при отсутствии этих секретов.
- В production Cloudflare config задать `TELEGRAM_WEBHOOK_ORIGIN` как **канонический HTTPS origin PromptCam**, например `https://app.example.com`, без `/api/...`. Worker никогда не должен строить Telegram webhook из входящего request Host или preview URL.
- `ENABLE_TEST_PAYMENTS` на production не нужен и должен быть unset/`0`. Даже при ошибочном `1` тестовые платежи включаются только когда `PROMPTCAM_ENV=test`.
- Опционально задать `SUPPORT_CHAT_ID`, если support tickets нужно дублировать в закрытый Telegram-чат команды. Без него тикеты всё равно сохраняются в D1.
- Workers Observability должна быть включена; первые 48 часов смотреть 5xx/401/428/429 и payment anomalies.

## 2. Telegram webhook до релиза

Webhook должен быть зарегистрирован только на канонический production origin.

Проверить через Bot API `getWebhookInfo`:

- URL заканчивается на `/api/telegram/webhook` и использует именно production host;
- preview/branch URL там отсутствует;
- `allowed_updates` включает `message`, `pre_checkout_query`, `callback_query`, `subscription`;
- `pending_update_count` не растёт постоянно;
- `last_error_message` пустой или относится только к уже исправленному инциденту.

Негативный тест: POST на `/api/telegram/webhook` без корректного `X-Telegram-Bot-Api-Secret-Token` должен вернуть 401 и **не** создавать user/wallet/order/ledger rows. Если production secret не настроен, endpoint должен fail-closed с 503.

## 3. D1 backup до релиза

Сначала проверить backend D1:

```bash
npx wrangler d1 info promptcam-prod
```

Для production D1 Time Travel включён автоматически. Зафиксировать текущий bookmark:

```bash
npx wrangler d1 time-travel info promptcam-prod
```

Дополнительно сделать независимый SQL export:

```bash
mkdir -p backups
npx wrangler d1 export promptcam-prod --remote --output="backups/promptcam-prod-$(date +%Y%m%d-%H%M%S).sql"
```

Backup-файлы не коммитить в публичный GitHub repository.

## 4. Проверки перед deploy

```bash
npm ci
npm run check
npx wrangler deploy --dry-run
```

`npm run check` должен пройти по всем `worker/*.js` и `web/*.js`, включая launch/security/payment wrappers.

До merge убедиться, что Cloudflare branch/commit preview собран успешно на **последнем** commit PR, а не на более старом SHA.

## 5. Smoke test после deploy

Проверять на отдельном Telegram test-user и минимальными суммами production-flow.

1. `/api/health` возвращает `ok: true`, Telegram/D1/AI flags доступны.
2. Mini App открывается без DBG. `?debug=1` — только для диагностики.
3. Camera + microphone: одна permission-flow, запись и сохранение работают.
4. FREE video содержит watermark.
5. AI token balance открывается; тестовый ⭐1 пакет отсутствует.
6. До принятия Terms Stars purchase заблокирован.
7. Принять актуальные Terms/Privacy; повторный вход помнит versioned consent.
8. Token purchase: 60 = ⭐25; balance увеличился ровно один раз; ledger/order = credited.
9. После успешной token purchase повторное открытие **того же invoice** не должно приводить ко второму списанию: повторный pre-checkout должен быть отклонён как использованный счёт.
10. Pro day = ⭐25; `/api/me` возвращает Pro; следующая запись без watermark.
11. Пока Pro активен, создание второго Pro invoice блокируется.
12. Monthly = ⭐199 создаётся как recurring invoice link; интерфейс явно показывает auto-renew.
13. Monthly cancel не отнимает текущий доступ; resume снова разрешает renewal.
14. После cancel/resume проверить состояние и в Mini App, и через `/pro`.
15. Bot `/terms`, `/privacy`, `/tokens`, `/pro`, `/paysupport` работают.
16. `/paysupport` + следующее сообщение создаёт `support_tickets` row.
17. Library/template/favorite, AI Take Director, Speech Context и Script AI работают после billing changes.

## 6. Payment invariants

Никогда не выдавать Pro или AI-токены по frontend callback `paid` без серверного Telegram `successful_payment`.

Server source of truth:

- Pro: `successful_payment` → `payments` → `entitlements`.
- AI tokens: `successful_payment` → idempotent `ai_token_orders` claim → wallet/ledger.
- `telegram_payment_charge_id` хранится для support/refund.
- Duplicate webhook не должен повторно начислять товар.
- Один пользовательский invoice/order должен быть одноразовым на pre-checkout; повторный pre-checkout того же order отклоняется **до** нового списания Stars.
- Monthly subscription создаётся через `createInvoiceLink` с `subscription_period`; обычный one-time Pro может использовать `sendInvoice`.
- Если Telegram уже списал Stars, обработчик обязан завершить выдачу товара даже если pricing/Terms изменились после создания старого invoice.
- Платёжные операции и entitlement/wallet updates проверять только по серверным данным, не по UI state.

## 7. Subscription incidents

Monthly PromptCam Pro — recurring Stars subscription.

Cancel/resume выполняется через Telegram `editUserStarSubscription`. Cancel останавливает только следующее продление; текущий оплаченный период остаётся до `access_until`.

Telegram `subscription` updates (`active`, `canceled`, `failed`) должны быть разрешены в webhook и синхронизироваться с `subscription_controls`.

При `failed` не удалять текущий entitlement раньше `access_until`.

Для управления подпиской хранить charge ID первой recurring оплаты; не отдавать его во frontend API.

## 8. Support / refund procedure

Пользователь обращается через `/paysupport`. Тикет сохраняется в `support_tickets`.

Для платежного спора:

1. Найти Telegram user и примерное время из тикета.
2. Найти payment/order в D1 и проверить сумму/currency/status.
3. Для Pro использовать `payments.telegram_payment_charge_id`; для tokens — `ai_token_orders.telegram_payment_charge_id`.
4. Refund выполняется только оператором через Telegram Bot API `refundStarPayment(user_id, telegram_payment_charge_id)`.
5. После refund отдельно привести entitlement/token wallet в согласованное состояние и сохранить внутреннюю запись о причине. До появления admin refund tooling не выполнять автоматический refund только по тексту пользователя.
6. Никогда не просить пользователя присылать пароль, Telegram login code или данные банковской карты.

## 9. Быстрые D1 проверки

Последние Pro payments:

```sql
SELECT telegram_id, plan, stars, created_at, telegram_payment_charge_id
FROM payments
ORDER BY created_at DESC
LIMIT 20;
```

Последние token purchases:

```sql
SELECT telegram_id, pack, tokens, stars, status, paid_at, telegram_payment_charge_id
FROM ai_token_orders
ORDER BY created_at DESC
LIMIT 20;
```

Активные entitlements:

```sql
SELECT telegram_id, plan, access_until, recurring
FROM entitlements
WHERE access_until > unixepoch()
ORDER BY access_until DESC;
```

Открытые support tickets:

```sql
SELECT id, telegram_id, created_at, message
FROM support_tickets
WHERE status = 'open'
ORDER BY created_at ASC
LIMIT 50;
```

Подозрительные Pro orders, которые зависли после checkout:

```sql
SELECT id, telegram_id, plan, stars, status, created_at
FROM billing_orders
WHERE status IN ('checkout_approved', 'invoice_sent', 'pending')
ORDER BY created_at ASC
LIMIT 50;
```

Подозрительные token orders, которые не дошли до credit:

```sql
SELECT id, telegram_id, pack, tokens, stars, status, created_at
FROM ai_token_orders
WHERE status != 'credited'
ORDER BY created_at ASC
LIMIT 50;
```

## 10. D1 recovery

До restore сначала получить current bookmark и сохранить его.

Restore по timestamp/bookmark:

```bash
npx wrangler d1 time-travel info promptcam-prod --timestamp="2026-09-05T20:00:00Z"
npx wrangler d1 time-travel restore promptcam-prod --bookmark=<BOOKMARK>
```

Restore перезаписывает production database. Выполнять только после фиксации текущего bookmark и подтверждения времени инцидента.

## 11. Worker rollback

Если после deploy ломается boot/payment/camera:

1. Не менять D1 вручную, пока не понятно, затронуты ли данные.
2. Откатить Worker на последний известный хороший Git commit / Cloudflare deployment.
3. Проверить `/api/health`.
4. Повторить FREE camera test и server-side `/api/me`.
5. Только затем разбирать миграцию/данные.

## 12. Что мониторить первые 48 часов

- 5xx Worker errors;
- 401/428 spikes (webhook/session/Terms);
- 429 purchase/AI rate limits;
- `invoice_failed`, token orders не в `credited`;
- `checkout_approved`, который долго не перешёл в `paid`/`credited`;
- successful payments без entitlement/wallet credit;
- duplicate payment attempts;
- `subscription` state `failed`;
- AI provider latency/error spikes;
- support ticket backlog;
- неожиданное изменение Telegram webhook URL.

Не логировать кадры, audio chunks, transcript, script text, AI responses или Telegram initData.

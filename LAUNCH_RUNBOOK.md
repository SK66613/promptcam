# PromptCam — Launch Runbook

Цель: один короткий runbook для публичного запуска, платежей, D1 recovery и rollback.

## 1. Перед открытием публичного трафика

- Включить Two-Step Verification на Telegram-аккаунте владельца BotFather.
- Проверить, что Mini App origin protection в BotFather не отключалась.
- Cloudflare Worker secrets должны существовать:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_WEBHOOK_SECRET`
  - `OPENAI_API_KEY`
- `ENABLE_TEST_PAYMENTS` на production **не должен быть `1`**.
- Опционально задать `SUPPORT_CHAT_ID`, если support tickets нужно дублировать в закрытый Telegram-чат команды. Без него тикеты всё равно сохраняются в D1.
- `wrangler.jsonc` должен указывать production D1 `promptcam-prod` и текущий launch/security entry.

## 2. D1 backup до релиза

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

## 3. Smoke test после deploy

Проверять на отдельном Telegram test-user и минимальными суммами production-flow.

1. `/api/health` возвращает `ok: true`, Telegram/D1/AI flags доступны.
2. Mini App открывается без DBG. `?debug=1` — только для диагностики.
3. Camera + microphone: одна permission-flow, запись и сохранение работают.
4. FREE video содержит watermark.
5. AI token balance открывается; тестовый ⭐1 пакет отсутствует.
6. До принятия Terms Stars purchase заблокирован.
7. Принять Terms/Privacy; повторный вход помнит versioned consent.
8. Token purchase: 60 = ⭐25; balance увеличился ровно один раз; ledger/order credited.
9. Pro day = ⭐25; `/api/me` возвращает Pro; следующая запись без watermark.
10. Monthly = ⭐199 показывает auto-renew; cancel не отнимает текущий доступ; resume снова разрешает renewal.
11. Bot `/terms`, `/tokens`, `/pro`, `/paysupport` работают.
12. `/paysupport` + следующее сообщение создаёт `support_tickets` row.
13. Library/template/favorite, AI Take Director, Speech Context и Script AI работают после billing changes.

## 4. Payment invariants

Никогда не выдавать Pro или AI-токены по frontend callback `paid` без серверного Telegram `successful_payment`.

Server source of truth:

- Pro: `successful_payment` → `payments` → `entitlements`
- AI tokens: `successful_payment` → idempotent `ai_token_orders` claim → wallet/ledger
- `telegram_payment_charge_id` хранится для support/refund.
- Duplicate webhook не должен повторно начислять товар.
- Если Telegram уже списал Stars, обработчик обязан завершить выдачу товара даже если pricing/Terms изменились после создания старого invoice.

## 5. Subscription incidents

Monthly PromptCam Pro — recurring Stars subscription.

Cancel/resume выполняется через Telegram `editUserStarSubscription`. Cancel останавливает только следующее продление; текущий оплаченный период остаётся до `access_until`.

Telegram `subscription` updates (`active`, `canceled`, `failed`) должны быть разрешены в webhook и синхронизироваться с `subscription_controls`.

При `failed` не удалять текущий entitlement раньше `access_until`.

## 6. Support / refund procedure

Пользователь обращается через `/paysupport`. Тикет сохраняется в `support_tickets`.

Для платежного спора:

1. Найти Telegram user и примерное время из тикета.
2. Найти payment/order в D1 и проверить сумму/currency/status.
3. Для Pro использовать `payments.telegram_payment_charge_id`; для tokens — `ai_token_orders.telegram_payment_charge_id`.
4. Refund выполняется только оператором через Telegram Bot API `refundStarPayment(user_id, telegram_payment_charge_id)`.
5. После refund отдельно привести entitlement/token wallet в согласованное состояние и сохранить внутреннюю запись о причине. До появления admin refund tooling не выполнять автоматический refund только по тексту пользователя.
6. Никогда не просить пользователя присылать пароль, Telegram login code или данные банковской карты.

## 7. Быстрые D1 проверки

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

## 8. D1 recovery

До restore сначала получить current bookmark и сохранить его.

Restore по timestamp/bookmark:

```bash
npx wrangler d1 time-travel info promptcam-prod --timestamp="2026-09-05T20:00:00Z"
npx wrangler d1 time-travel restore promptcam-prod --bookmark=<BOOKMARK>
```

Restore перезаписывает production database. Выполнять только после фиксации текущего bookmark и подтверждения времени инцидента.

## 9. Worker rollback

Если после deploy ломается boot/payment/camera:

1. Не менять D1 вручную, пока не понятно, затронуты ли данные.
2. Откатить Worker на последний известный хороший Git commit / Cloudflare deployment.
3. Проверить `/api/health`.
4. Повторить FREE camera test и server-side `/api/me`.
5. Только затем разбирать миграцию/данные.

## 10. Что мониторить первые 48 часов

- 5xx Worker errors
- 401/428 spikes (Telegram session / Terms)
- 429 purchase/AI rate limits
- `invoice_failed`, token orders не в `credited`
- successful payments без entitlement/wallet credit
- `subscription` state `failed`
- AI provider latency/error spikes
- support ticket backlog

Не логировать кадры, audio chunks, transcript, script text, AI responses или Telegram initData.

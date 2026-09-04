# PromptCam billing setup (Telegram Stars + D1)

PromptCam keeps the D1 schema and billing code in Git, but the production D1 database is created manually in the Cloudflare dashboard.

## 1. Create D1 manually

In Cloudflare Dashboard:

1. Open **Storage & Databases → D1 SQL Database**.
2. Create a database, for example `promptcam-production`.
3. Open its SQL console.
4. Copy and run `migrations/0001_billing.sql` from this repository.

Do not put a fake D1 database ID into `wrangler.jsonc`.

## 2. Bind the database to PromptCam

The Worker expects the D1 binding name:

`DB`

Add the existing database as a D1 binding for the `promptcam` Worker.

Important: PromptCam deploys with Wrangler from Git. Cloudflare recommends Wrangler config as the source of truth. After the database is created manually, copy the real D1 binding snippet/database ID from Cloudflare and commit it to `wrangler.jsonc` in a follow-up change so future deploys cannot accidentally lose the dashboard binding.

Until `env.DB` exists, normal camera recording continues to work in FREE mode and billing endpoints report that billing is not configured.

## 3. Required Worker secrets

Existing Telegram Mini App validation uses:

`TELEGRAM_BOT_TOKEN`

Billing webhook additionally requires:

`TELEGRAM_WEBHOOK_SECRET`

Generate a random value containing only letters, numbers, `_` and `-`, then save it as a Worker secret in Cloudflare.

Never commit either secret to Git.

## 4. Configure Telegram webhook

Set the bot webhook to:

`https://promptcam.cyberian13.workers.dev/api/telegram/webhook`

When calling Telegram `setWebhook`, pass the same value stored in `TELEGRAM_WEBHOOK_SECRET` as `secret_token`.

Recommended allowed updates:

- `message`
- `pre_checkout_query`

Telegram sends the secret back in the `X-Telegram-Bot-Api-Secret-Token` header. PromptCam rejects webhook requests whose header does not match the Worker secret.

## 5. Plans

The current test prices live in `worker/index.js`:

| Plan | Stars | Type |
| --- | ---: | --- |
| 1 day | 25 ⭐ | one-time |
| 7 days | 75 ⭐ | one-time |
| 30 days | 199 ⭐ | recurring every 30 days |
| 1 year | 999 ⭐ | one-time |

These are test prices and can be changed before launch.

Telegram currently allows a bot Stars recurring invoice only with a 30-day subscription period. Day, week and year are therefore one-time purchases that grant timed PromptCam Pro access.

## 6. Payment trust model

The Mini App calls `/api/billing/invoice`, then opens Telegram's native invoice UI.

Do **not** grant Pro because the frontend receives `invoiceClosed: paid`.

The source of truth is:

1. Telegram sends `pre_checkout_query` to the Worker.
2. PromptCam validates the stored order and answers it.
3. Telegram sends a message with `successful_payment`.
4. Worker stores `telegram_payment_charge_id` in D1.
5. Worker updates `entitlements.access_until`.
6. `/api/me` starts returning `access.pro = true`.
7. Frontend disables the recording watermark for subsequent recordings.

## 7. Current result-screen behavior

FREE users see:

- **Сохранить / поделиться**
- **Скачать файл**
- **PromptCam Pro** payment button

The older `Записать ещё раз` and `Вернуться к тексту` buttons remain in the DOM for the existing navigation logic, but are hidden visually. Telegram Back remains the normal navigation path in the Mini App.

After Pro activation, subsequent recordings are made without the PromptCam watermark. The already-recorded watermarked clip is not rebuilt in this billing foundation PR.

## 8. Health check

`GET /api/health` reports:

- `telegramConfigured`
- `billingDatabaseConfigured`
- `telegramWebhookConfigured`

All three should be `true` before production payment testing.

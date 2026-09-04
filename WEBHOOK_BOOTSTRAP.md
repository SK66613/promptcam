# PromptCam Telegram webhook bootstrap

PromptCam can now prepare its Telegram Bot API webhook automatically when a valid Mini App user creates a Stars invoice.

## Why

The billing flow requires Telegram updates for:

- `pre_checkout_query`
- `message.successful_payment`

Without a webhook, a Stars checkout cannot reliably complete.

## Runtime behavior

`worker/entry.js` wraps the existing Worker entrypoint.

For `POST /api/billing/invoice`:

1. the existing billing handler validates Telegram `initData`, D1 and the selected plan;
2. the existing handler creates the invoice link;
3. before returning that link to the Mini App, PromptCam calls Telegram Bot API `setWebhook`;
4. the webhook URL is derived from the current Worker origin and always points to `/api/telegram/webhook`;
5. Telegram receives `secret_token = TELEGRAM_WEBHOOK_SECRET` and `allowed_updates = ["message", "pre_checkout_query"]`;
6. only if webhook setup succeeds is the invoice URL returned to the frontend.

This makes the first real Stars purchase the practical end-to-end webhook test.

## Secrets

The Worker still expects dashboard secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

The webhook secret must use only `A-Z`, `a-z`, `0-9`, `_` and `-`, with length 1–256 characters.

`keep_vars: true` is enabled in Wrangler so dashboard variables/secrets are preserved during Git deploys.

## D1 warning

The production D1 database is created manually in Cloudflare.

Before merging this change, `wrangler.jsonc` must also contain the real production D1 binding:

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "promptcam-prod",
    "database_id": "<REAL_DATABASE_ID>"
  }
]
```

Do not add a D1 binding without the real `database_id`: modern Wrangler can auto-provision a different database.

## Test

After deployment, open PromptCam inside Telegram:

1. record a FREE video;
2. open `PromptCam Pro`;
3. select the 1-day plan;
4. PromptCam creates the invoice and automatically calls `setWebhook`;
5. Telegram opens its native Stars payment UI;
6. checkout sends `pre_checkout_query` to the Worker;
7. successful payment is written to D1;
8. `/api/me` reports Pro and the next recording has no watermark.

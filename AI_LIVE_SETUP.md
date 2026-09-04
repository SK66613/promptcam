# PromptCam Live AI — backend setup

PR #14 adds `POST /api/ai/live` to the Cloudflare Worker.

## Cloudflare secrets

Add this as an encrypted Worker secret:

- `OPENAI_API_KEY` — OpenAI API key used only by the Worker.

Do not put the API key in GitHub, `wrangler.jsonc`, frontend JavaScript, screenshots, or chat messages.

Optional Worker variable:

- `OPENAI_LIVE_MODEL` — overrides the default model (`gpt-5.6-luna`).

## D1 migration

Run `migrations/0002_ai_usage.sql` against the existing `promptcam-prod` D1 database.

The migration creates only per-minute usage counters:

- `telegram_id`
- minute bucket
- request count
- update timestamp

No camera frames, AI prompts, AI replies, or images are stored in D1.

## Endpoint contract

`POST /api/ai/live`

Request body:

```json
{
  "initData": "<Telegram WebApp initData>",
  "mode": "jokes",
  "frame": "data:image/jpeg;base64,..."
}
```

Allowed modes:

- `jokes`
- `director`
- `ideas`
- `hooks`

Success with a suggestion:

```json
{
  "ok": true,
  "action": "suggest",
  "type": "joke",
  "text": "Короткая реплика",
  "scene": "Краткое нейтральное описание сцены",
  "rateLimit": { "remaining": 29 }
}
```

Success when the model should stay quiet:

```json
{
  "ok": true,
  "action": "none",
  "type": "none",
  "text": "",
  "scene": "Краткое нейтральное описание сцены",
  "rateLimit": { "remaining": 28 }
}
```

## Security / privacy contract

- Telegram `initData` is validated by the existing server-side PromptCam session validator.
- The OpenAI key never reaches the browser.
- Only JPEG/WebP data URLs are accepted.
- Request/frame sizes are capped before provider work.
- Per-Telegram-user server-side limit: 30 AI requests/minute.
- OpenAI Responses API is called with `store: false`.
- Image detail is `low` for the first Live AI version.
- PromptCam does not persist camera frames in D1/R2/logging code.
- Structured JSON output is required before a reply reaches the frontend.
- The model is instructed not to identify people or infer sensitive/private traits.

## Health

`GET /api/health` gains:

```json
{
  "aiProviderConfigured": true
}
```

This flag only reports whether `OPENAI_API_KEY` exists; it never exposes the key.

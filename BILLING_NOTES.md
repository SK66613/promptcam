# Billing implementation notes

- Production D1 is created manually in Cloudflare.
- The repository intentionally does not contain a placeholder/fake D1 database ID.
- Worker binding name is `DB`.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` remain Cloudflare secrets.
- Pro access is granted only after Telegram `successful_payment` is received and stored in D1.
- Frontend `invoiceClosed` status is only UX feedback and is never the authorization source of truth.
- The 30-day plan is recurring; day/week/year are one-time timed access purchases.
- Current test prices are defined in one place in `worker/index.js`.
- Existing watermarked result is not re-encoded after payment in this stage; Pro removes the watermark from subsequent recordings.

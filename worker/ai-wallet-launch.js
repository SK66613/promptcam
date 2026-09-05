import {
  handleWalletApi,
  maybeHandleTokenWebhook,
  meterAiRequest
} from './ai-wallet.js';

export { handleWalletApi, maybeHandleTokenWebhook, meterAiRequest };

let ready = false;
let pending = null;

export async function ensureWalletWebhook(request, env, ctx) {
  if (ready) return true;
  if (pending) return pending;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  pending = (async () => {
    try {
      const origin = new URL(request.url).origin;
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `${origin}/api/telegram/webhook`,
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ['message', 'pre_checkout_query', 'callback_query', 'subscription']
        })
      });
      const data = await response.json().catch(() => null);
      ready = Boolean(response.ok && data?.ok);
      return ready;
    } catch (_) {
      return false;
    } finally {
      pending = null;
    }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(pending);
  return pending;
}

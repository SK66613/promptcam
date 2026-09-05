import app from './speech-context-entry.js';
import {
  ensureWalletWebhook,
  handleWalletApi,
  maybeHandleTokenWebhook,
  meterAiRequest
} from './ai-wallet.js';

async function refreshWalletWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return;
  const url = new URL(request.url);
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${url.origin}/api/telegram/webhook`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'pre_checkout_query', 'callback_query']
      })
    });
  } catch (_) {
    // The existing webhook remains usable; this refresh only expands allowed updates.
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') {
      const tokenResponse = await maybeHandleTokenWebhook(request, env, ctx);
      if (tokenResponse) return tokenResponse;
      return app.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/ai/wallet') {
      ensureWalletWebhook(request, env, ctx).catch(() => {});
      return handleWalletApi(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/ai/')) {
      ensureWalletWebhook(request, env, ctx).catch(() => {});
      return meterAiRequest(request, env, ctx);
    }

    if (url.pathname === '/api/billing/invoice' && request.method === 'POST') {
      const response = await app.fetch(request, env, ctx);
      if (response.ok) {
        const refresh = refreshWalletWebhook(request, env);
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(refresh);
        else refresh.catch(() => {});
      }
      return response;
    }

    return app.fetch(request, env, ctx);
  }
};

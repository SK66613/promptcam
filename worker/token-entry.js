import app from './speech-context-entry.js';
import {
  ensureWalletWebhook,
  handleWalletApi,
  maybeHandleTokenWebhook,
  meterAiRequest
} from './ai-wallet-launch.js';
import { maybeHandleSafeTokenPayment } from './token-payment-safe.js';
import { maybeHandleSafeTestTokenPayment } from './token-test-payment-safe.js';
import { handleTestPackApi, maybeHandleTestTokenWebhook } from './token-test-pack.js';
import { maybeHandlePaymentHub } from './bot-payment-hub.js';
import { queueHubAfterSuccessfulPayment } from './bot-payment-hub-hooks.js';
import { ensureBotUserFromWebhook } from './bot-user-bootstrap.js';

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
        allowed_updates: ['message', 'pre_checkout_query', 'callback_query', 'subscription']
      })
    });
  } catch (_) {
    // Keep the current webhook if Telegram is temporarily unavailable.
  }
}

function finishWebhook(response, paymentProbe, env, ctx) {
  if (response?.ok && paymentProbe) queueHubAfterSuccessfulPayment(paymentProbe, env, ctx);
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') {
      const paymentProbe = request.clone();
      await ensureBotUserFromWebhook(request, env);

      const hubResponse = await maybeHandlePaymentHub(request, env);
      if (hubResponse) return hubResponse;

      const safeTestPayment = await maybeHandleSafeTestTokenPayment(request, env);
      if (safeTestPayment) return finishWebhook(safeTestPayment, paymentProbe, env, ctx);

      const safePaymentResponse = await maybeHandleSafeTokenPayment(request, env);
      if (safePaymentResponse) return finishWebhook(safePaymentResponse, paymentProbe, env, ctx);

      const testTokenResponse = await maybeHandleTestTokenWebhook(request, env);
      if (testTokenResponse) return finishWebhook(testTokenResponse, paymentProbe, env, ctx);

      const tokenResponse = await maybeHandleTokenWebhook(request, env, ctx);
      if (tokenResponse) return finishWebhook(tokenResponse, paymentProbe, env, ctx);

      const response = await app.fetch(request, env, ctx);
      return finishWebhook(response, paymentProbe, env, ctx);
    }

    if (url.pathname === '/api/ai/wallet-test') {
      ensureWalletWebhook(request, env, ctx).catch(() => {});
      return handleTestPackApi(request, env, ctx);
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

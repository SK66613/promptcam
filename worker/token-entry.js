import app from './speech-context-entry.js';
import {
  ensureWalletWebhook,
  handleWalletApi,
  maybeHandleTokenWebhook,
  meterAiRequest
} from './ai-wallet.js';
import { maybeHandleSafeTokenPayment } from './token-payment-safe.js';
import { maybeHandleSafeTestTokenPayment } from './token-test-payment-safe.js';
import { handleTestPackApi, maybeHandleTestTokenWebhook } from './token-test-pack.js';
import { maybeHandlePaymentHub } from './bot-payment-hub.js';
import { queueHubAfterSuccessfulPayment } from './bot-payment-hub-hooks.js';

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
      // Preserve one untouched clone before any downstream billing handler consumes body.
      const paymentProbe = request.clone();

      // Commands and inline navigation belong to one editable payment hub message.
      // This must run before legacy /tokens callbacks and menu messages.
      const hubResponse = await maybeHandlePaymentHub(request, env);
      if (hubResponse) return hubResponse;

      // Successful token payments are credited by silent idempotent handlers first,
      // then the existing hub message is refreshed in place.
      const safeTestPayment = await maybeHandleSafeTestTokenPayment(request, env);
      if (safeTestPayment) return finishWebhook(safeTestPayment, paymentProbe, env, ctx);

      const safePaymentResponse = await maybeHandleSafeTokenPayment(request, env);
      if (safePaymentResponse) return finishWebhook(safePaymentResponse, paymentProbe, env, ctx);

      // Legacy handlers remain for pre_checkout_query and old inline buttons that may
      // still exist in a user's chat from earlier PromptCam versions.
      const testTokenResponse = await maybeHandleTestTokenWebhook(request, env);
      if (testTokenResponse) return finishWebhook(testTokenResponse, paymentProbe, env, ctx);

      const tokenResponse = await maybeHandleTokenWebhook(request, env, ctx);
      if (tokenResponse) return finishWebhook(tokenResponse, paymentProbe, env, ctx);

      // PromptCam Pro billing remains the source of truth for entitlement/watermark.
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

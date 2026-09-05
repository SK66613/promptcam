import app from './token-entry.js';
import { ensureWalletWebhook } from './ai-wallet-launch.js';
import { handleLegalApi, hasCurrentConsent, requireMiniAppConsent } from './legal.js';
import { maybeHandleLegalWebhook } from './bot-legal.js';
import { maybeHandleSubscriptionWebhook, refreshSubscriptionHub } from './bot-subscription.js';
import { handleLaunchBillingInvoice, LAUNCH_PLANS, maybeHandleLaunchBillingWebhook } from './pro-billing-launch.js';
import { maybeEnsureWalletForWebhook } from './launch-wallet.js';
import { consumePurchaseRate, maybeRateLimitPurchaseWebhook, purchaseRateResponse } from './purchase-rate.js';
import { handleSubscriptionApi, recordRecurringPayment } from './subscription-control.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function testPaymentsEnabled(env) {
  return String(env.ENABLE_TEST_PAYMENTS || '') === '1';
}

async function readJsonClone(request) {
  try { return await request.clone().json(); }
  catch (_) { return null; }
}

async function telegramApi(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.ok ? response.json().catch(() => null) : null;
  } catch (_) {
    return null;
  }
}

async function maybeBlockTestWebhook(request, env) {
  if (testPaymentsEnabled(env)) return null;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }
  const query = update?.callback_query;
  const callbackData = String(query?.data || '');
  if (query && (callbackData === 'ait:buy:test60' || callbackData === 'pch:token:test60')) {
    await telegramApi(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Тестовый пакет отключён перед запуском.'
    });
    return json({ ok: true });
  }
  const checkout = update?.pre_checkout_query;
  if (checkout && String(checkout.invoice_payload || '').startsWith('pcttest:')) {
    await telegramApi(env, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: checkout.id,
      ok: false,
      error_message: 'Тестовый пакет PromptCam больше недоступен. Открой актуальный магазин токенов.'
    });
    return json({ ok: true });
  }
  return null;
}

async function maybeBlockUnconsentedCheckout(request, env) {
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }
  const checkout = update?.pre_checkout_query;
  if (!checkout) return null;
  const payload = String(checkout.invoice_payload || '');
  if (!payload.startsWith('pc:') && !payload.startsWith('pct:') && !payload.startsWith('pcttest:')) return null;
  const telegramId = String(checkout.from?.id || '');
  if (!telegramId || await hasCurrentConsent(env, telegramId)) return null;
  await telegramApi(env, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: checkout.id,
    ok: false,
    error_message: 'Перед оплатой открой PromptCam или /terms и прими актуальные условия покупки.'
  });
  return json({ ok: true });
}

async function patchBillingMe(request, env, ctx) {
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) return response;
  const data = await response.json().catch(() => null);
  if (!data || !Array.isArray(data.plans)) return response;
  data.plans = data.plans.map((plan) => {
    const launch = LAUNCH_PLANS[plan?.id];
    return launch ? { ...plan, stars: launch.stars, recurring: launch.recurring } : plan;
  });
  return json(data, response.status);
}

function queueLaunchProPostPayment(update, env, ctx) {
  const payment = update?.message?.successful_payment;
  const telegramId = String(update?.message?.from?.id || '');
  if (!payment || !telegramId || !String(payment.invoice_payload || '').startsWith('pc:')) return;
  const work = (async () => {
    if (payment.is_first_recurring || payment.is_recurring) {
      await recordRecurringPayment(
        env,
        telegramId,
        String(payment.telegram_payment_charge_id || ''),
        Boolean(payment.is_first_recurring)
      );
    }
    await refreshSubscriptionHub(env, telegramId, {
      notice: '✅ Оплата PromptCam Pro прошла. Тариф и доступ обновлены.',
      chatId: telegramId
    });
  })().catch(() => false);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
}

async function purchaseRateOrResponse(env, telegramId) {
  const rate = await consumePurchaseRate(env, telegramId);
  if (rate.ok) return null;
  if (!rate.configured) return json({ ok: false, error: 'purchase_rate_database_unavailable' }, 503);
  return purchaseRateResponse(rate.retryAfter);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/telegram/webhook') {
      ensureWalletWebhook(request, env, ctx).catch(() => {});
    }

    if (url.pathname === '/api/legal') return handleLegalApi(request, env, ctx, app);
    if (url.pathname === '/api/billing/subscription') return handleSubscriptionApi(request, env, ctx, app);

    if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') {
      const paymentProbe = request.clone();
      await maybeEnsureWalletForWebhook(request, env);

      const testBlock = await maybeBlockTestWebhook(request, env);
      if (testBlock) return testBlock;

      const purchaseRate = await maybeRateLimitPurchaseWebhook(request, env);
      if (purchaseRate) return purchaseRate;

      const subscriptionResponse = await maybeHandleSubscriptionWebhook(request, env);
      if (subscriptionResponse) return subscriptionResponse;

      const legalResponse = await maybeHandleLegalWebhook(request, env);
      if (legalResponse) return legalResponse;

      const consentBlock = await maybeBlockUnconsentedCheckout(request, env);
      if (consentBlock) return consentBlock;

      const billingResponse = await maybeHandleLaunchBillingWebhook(request, env);
      if (billingResponse) {
        const update = await paymentProbe.json().catch(() => null);
        queueLaunchProPostPayment(update, env, ctx);
        return billingResponse;
      }
      return app.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/ai/wallet-test' && !testPaymentsEnabled(env)) {
      return json({ ok: false, error: 'test_payments_disabled' }, 404);
    }

    if (url.pathname === '/api/me' && request.method === 'POST') return patchBillingMe(request, env, ctx);

    if (url.pathname === '/api/billing/invoice' && request.method === 'POST') {
      const body = await readJsonClone(request);
      if (!body) return json({ ok: false, error: 'invalid_json' }, 400);
      const consent = await requireMiniAppConsent(request, env, ctx, app, body);
      if (!consent.ok) return consent.response;
      const rateResponse = await purchaseRateOrResponse(env, consent.user.id);
      if (rateResponse) return rateResponse;
      return handleLaunchBillingInvoice(request, env, consent.user, body);
    }

    if (url.pathname === '/api/ai/wallet' && request.method === 'POST') {
      const body = await readJsonClone(request);
      if (body?.action === 'buy_pack') {
        const consent = await requireMiniAppConsent(request, env, ctx, app, body);
        if (!consent.ok) return consent.response;
        const rateResponse = await purchaseRateOrResponse(env, consent.user.id);
        if (rateResponse) return rateResponse;
      }
    }

    return app.fetch(request, env, ctx);
  }
};

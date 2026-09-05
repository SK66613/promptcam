import app from './token-entry.js';
import { handleLegalApi, requireMiniAppConsent } from './legal.js';
import { maybeHandleLegalWebhook } from './bot-legal.js';

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

  // Never discard successful_payment: if Telegram already charged a user before
  // the deploy, the existing idempotent handler must still deliver the tokens.
  return null;
}

async function enforcePurchaseConsent(request, env, ctx, url) {
  if (request.method !== 'POST') return null;
  let body = null;
  if (url.pathname === '/api/billing/invoice') {
    body = await readJsonClone(request);
  } else if (url.pathname === '/api/ai/wallet') {
    body = await readJsonClone(request);
    if (body?.action !== 'buy_pack') return null;
  } else {
    return null;
  }

  if (!body) return null;
  const check = await requireMiniAppConsent(request, env, ctx, app, body);
  return check.ok ? null : check.response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/legal') {
      return handleLegalApi(request, env, ctx, app);
    }

    if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') {
      const legalResponse = await maybeHandleLegalWebhook(request, env);
      if (legalResponse) return legalResponse;
      const testBlock = await maybeBlockTestWebhook(request, env);
      if (testBlock) return testBlock;
      return app.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/ai/wallet-test' && !testPaymentsEnabled(env)) {
      return json({ ok: false, error: 'test_payments_disabled' }, 404);
    }

    const consentResponse = await enforcePurchaseConsent(request, env, ctx, url);
    if (consentResponse) return consentResponse;

    return app.fetch(request, env, ctx);
  }
};

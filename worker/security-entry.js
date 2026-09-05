import app from './launch-entry.js';
import { ensureWalletWebhook } from './ai-wallet-launch.js';
import { syncSubscriptionUpdate } from './subscription-control.js';
import { refreshSubscriptionHub } from './bot-subscription.js';

const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  headers.set('Content-Security-Policy-Report-Only', REPORT_ONLY_CSP);
  const contentType = String(headers.get('Content-Type') || '').toLowerCase();
  if (contentType.includes('text/html')) headers.set('Cache-Control', 'no-store, max-age=0');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function telegramWebhookGate(request, env, url) {
  if (url.pathname !== '/api/telegram/webhook' || request.method !== 'POST') return null;
  const expected = String(env.TELEGRAM_WEBHOOK_SECRET || '');
  if (!expected) return json({ ok: false, error: 'telegram_webhook_not_configured' }, 503);
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!provided || provided !== expected) return json({ ok: false, error: 'invalid_webhook_secret' }, 401);
  return null;
}

async function maybeHandleSubscriptionUpdate(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/telegram/webhook' || request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }
  const subscription = update?.subscription;
  if (!subscription?.user?.id) return null;

  const telegramId = String(subscription.user.id);
  const synced = await syncSubscriptionUpdate(env, subscription);
  const notice = subscription.state === 'canceled'
    ? '⏸ Автопродление PromptCam Pro отключено. Текущий период остаётся активным до его окончания.'
    : subscription.state === 'active'
      ? '🔁 Автопродление PromptCam Pro снова активно.'
      : '⚠️ Telegram не смог продлить PromptCam Pro. Проверь баланс Stars или выбери тариф заново.';
  const refresh = refreshSubscriptionHub(env, telegramId, { chatId: telegramId, notice }).catch(() => false);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(refresh);
  return json({ ok: true, subscriptionSynced: synced, state: String(subscription.state || '') });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const webhookBlock = telegramWebhookGate(request, env, url);
      if (webhookBlock) return secureResponse(webhookBlock);

      if (url.pathname.startsWith('/api/')) ensureWalletWebhook(request, env, ctx).catch(() => {});

      const subscriptionResponse = await maybeHandleSubscriptionUpdate(request, env, ctx);
      if (subscriptionResponse) return secureResponse(subscriptionResponse);
      const response = await app.fetch(request, env, ctx);
      return secureResponse(response);
    } catch (_) {
      return secureResponse(new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      }));
    }
  }
};

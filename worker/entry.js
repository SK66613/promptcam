import app from './index.js';

const TELEGRAM_ALLOWED_UPDATES = ['message', 'pre_checkout_query'];
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

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

async function telegramApi(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = typeof data?.description === 'string' ? data.description : '';
    const error = new Error(`telegram_api_${method}_failed`);
    error.description = description;
    throw error;
  }
  return data.result;
}

function desiredWebhookUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/api/telegram/webhook`;
}

async function ensureTelegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'telegram_not_configured' };
  }
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return { ok: false, error: 'telegram_webhook_not_configured' };
  }
  if (!WEBHOOK_SECRET_PATTERN.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    return { ok: false, error: 'telegram_webhook_secret_invalid' };
  }

  const url = desiredWebhookUrl(request);
  try {
    await telegramApi(env, 'setWebhook', {
      url,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES
    });
    return { ok: true, url };
  } catch (error) {
    return {
      ok: false,
      error: 'telegram_webhook_setup_failed',
      reason: error?.description || ''
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/billing/invoice' && request.method === 'POST') {
      const response = await app.fetch(request.clone(), env, ctx);
      if (!response.ok) return response;

      const payload = await response.clone().json().catch(() => null);
      if (!payload?.ok || !payload?.invoiceUrl) return response;

      const webhook = await ensureTelegramWebhook(request, env);
      if (!webhook.ok) {
        return json({
          ok: false,
          error: webhook.error,
          reason: webhook.reason || ''
        }, 503);
      }

      return response;
    }

    return app.fetch(request, env, ctx);
  }
};

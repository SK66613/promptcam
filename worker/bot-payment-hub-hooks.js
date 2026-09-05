import { refreshPaymentHub } from './bot-payment-hub.js';

function paymentTarget(update) {
  const message = update?.message;
  const payment = message?.successful_payment;
  const telegramId = String(message?.from?.id || '');
  const payload = String(payment?.invoice_payload || '');
  if (!payment || !telegramId || !payload) return null;

  if (payload.startsWith('pcttest:') || payload.startsWith('pct:')) {
    return {
      telegramId,
      view: 'tokens',
      notice: '✅ Оплата прошла. Баланс AI-токенов обновлён.'
    };
  }
  if (payload.startsWith('pc:')) {
    return {
      telegramId,
      view: 'pro',
      notice: '✅ Оплата PromptCam Pro прошла. Тариф и доступ обновлены.'
    };
  }
  return null;
}

export async function refreshHubAfterSuccessfulPayment(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return false;

  let update;
  try { update = await request.clone().json(); }
  catch (_) { return false; }

  const target = paymentTarget(update);
  if (!target) return false;
  return refreshPaymentHub(env, target.telegramId, {
    view: target.view,
    notice: target.notice,
    chatId: target.telegramId
  });
}

export function queueHubAfterSuccessfulPayment(request, env, ctx) {
  const work = refreshHubAfterSuccessfulPayment(request, env).catch(() => false);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  return work;
}

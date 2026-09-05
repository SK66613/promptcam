import { editSubscriptionForUser, getSubscriptionStatus } from './subscription-control.js';
import { LAUNCH_PLANS } from './pro-billing-launch.js';

const CALLBACK = 'pcsub:';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function telegramApi(env, method, payload, allowNotModified = false) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('telegram_not_configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = String(data?.description || '');
    if (allowNotModified && description.toLowerCase().includes('message is not modified')) return null;
    throw new Error(`telegram_${method}_failed`);
  }
  return data.result;
}

function commandName(text) {
  return String(text || '').trim().split(/\s+/)[0].toLowerCase().split('@')[0];
}

async function hubRow(env, telegramId) {
  if (!env.DB) return null;
  try {
    return await env.DB.prepare(`
      SELECT chat_id, message_id FROM bot_payment_hubs WHERE telegram_id = ? LIMIT 1
    `).bind(String(telegramId)).first();
  } catch (_) { return null; }
}

async function saveHub(env, telegramId, chatId, messageId) {
  if (!env.DB) return;
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(`
      INSERT INTO bot_payment_hubs (telegram_id, chat_id, message_id, view, updated_at)
      VALUES (?, ?, ?, 'pro', ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        message_id = excluded.message_id,
        view = 'pro',
        updated_at = excluded.updated_at
    `).bind(String(telegramId), String(chatId), Number(messageId), now).run();
  } catch (_) { /* hub can still render even if state save fails */ }
}

function dateLabel(seconds) {
  if (!seconds) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(Number(seconds) * 1000));
  } catch (_) { return ''; }
}

async function accessStatus(env, telegramId) {
  try {
    const row = await env.DB.prepare(`
      SELECT plan, access_until, recurring FROM entitlements WHERE telegram_id = ? LIMIT 1
    `).bind(String(telegramId)).first();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(row?.access_until || 0);
    return {
      pro: expiresAt > now,
      plan: expiresAt > now ? String(row?.plan || '') : '',
      expiresAt: expiresAt > now ? expiresAt : 0,
      recurring: expiresAt > now && Boolean(Number(row?.recurring || 0))
    };
  } catch (_) {
    return { pro: false, plan: '', expiresAt: 0, recurring: false };
  }
}

function keyboard(subscription) {
  const rows = [
    [
      { text: `1 день · ⭐${LAUNCH_PLANS.day.stars}`, callback_data: 'pch:pro:day' },
      { text: `7 дней · ⭐${LAUNCH_PLANS.week.stars}`, callback_data: 'pch:pro:week' }
    ],
    [
      { text: `30 дней · ⭐${LAUNCH_PLANS.month.stars}`, callback_data: 'pch:pro:month' },
      { text: `1 год · ⭐${LAUNCH_PLANS.year.stars}`, callback_data: 'pch:pro:year' }
    ]
  ];
  if (subscription?.recurring && subscription?.canManage) {
    rows.push([{
      text: subscription.canceled ? '🔁 Возобновить автопродление' : '⏸ Остановить автопродление',
      callback_data: `${CALLBACK}${subscription.canceled ? 'resume' : 'cancel'}`
    }]);
  }
  rows.push([{ text: '↩️ Меню', callback_data: 'pch:view:main' }]);
  return { inline_keyboard: rows };
}

async function payload(env, telegramId, notice = '') {
  const access = await accessStatus(env, telegramId);
  const subscription = await getSubscriptionStatus(env, telegramId);
  let status = 'Сейчас PromptCam Free · новые записи сохраняются с водяным знаком.';
  if (access.pro) {
    status = `✅ PromptCam Pro активен${access.expiresAt ? ` до ${dateLabel(access.expiresAt)}` : ''}.`;
    if (subscription.recurring) {
      status += subscription.canceled
        ? '\nАвтопродление остановлено. Текущий период остаётся активным до указанной даты.'
        : '\nАвтопродление включено каждые 30 дней.';
    }
  }
  return {
    text: `${notice ? `${notice}\n\n` : ''}⭐ Тариф PromptCam\n\n${status}\n\n30 дней — подписка Telegram Stars. Остальные сроки — разовые покупки.`,
    reply_markup: keyboard(subscription)
  };
}

export async function refreshSubscriptionHub(env, telegramId, { chatId = '', messageId = 0, notice = '' } = {}) {
  const existing = await hubRow(env, telegramId);
  const targetChat = String(chatId || existing?.chat_id || telegramId);
  const targetMessage = Number(messageId || existing?.message_id || 0);
  const rendered = await payload(env, telegramId, notice);
  if (targetMessage) {
    try {
      await telegramApi(env, 'editMessageText', {
        chat_id: targetChat,
        message_id: targetMessage,
        text: rendered.text,
        reply_markup: rendered.reply_markup
      }, true);
      await saveHub(env, telegramId, targetChat, targetMessage);
      return true;
    } catch (_) { /* send replacement below */ }
  }
  try {
    const sent = await telegramApi(env, 'sendMessage', {
      chat_id: targetChat,
      text: rendered.text,
      reply_markup: rendered.reply_markup
    });
    if (sent?.message_id) await saveHub(env, telegramId, targetChat, sent.message_id);
    return true;
  } catch (_) { return false; }
}

async function answerCallback(env, query, text = '') {
  try {
    await telegramApi(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      ...(text ? { text } : {})
    });
  } catch (_) { /* best effort */ }
}

export async function maybeHandleSubscriptionWebhook(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }

  const message = update?.message;
  const command = commandName(message?.text);
  if (message && (command === '/pro' || command === '/tariff' || command === '/тариф')) {
    const telegramId = String(message.from?.id || '');
    const chatId = String(message.chat?.id || telegramId);
    if (telegramId) await refreshSubscriptionHub(env, telegramId, { chatId });
    return json({ ok: true });
  }

  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!query || !data) return null;
  const telegramId = String(query.from?.id || '');
  const chatId = String(query.message?.chat?.id || telegramId);
  const messageId = Number(query.message?.message_id || 0);
  if (!telegramId) return null;

  if (data === 'pch:view:pro') {
    await answerCallback(env, query);
    await refreshSubscriptionHub(env, telegramId, { chatId, messageId });
    return json({ ok: true });
  }

  if (data === `${CALLBACK}cancel` || data === `${CALLBACK}resume`) {
    const cancel = data.endsWith('cancel');
    const result = await editSubscriptionForUser(env, telegramId, cancel);
    await answerCallback(env, query, result.ok
      ? cancel ? 'Автопродление остановлено' : 'Автопродление возобновлено'
      : 'Не удалось изменить подписку');
    await refreshSubscriptionHub(env, telegramId, {
      chatId,
      messageId,
      notice: result.ok
        ? cancel
          ? '✅ Следующее автопродление отключено. Текущий Pro остаётся до конца оплаченного периода.'
          : '✅ Автопродление снова включено.'
        : 'Не удалось изменить автопродление. Попробуй позже или используй /paysupport.'
    });
    return json({ ok: true });
  }

  return null;
}

import { hasCurrentConsent, TERMS_VERSION } from './legal.js';

const LEGAL_CALLBACK = 'pclegal:';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function telegramApi(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('telegram_not_configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(`telegram_${method}_failed`);
  return data.result;
}

function commandName(text) {
  return String(text || '').trim().split(/\s+/)[0].toLowerCase().split('@')[0];
}

function isPurchaseCallback(data) {
  return data.startsWith('pch:token:') || data.startsWith('pch:pro:') || data.startsWith('ait:buy:');
}

function termsKeyboard(origin, back = 'main') {
  return {
    inline_keyboard: [
      [{ text: 'Условия использования', url: `${origin}/terms.html` }],
      [{ text: 'Политика конфиденциальности', url: `${origin}/privacy.html` }],
      [{ text: '✅ Принимаю Условия', callback_data: `${LEGAL_CALLBACK}accept:${back}` }],
      [{ text: '↩️ Назад', callback_data: `${LEGAL_CALLBACK}back:${back}` }]
    ]
  };
}

async function showTerms(env, chatId, origin, messageId = 0, back = 'main') {
  const payload = {
    chat_id: chatId,
    text: [
      '📄 Условия PromptCam',
      '',
      'Перед покупкой цифровых функций через Telegram Stars нужно прочитать и принять Условия использования PromptCam.',
      '',
      'Политика конфиденциальности доступна отдельно и описывает обработку данных; отдельное согласие с ней для Stars-покупки не требуется.',
      '',
      `Версия условий: ${TERMS_VERSION}.`
    ].join('\n'),
    reply_markup: termsKeyboard(origin, back)
  };
  if (messageId) {
    try {
      await telegramApi(env, 'editMessageText', { ...payload, message_id: Number(messageId) });
      return;
    } catch (_) { /* send a replacement below */ }
  }
  await telegramApi(env, 'sendMessage', payload);
}

async function showPrivacy(env, chatId, origin) {
  await telegramApi(env, 'sendMessage', {
    chat_id: chatId,
    text: [
      '🔒 Политика конфиденциальности PromptCam',
      '',
      'Здесь описано, какие данные получает PromptCam и как обрабатываются Telegram-профиль, AI-кадры, речевые чанки, сценарии, библиотека, платежи и обращения в поддержку.',
      '',
      'Для покупки через Telegram Stars отдельное подтверждение Privacy Policy не требуется — перед оплатой подтверждаются Условия использования.'
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть Privacy Policy', url: `${origin}/privacy.html` }]]
    }
  });
}

async function answerCallback(env, query, text = '') {
  try {
    await telegramApi(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      ...(text ? { text } : {})
    });
  } catch (_) { /* best effort */ }
}

export async function maybeHandlePolicyWebhook(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;

  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }

  const origin = new URL(request.url).origin;
  const message = update?.message;
  const query = update?.callback_query;

  if (message?.text) {
    const command = commandName(message.text);
    const chatId = String(message.chat?.id || message.from?.id || '');
    if (!chatId) return null;
    if (command === '/terms') {
      await showTerms(env, chatId, origin);
      return json({ ok: true });
    }
    if (command === '/privacy') {
      await showPrivacy(env, chatId, origin);
      return json({ ok: true });
    }
  }

  const data = String(query?.data || '');
  const telegramId = String(query?.from?.id || '');
  if (!query || !telegramId || !isPurchaseCallback(data)) return null;
  if (await hasCurrentConsent(env, telegramId)) return null;

  const chatId = String(query.message?.chat?.id || telegramId);
  const messageId = Number(query.message?.message_id || 0);
  const back = data.includes('pro:') ? 'pro' : 'tokens';
  await answerCallback(env, query, 'Сначала прими Условия PromptCam');
  await showTerms(env, chatId, origin, messageId, back);
  return json({ ok: true });
}

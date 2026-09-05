import { ensureLegalSchema, hasCurrentConsent, saveConsent, TERMS_VERSION, PRIVACY_VERSION } from './legal.js';
import { refreshPaymentHub } from './bot-payment-hub.js';

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
  const first = String(text || '').trim().split(/\s+/)[0].toLowerCase();
  return first.split('@')[0];
}

function legalKeyboard(origin, back = 'main') {
  return {
    inline_keyboard: [
      [
        { text: 'Условия', url: `${origin}/terms.html` },
        { text: 'Конфиденциальность', url: `${origin}/privacy.html` }
      ],
      [{ text: '✅ Принимаю условия', callback_data: `${LEGAL_CALLBACK}accept:${back}` }],
      [{ text: '↩️ Назад', callback_data: `${LEGAL_CALLBACK}back:${back}` }]
    ]
  };
}

async function showLegalMessage(env, telegramId, chatId, origin, messageId = 0, back = 'main') {
  const payload = {
    chat_id: chatId,
    text: [
      '📄 Условия PromptCam',
      '',
      'Перед покупкой цифровых функций через Telegram Stars нужно прочитать и принять Условия использования и Политику конфиденциальности.',
      '',
      `Версия условий: ${TERMS_VERSION}.`
    ].join('\n'),
    reply_markup: legalKeyboard(origin, back)
  };
  if (messageId) {
    try {
      await telegramApi(env, 'editMessageText', { ...payload, message_id: Number(messageId) });
      return;
    } catch (_) { /* fall through */ }
  }
  await telegramApi(env, 'sendMessage', payload);
}

async function answerCallback(env, query, text = '') {
  try {
    await telegramApi(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      ...(text ? { text } : {})
    });
  } catch (_) { /* best effort */ }
}

async function setSupportPending(env, telegramId, chatId, pending) {
  if (!await ensureLegalSchema(env)) return false;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO support_sessions (telegram_id, chat_id, pending, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      pending = excluded.pending,
      updated_at = excluded.updated_at
  `).bind(String(telegramId), String(chatId), pending ? 1 : 0, now).run();
  return true;
}

async function supportPending(env, telegramId) {
  if (!await ensureLegalSchema(env)) return false;
  const row = await env.DB.prepare(`
    SELECT pending FROM support_sessions WHERE telegram_id = ? LIMIT 1
  `).bind(String(telegramId)).first();
  return Boolean(Number(row?.pending || 0));
}

async function createSupportTicket(env, telegramId, chatId, message) {
  if (!await ensureLegalSchema(env)) return 0;
  const clean = String(message || '').trim().slice(0, 4000);
  if (!clean) return 0;
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(`
    INSERT INTO support_tickets (telegram_id, chat_id, message, status, created_at, updated_at)
    VALUES (?, ?, ?, 'open', ?, ?)
  `).bind(String(telegramId), String(chatId), clean, now, now).run();
  await setSupportPending(env, telegramId, chatId, false);
  const id = Number(result?.meta?.last_row_id ?? result?.lastRowId ?? 0);

  if (env.SUPPORT_CHAT_ID) {
    try {
      await telegramApi(env, 'sendMessage', {
        chat_id: String(env.SUPPORT_CHAT_ID),
        text: `🎫 PromptCam support #${id || '?'}\nUser: ${telegramId}\n\n${clean}`
      });
    } catch (_) { /* ticket is still safely stored in D1 */ }
  }
  return id;
}

function isPurchaseCallback(data) {
  return data.startsWith('pch:token:') || data.startsWith('pch:pro:') ||
    data.startsWith('ait:buy:');
}

export async function maybeHandleLegalWebhook(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;

  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }

  const origin = new URL(request.url).origin;
  const message = update?.message;
  const telegramId = String(message?.from?.id || update?.callback_query?.from?.id || '');
  if (!telegramId) return null;

  if (message?.text) {
    const chatId = String(message.chat?.id || telegramId);
    const command = commandName(message.text);

    if (command === '/terms' || command === '/privacy') {
      await showLegalMessage(env, telegramId, chatId, origin);
      return json({ ok: true });
    }

    if (command === '/paysupport' || command === '/support') {
      await setSupportPending(env, telegramId, chatId, true);
      await telegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: [
          '🛟 Поддержка PromptCam',
          '',
          'Отправь следующим сообщением описание проблемы. Для оплаты укажи, что покупал и примерно когда.',
          'Не отправляй пароли, коды Telegram или данные банковских карт.',
          '',
          'Telegram Support не обрабатывает покупки PromptCam — обращение попадёт разработчику PromptCam.'
        ].join('\n')
      });
      return json({ ok: true });
    }

    if (!command.startsWith('/') && await supportPending(env, telegramId)) {
      const ticketId = await createSupportTicket(env, telegramId, chatId, message.text);
      await telegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: ticketId
          ? `✅ Обращение #${ticketId} принято. Мы сохранили его в поддержке PromptCam.`
          : 'Не удалось сохранить обращение. Попробуй ещё раз через /paysupport.'
      });
      return json({ ok: true });
    }
  }

  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!query || !data) return null;
  const chatId = String(query.message?.chat?.id || telegramId);
  const messageId = Number(query.message?.message_id || 0);

  if (data.startsWith(LEGAL_CALLBACK)) {
    const [action, back = 'main'] = data.slice(LEGAL_CALLBACK.length).split(':');
    if (action === 'accept') {
      const saved = await saveConsent(env, telegramId);
      await answerCallback(env, query, saved ? 'Условия приняты' : 'Не удалось сохранить согласие');
      if (saved) await refreshPaymentHub(env, telegramId, { view: back === 'tokens' || back === 'pro' ? back : 'main', chatId });
      return json({ ok: true });
    }
    if (action === 'back') {
      await answerCallback(env, query);
      await refreshPaymentHub(env, telegramId, { view: back === 'tokens' || back === 'pro' ? back : 'main', chatId });
      return json({ ok: true });
    }
  }

  if (isPurchaseCallback(data) && !await hasCurrentConsent(env, telegramId)) {
    await answerCallback(env, query, 'Сначала прими условия PromptCam');
    const back = data.includes('pro:') ? 'pro' : 'tokens';
    await showLegalMessage(env, telegramId, chatId, origin, messageId, back);
    return json({ ok: true });
  }

  return null;
}

import { ensureLegalSchema, hasCurrentConsent, saveConsent, TERMS_VERSION } from './legal.js';
import { refreshPaymentHub } from './bot-payment-hub.js';
import { LAUNCH_PLANS, sendLaunchProInvoice } from './pro-billing-launch.js';

const LEGAL_CALLBACK = 'pclegal:';
const TOKEN_PACKS = Object.freeze({
  start: { id: 'start', tokens: 60, stars: 25 },
  creator: { id: 'creator', tokens: 250, stars: 79 },
  studio: { id: 'studio', tokens: 800, stars: 199 }
});

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

async function ensureBotUser(env, user) {
  if (!env.DB || !user?.id) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name, language_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      language_code = excluded.language_code,
      updated_at = excluded.updated_at
  `).bind(
    String(user.id), String(user.username || ''), String(user.first_name || ''),
    String(user.last_name || ''), String(user.language_code || ''), now, now
  ).run();
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
  const row = await env.DB.prepare(`SELECT pending FROM support_sessions WHERE telegram_id = ? LIMIT 1`).bind(String(telegramId)).first();
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
    } catch (_) { /* ticket remains in D1 */ }
  }
  return id;
}

async function hubRow(env, telegramId) {
  if (!env.DB) return null;
  try {
    return await env.DB.prepare(`SELECT chat_id, message_id, view FROM bot_payment_hubs WHERE telegram_id = ? LIMIT 1`).bind(String(telegramId)).first();
  } catch (_) {
    return null;
  }
}

async function saveHub(env, telegramId, chatId, messageId, view) {
  if (!env.DB) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO bot_payment_hubs (telegram_id, chat_id, message_id, view, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      message_id = excluded.message_id,
      view = excluded.view,
      updated_at = excluded.updated_at
  `).bind(String(telegramId), String(chatId), Number(messageId), view, now).run();
}

async function readBalance(env, telegramId) {
  try {
    const row = await env.DB.prepare(`SELECT balance FROM ai_token_wallets WHERE telegram_id = ? LIMIT 1`).bind(String(telegramId)).first();
    return Number(row?.balance || 0);
  } catch (_) { return 0; }
}

async function readTopups(env, telegramId) {
  try {
    const result = await env.DB.prepare(`
      SELECT delta, kind, stars, created_at FROM ai_token_ledger
      WHERE telegram_id = ? AND kind IN ('starter','purchase')
      ORDER BY created_at DESC, id DESC LIMIT 5
    `).bind(String(telegramId)).all();
    return Array.isArray(result?.results) ? result.results : [];
  } catch (_) { return []; }
}

async function readAccess(env, telegramId) {
  try {
    const row = await env.DB.prepare(`
      SELECT plan, access_until, recurring FROM entitlements WHERE telegram_id = ? LIMIT 1
    `).bind(String(telegramId)).first();
    const now = Math.floor(Date.now() / 1000);
    return {
      pro: Number(row?.access_until || 0) > now,
      plan: String(row?.plan || ''),
      expiresAt: Number(row?.access_until || 0),
      recurring: Boolean(Number(row?.recurring || 0))
    };
  } catch (_) { return { pro: false, plan: '', expiresAt: 0, recurring: false }; }
}

function dateLabel(seconds) {
  try { return new Date(Number(seconds || 0) * 1000).toLocaleDateString('ru-RU'); }
  catch (_) { return ''; }
}

function tokenKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '60 токенов · ⭐25', callback_data: 'pch:token:start' }],
      [
        { text: '250 · ⭐79', callback_data: 'pch:token:creator' },
        { text: '800 · ⭐199', callback_data: 'pch:token:studio' }
      ],
      [{ text: '↩️ Меню', callback_data: 'pch:view:main' }]
    ]
  };
}

function proKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '1 день · ⭐25', callback_data: 'pch:pro:day' },
        { text: '7 дней · ⭐75', callback_data: 'pch:pro:week' }
      ],
      [
        { text: '30 дней · ⭐199', callback_data: 'pch:pro:month' },
        { text: '1 год · ⭐999', callback_data: 'pch:pro:year' }
      ],
      [{ text: '↩️ Меню', callback_data: 'pch:view:main' }]
    ]
  };
}

async function renderLaunchView(env, telegramId, view, notice = '') {
  const prefix = notice ? `${notice}\n\n` : '';
  if (view === 'tokens') {
    const balance = await readBalance(env, telegramId);
    const rows = await readTopups(env, telegramId);
    const history = rows.length
      ? rows.map((row) => `${dateLabel(row.created_at)} · +${Number(row.delta || 0)}${Number(row.stars || 0) ? ` · ⭐${Number(row.stars)}` : ' · подарок'}`).join('\n')
      : 'Пополнений пока нет.';
    return {
      text: `${prefix}⚡ AI-токены PromptCam\n\nБаланс: ${balance}\n\nПоследние пополнения:\n${history}\n\nОплата цифровых функций — только Telegram Stars.`,
      reply_markup: tokenKeyboard()
    };
  }
  const access = await readAccess(env, telegramId);
  const status = access.pro
    ? `✅ PromptCam Pro активен${access.expiresAt ? ` до ${dateLabel(access.expiresAt)}` : ''}${access.recurring ? ' · автопродление' : ''}.`
    : 'Сейчас PromptCam Free · новые записи сохраняются с водяным знаком.';
  return {
    text: `${prefix}⭐ Тариф PromptCam\n\n${status}\n\n30 дней — подписка с автопродлением каждые 30 дней. Остальные сроки — разовая покупка.`,
    reply_markup: proKeyboard()
  };
}

export async function refreshLaunchPaymentHub(env, telegramId, { view = 'tokens', notice = '', chatId = '' } = {}) {
  const targetView = view === 'pro' ? 'pro' : 'tokens';
  const existing = await hubRow(env, telegramId);
  const targetChat = String(chatId || existing?.chat_id || telegramId);
  const payload = await renderLaunchView(env, telegramId, targetView, notice);
  if (existing?.message_id) {
    try {
      await telegramApi(env, 'editMessageText', {
        chat_id: targetChat,
        message_id: Number(existing.message_id),
        text: payload.text,
        reply_markup: payload.reply_markup
      });
      await saveHub(env, telegramId, targetChat, existing.message_id, targetView);
      return true;
    } catch (_) { /* create replacement below */ }
  }
  try {
    const sent = await telegramApi(env, 'sendMessage', { chat_id: targetChat, text: payload.text, reply_markup: payload.reply_markup });
    if (sent?.message_id) await saveHub(env, telegramId, targetChat, sent.message_id, targetView);
    return true;
  } catch (_) { return false; }
}

async function createTokenOrder(env, telegramId, pack) {
  const id = crypto.randomUUID();
  const invoicePayload = `pct:${id}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO ai_token_orders (id, telegram_id, pack, tokens, stars, currency, invoice_payload, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'XTR', ?, 'pending', ?)
  `).bind(id, String(telegramId), pack.id, pack.tokens, pack.stars, invoicePayload, now).run();
  return { id, invoicePayload };
}

async function sendTokenInvoice(env, telegramId, pack) {
  const order = await createTokenOrder(env, telegramId, pack);
  await telegramApi(env, 'sendInvoice', {
    chat_id: String(telegramId),
    title: `PromptCam AI · ${pack.tokens} токенов`,
    description: 'AI-токены для Live AI, AI Дубля и AI-редактора сценариев.',
    payload: order.invoicePayload,
    currency: 'XTR',
    prices: [{ label: `${pack.tokens} AI-токенов`, amount: pack.stars }]
  });
  await env.DB.prepare(`UPDATE ai_token_orders SET status = 'invoice_sent' WHERE id = ?`).bind(order.id).run();
}

function isPurchaseCallback(data) {
  return data.startsWith('pch:token:') || data.startsWith('pch:pro:') || data.startsWith('ait:buy:');
}

async function backToView(env, telegramId, chatId, back) {
  if (back === 'tokens' || back === 'pro') return refreshLaunchPaymentHub(env, telegramId, { view: back, chatId });
  return refreshPaymentHub(env, telegramId, { view: 'main', chatId });
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
  const query = update?.callback_query;
  const from = message?.from || query?.from;
  const telegramId = String(from?.id || '');
  if (!telegramId) return null;
  await ensureBotUser(env, from);

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
          '🛟 Поддержка PromptCam', '',
          'Отправь следующим сообщением описание проблемы. Для оплаты укажи, что покупал и примерно когда.',
          'Не отправляй пароли, коды Telegram или данные банковских карт.', '',
          'Telegram Support не обрабатывает покупки PromptCam — обращение попадёт разработчику PromptCam.'
        ].join('\n')
      });
      return json({ ok: true });
    }
    if (command === '/tokens') {
      await refreshLaunchPaymentHub(env, telegramId, { view: 'tokens', chatId });
      return json({ ok: true });
    }
    if (command === '/pro' || command === '/tariff' || command === '/тариф') {
      await refreshLaunchPaymentHub(env, telegramId, { view: 'pro', chatId });
      return json({ ok: true });
    }
    if (!command.startsWith('/') && await supportPending(env, telegramId)) {
      const ticketId = await createSupportTicket(env, telegramId, chatId, message.text);
      await telegramApi(env, 'sendMessage', {
        chat_id: chatId,
        text: ticketId ? `✅ Обращение #${ticketId} принято.` : 'Не удалось сохранить обращение. Попробуй ещё раз через /paysupport.'
      });
      return json({ ok: true });
    }
  }

  const data = String(query?.data || '');
  if (!query || !data) return null;
  const chatId = String(query.message?.chat?.id || telegramId);
  const messageId = Number(query.message?.message_id || 0);

  if (data.startsWith(LEGAL_CALLBACK)) {
    const [action, back = 'main'] = data.slice(LEGAL_CALLBACK.length).split(':');
    if (action === 'accept') {
      const saved = await saveConsent(env, telegramId);
      await answerCallback(env, query, saved ? 'Условия приняты' : 'Не удалось сохранить согласие');
      if (saved) await backToView(env, telegramId, chatId, back);
      return json({ ok: true });
    }
    if (action === 'back') {
      await answerCallback(env, query);
      await backToView(env, telegramId, chatId, back);
      return json({ ok: true });
    }
  }

  if (data === 'pch:view:tokens') {
    await answerCallback(env, query);
    await refreshLaunchPaymentHub(env, telegramId, { view: 'tokens', chatId });
    return json({ ok: true });
  }
  if (data === 'pch:view:pro') {
    await answerCallback(env, query);
    await refreshLaunchPaymentHub(env, telegramId, { view: 'pro', chatId });
    return json({ ok: true });
  }

  if (isPurchaseCallback(data) && !await hasCurrentConsent(env, telegramId)) {
    await answerCallback(env, query, 'Сначала прими условия PromptCam');
    const back = data.includes('pro:') ? 'pro' : 'tokens';
    await showLegalMessage(env, telegramId, chatId, origin, messageId, back);
    return json({ ok: true });
  }

  if (data.startsWith('pch:token:')) {
    const pack = TOKEN_PACKS[data.slice('pch:token:'.length)];
    await answerCallback(env, query, pack ? 'Счёт отправлен в чат' : 'Пакет недоступен');
    if (pack) {
      try {
        await sendTokenInvoice(env, telegramId, pack);
        await refreshLaunchPaymentHub(env, telegramId, { view: 'tokens', notice: `🧾 Счёт на ${pack.tokens} токенов · ⭐${pack.stars} отправлен ниже.`, chatId });
      } catch (_) {
        await refreshLaunchPaymentHub(env, telegramId, { view: 'tokens', notice: 'Не удалось создать счёт. Попробуй ещё раз.', chatId });
      }
    }
    return json({ ok: true });
  }

  if (data.startsWith('pch:pro:')) {
    const planId = data.slice('pch:pro:'.length);
    const plan = LAUNCH_PLANS[planId];
    await answerCallback(env, query, plan ? 'Счёт PromptCam Pro отправлен' : 'Тариф недоступен');
    if (plan) {
      try {
        await sendLaunchProInvoice(env, telegramId, planId);
        await refreshLaunchPaymentHub(env, telegramId, { view: 'pro', notice: `🧾 Счёт PromptCam Pro · ${plan.title} · ⭐${plan.stars} отправлен ниже.`, chatId });
      } catch (_) {
        await refreshLaunchPaymentHub(env, telegramId, { view: 'pro', notice: 'Не удалось создать счёт. Попробуй ещё раз.', chatId });
      }
    }
    return json({ ok: true });
  }

  return null;
}

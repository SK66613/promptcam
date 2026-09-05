const HUB_CALLBACK = 'pch:';
const TEST_TOKEN_PACK = Object.freeze({ id: 'test60', tokens: 60, stars: 1, prefix: 'pcttest:' });
const TOKEN_PACKS = Object.freeze({
  creator: { id: 'creator', tokens: 250, stars: 79, prefix: 'pct:' },
  studio: { id: 'studio', tokens: 800, stars: 199, prefix: 'pct:' }
});
const PRO_PLANS = Object.freeze({
  day: { id: 'day', title: '1 день', stars: 1, recurring: false, description: 'PromptCam Pro на 24 часа' },
  week: { id: 'week', title: '7 дней', stars: 75, recurring: false, description: 'PromptCam Pro на 7 дней' },
  month: { id: 'month', title: '30 дней', stars: 199, recurring: true, subscriptionPeriod: 30 * 24 * 60 * 60, description: 'PromptCam Pro с ежемесячным продлением' },
  year: { id: 'year', title: '1 год', stars: 999, recurring: false, description: 'PromptCam Pro на 365 дней' }
});

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

function requireDb(env) {
  return env.DB && typeof env.DB.prepare === 'function';
}

async function telegramApi(env, method, payload, { allowNotModified = false } = {}) {
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
    const error = new Error(`telegram_${method}_failed`);
    error.description = description;
    throw error;
  }
  return data.result;
}

async function ensureSchema(env) {
  if (!requireDb(env)) return false;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS bot_payment_hubs (
        telegram_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        view TEXT NOT NULL DEFAULT 'main',
        updated_at INTEGER NOT NULL
      )
    `).run();
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureWallet(env, telegramId) {
  if (!requireDb(env)) return null;
  const now = Math.floor(Date.now() / 1000);
  try {
    const created = await env.DB.prepare(`
      INSERT OR IGNORE INTO ai_token_wallets (
        telegram_id, balance, lifetime_purchased, lifetime_spent,
        low_alert_sent, empty_alert_sent, created_at, updated_at
      ) VALUES (?, 20, 0, 0, 0, 0, ?, ?)
    `).bind(telegramId, now, now).run();
    const changes = Number(created?.meta?.changes ?? created?.changes ?? 0);
    if (changes > 0) {
      await env.DB.prepare(`
        INSERT INTO ai_token_ledger (
          telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
        ) VALUES (?, 20, 20, 'starter', '', 'starter', 0, ?)
      `).bind(telegramId, now).run();
    }
    return env.DB.prepare(`SELECT balance, lifetime_purchased, lifetime_spent FROM ai_token_wallets WHERE telegram_id = ? LIMIT 1`).bind(telegramId).first();
  } catch (_) {
    return null;
  }
}

async function readAccess(env, telegramId) {
  if (!requireDb(env)) return { pro: false, plan: '', expiresAt: 0, recurring: false };
  try {
    const row = await env.DB.prepare(`
      SELECT plan, access_until, recurring
      FROM entitlements WHERE telegram_id = ? LIMIT 1
    `).bind(telegramId).first();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(row?.access_until || 0);
    return {
      pro: expiresAt > now,
      plan: expiresAt > now ? String(row?.plan || '') : '',
      expiresAt: expiresAt > now ? expiresAt : 0,
      recurring: expiresAt > now ? Boolean(row?.recurring) : false
    };
  } catch (_) {
    return { pro: false, plan: '', expiresAt: 0, recurring: false };
  }
}

async function readTopups(env, telegramId, limit = 4) {
  if (!requireDb(env)) return [];
  try {
    const result = await env.DB.prepare(`
      SELECT delta, kind, stars, created_at
      FROM ai_token_ledger
      WHERE telegram_id = ? AND kind IN ('starter', 'purchase')
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(telegramId, limit).all();
    return Array.isArray(result?.results) ? result.results : [];
  } catch (_) {
    return [];
  }
}

function dateLabel(seconds) {
  if (!seconds) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(Number(seconds) * 1000));
  } catch (_) {
    return '';
  }
}

function expiryLabel(seconds) {
  if (!seconds) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(Number(seconds) * 1000));
  } catch (_) {
    return '';
  }
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⚡ Токены', callback_data: `${HUB_CALLBACK}view:tokens` },
        { text: '⭐ Тариф', callback_data: `${HUB_CALLBACK}view:pro` }
      ],
      [{ text: '🔄 Обновить', callback_data: `${HUB_CALLBACK}view:main` }]
    ]
  };
}

function tokensKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🧪 60 токенов · ⭐1', callback_data: `${HUB_CALLBACK}token:test60` }],
      [
        { text: '250 · ⭐79', callback_data: `${HUB_CALLBACK}token:creator` },
        { text: '800 · ⭐199', callback_data: `${HUB_CALLBACK}token:studio` }
      ],
      [
        { text: '↩️ Меню', callback_data: `${HUB_CALLBACK}view:main` },
        { text: '🔄 Обновить', callback_data: `${HUB_CALLBACK}view:tokens` }
      ]
    ]
  };
}

function proKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '1 день · ⭐1', callback_data: `${HUB_CALLBACK}pro:day` },
        { text: '7 дней · ⭐75', callback_data: `${HUB_CALLBACK}pro:week` }
      ],
      [
        { text: '30 дней · ⭐199', callback_data: `${HUB_CALLBACK}pro:month` },
        { text: '1 год · ⭐999', callback_data: `${HUB_CALLBACK}pro:year` }
      ],
      [
        { text: '↩️ Меню', callback_data: `${HUB_CALLBACK}view:main` },
        { text: '🔄 Обновить', callback_data: `${HUB_CALLBACK}view:pro` }
      ]
    ]
  };
}

async function renderPayload(env, telegramId, view = 'main', notice = '') {
  const wallet = await ensureWallet(env, telegramId);
  const access = await readAccess(env, telegramId);
  const balance = Number(wallet?.balance || 0);
  const prefix = notice ? `${notice}\n\n` : '';

  if (view === 'tokens') {
    const rows = await readTopups(env, telegramId);
    const history = rows.length
      ? rows.map((row) => `${dateLabel(row.created_at)} · +${Number(row.delta || 0)}${Number(row.stars || 0) ? ` · ⭐${Number(row.stars)}` : ' · подарок'}`).join('\n')
      : 'Пока без пополнений.';
    return {
      text: `${prefix}⚡ AI-токены PromptCam\n\nБаланс: ${balance}\n\nПоследние пополнения:\n${history}\n\n🧪 ⭐1 — временный пакет для теста платёжной цепочки.`,
      reply_markup: tokensKeyboard()
    };
  }

  if (view === 'pro') {
    const status = access.pro
      ? `✅ PromptCam Pro активен${access.expiresAt ? ` до ${expiryLabel(access.expiresAt)}` : ''}${access.recurring ? ' · автопродление' : ''}.`
      : 'Сейчас PromptCam Free · новые записи сохраняются с водяным знаком.';
    return {
      text: `${prefix}⭐ Тариф PromptCam\n\n${status}\n\nВыбери срок доступа. Оплата — Telegram Stars.`,
      reply_markup: proKeyboard()
    };
  }

  const proLine = access.pro
    ? `Pro: активен${access.expiresAt ? ` до ${expiryLabel(access.expiresAt)}` : ''}`
    : 'Pro: Free';
  return {
    text: `${prefix}🎬 PromptCam\n\n⚡ AI-токены: ${balance}\n⭐ ${proLine}\n\nЗдесь можно пополнить AI или управлять тарифом. Меню остаётся одним сообщением и обновляется на месте.`,
    reply_markup: mainKeyboard()
  };
}

async function saveHub(env, telegramId, chatId, messageId, view) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO bot_payment_hubs (telegram_id, chat_id, message_id, view, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      message_id = excluded.message_id,
      view = excluded.view,
      updated_at = excluded.updated_at
  `).bind(telegramId, String(chatId), Number(messageId), view, now).run();
}

async function hubRow(env, telegramId) {
  if (!await ensureSchema(env)) return null;
  return env.DB.prepare(`SELECT chat_id, message_id, view FROM bot_payment_hubs WHERE telegram_id = ? LIMIT 1`).bind(telegramId).first();
}

export async function refreshPaymentHub(env, telegramId, { view = '', notice = '', chatId = '' } = {}) {
  if (!telegramId || !env.TELEGRAM_BOT_TOKEN || !await ensureSchema(env)) return false;
  const existing = await hubRow(env, telegramId);
  const targetView = view || String(existing?.view || 'main');
  const targetChat = String(chatId || existing?.chat_id || telegramId);
  const payload = await renderPayload(env, telegramId, targetView, notice);

  if (existing?.message_id) {
    try {
      await telegramApi(env, 'editMessageText', {
        chat_id: targetChat,
        message_id: Number(existing.message_id),
        text: payload.text,
        reply_markup: payload.reply_markup
      }, { allowNotModified: true });
      await saveHub(env, telegramId, targetChat, existing.message_id, targetView);
      return true;
    } catch (_) {
      // Message may have been deleted by the user. Fall through and create one replacement hub.
    }
  }

  try {
    const message = await telegramApi(env, 'sendMessage', {
      chat_id: targetChat,
      text: payload.text,
      reply_markup: payload.reply_markup
    });
    if (message?.message_id) await saveHub(env, telegramId, targetChat, message.message_id, targetView);
    return true;
  } catch (_) {
    return false;
  }
}

async function answerCallback(env, query, text = '') {
  try {
    await telegramApi(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      ...(text ? { text } : {})
    });
  } catch (_) { /* best effort */ }
}

async function createTokenOrder(env, telegramId, pack) {
  const id = crypto.randomUUID();
  const invoicePayload = `${pack.prefix}${id}`;
  const now = Math.floor(Date.now() / 1000);
  await ensureWallet(env, telegramId);
  await env.DB.prepare(`
    INSERT INTO ai_token_orders (
      id, telegram_id, pack, tokens, stars, currency, invoice_payload, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'XTR', ?, 'pending', ?)
  `).bind(id, telegramId, pack.id, pack.tokens, pack.stars, invoicePayload, now).run();
  return { id, invoicePayload };
}

async function sendTokenInvoice(env, telegramId, pack) {
  const order = await createTokenOrder(env, telegramId, pack);
  await telegramApi(env, 'sendInvoice', {
    chat_id: telegramId,
    title: `PromptCam AI · ${pack.tokens} токенов`,
    description: pack.id === 'test60'
      ? 'Временный тестовый пакет PromptCam AI за 1 Telegram Star.'
      : 'AI-токены для Live AI, AI Дубля и AI-редактора сценариев.',
    payload: order.invoicePayload,
    currency: 'XTR',
    prices: [{ label: `${pack.tokens} AI-токенов`, amount: pack.stars }]
  });
  await env.DB.prepare(`UPDATE ai_token_orders SET status = 'invoice_sent' WHERE id = ?`).bind(order.id).run();
}

async function createProOrder(env, telegramId, plan) {
  const id = crypto.randomUUID();
  const invoicePayload = `pc:${id}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO billing_orders (id, telegram_id, plan, stars, currency, invoice_payload, status, created_at)
    VALUES (?, ?, ?, ?, 'XTR', ?, 'pending', ?)
  `).bind(id, telegramId, plan.id, plan.stars, invoicePayload, now).run();
  return { id, invoicePayload };
}

async function sendProInvoice(env, telegramId, plan) {
  const order = await createProOrder(env, telegramId, plan);
  const payload = {
    chat_id: telegramId,
    title: `PromptCam Pro · ${plan.title}`,
    description: plan.description,
    payload: order.invoicePayload,
    currency: 'XTR',
    prices: [{ label: `PromptCam Pro · ${plan.title}`, amount: plan.stars }]
  };
  if (plan.recurring) payload.subscription_period = plan.subscriptionPeriod;
  await telegramApi(env, 'sendInvoice', payload);
}

function command(text) {
  const value = String(text || '').trim().toLowerCase().split('@')[0];
  if (value === '/tokens') return 'tokens';
  if (value === '/pro' || value === '/tariff' || value === '/тариф') return 'pro';
  if (value === '/shop' || value === '/start' || value === '/pay') return 'main';
  return '';
}

export async function maybeHandlePaymentHub(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET || !requireDb(env)) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;

  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }

  const messageView = command(update?.message?.text);
  if (messageView) {
    const telegramId = String(update.message?.from?.id || '');
    const chatId = String(update.message?.chat?.id || telegramId);
    if (telegramId) await refreshPaymentHub(env, telegramId, { view: messageView, chatId });
    return json({ ok: true });
  }

  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!query || !data.startsWith(HUB_CALLBACK)) return null;
  const telegramId = String(query.from?.id || '');
  const chatId = String(query.message?.chat?.id || telegramId);
  if (!telegramId) return json({ ok: true, ignored: true });

  // Adopt the exact hub message that was tapped, even if the user had deleted an older one.
  if (query.message?.message_id && await ensureSchema(env)) {
    await saveHub(env, telegramId, chatId, query.message.message_id, data.includes('view:pro') ? 'pro' : data.includes('view:tokens') ? 'tokens' : 'main');
  }

  if (data.startsWith(`${HUB_CALLBACK}view:`)) {
    const view = data.slice(`${HUB_CALLBACK}view:`.length);
    const safeView = view === 'tokens' || view === 'pro' ? view : 'main';
    await answerCallback(env, query);
    await refreshPaymentHub(env, telegramId, { view: safeView, chatId });
    return json({ ok: true });
  }

  if (data.startsWith(`${HUB_CALLBACK}token:`)) {
    const packId = data.slice(`${HUB_CALLBACK}token:`.length);
    const pack = packId === TEST_TOKEN_PACK.id ? TEST_TOKEN_PACK : TOKEN_PACKS[packId];
    await answerCallback(env, query, pack ? 'Счёт отправлен в чат' : 'Пакет недоступен');
    if (pack) {
      try {
        await sendTokenInvoice(env, telegramId, pack);
        await refreshPaymentHub(env, telegramId, { view: 'tokens', notice: `🧾 Счёт на ${pack.tokens} токенов · ⭐${pack.stars} отправлен ниже.`, chatId });
      } catch (_) {
        await refreshPaymentHub(env, telegramId, { view: 'tokens', notice: 'Не удалось создать счёт. Нажми пакет ещё раз.', chatId });
      }
    }
    return json({ ok: true });
  }

  if (data.startsWith(`${HUB_CALLBACK}pro:`)) {
    const planId = data.slice(`${HUB_CALLBACK}pro:`.length);
    const plan = PRO_PLANS[planId];
    await answerCallback(env, query, plan ? 'Счёт PromptCam Pro отправлен' : 'Тариф недоступен');
    if (plan) {
      try {
        await sendProInvoice(env, telegramId, plan);
        await refreshPaymentHub(env, telegramId, { view: 'pro', notice: `🧾 Счёт PromptCam Pro · ${plan.title} · ⭐${plan.stars} отправлен ниже.`, chatId });
      } catch (_) {
        await refreshPaymentHub(env, telegramId, { view: 'pro', notice: 'Не удалось создать счёт. Попробуй ещё раз.', chatId });
      }
    }
    return json({ ok: true });
  }

  return json({ ok: true });
}

export async function maybeRefreshHubAfterProPayment(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return false;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return false; }
  const payment = update?.message?.successful_payment;
  if (!payment || !String(payment.invoice_payload || '').startsWith('pc:')) return false;
  const telegramId = String(update.message?.from?.id || '');
  if (!telegramId) return false;
  await refreshPaymentHub(env, telegramId, { view: 'pro', notice: '✅ Оплата PromptCam Pro прошла. Тариф обновлён.' });
  return true;
}

import app from './speech-context-entry.js';

const TEST_PACK = Object.freeze({ id: 'test60', title: 'Тест', tokens: 60, stars: 1, test: true });
const PAYLOAD_PREFIX = 'pcttest:';
const CALLBACK_BUY = 'ait:buy:test60';
const CALLBACK_HISTORY = 'ait:history';
const STARTER_TOKENS = 20;

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

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function telegramApi(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('telegram_not_configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(`telegram_api_${method}_failed`);
  return data.result;
}

async function ensureSchema(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') return false;
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS ai_token_wallets (
          telegram_id TEXT PRIMARY KEY,
          balance INTEGER NOT NULL DEFAULT 20,
          lifetime_purchased INTEGER NOT NULL DEFAULT 0,
          lifetime_spent INTEGER NOT NULL DEFAULT 0,
          low_alert_sent INTEGER NOT NULL DEFAULT 0,
          empty_alert_sent INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS ai_token_orders (
          id TEXT PRIMARY KEY,
          telegram_id TEXT NOT NULL,
          pack TEXT NOT NULL,
          tokens INTEGER NOT NULL,
          stars INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'XTR',
          invoice_payload TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          telegram_payment_charge_id TEXT UNIQUE,
          created_at INTEGER NOT NULL,
          paid_at INTEGER
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS ai_token_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id TEXT NOT NULL,
          delta INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          kind TEXT NOT NULL,
          feature TEXT NOT NULL DEFAULT '',
          reference TEXT NOT NULL DEFAULT '',
          stars INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `)
    ]);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureWallet(env, telegramId) {
  if (!await ensureSchema(env)) return null;
  const now = Math.floor(Date.now() / 1000);
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO ai_token_wallets (
      telegram_id, balance, lifetime_purchased, lifetime_spent,
      low_alert_sent, empty_alert_sent, created_at, updated_at
    ) VALUES (?, ?, 0, 0, 0, 0, ?, ?)
  `).bind(telegramId, STARTER_TOKENS, now, now).run();
  if (changes(insert) > 0) {
    await env.DB.prepare(`
      INSERT INTO ai_token_ledger (
        telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
      ) VALUES (?, ?, ?, 'starter', '', 'starter', 0, ?)
    `).bind(telegramId, STARTER_TOKENS, STARTER_TOKENS, now).run();
  }
  return env.DB.prepare(`SELECT * FROM ai_token_wallets WHERE telegram_id = ? LIMIT 1`).bind(telegramId).first();
}

async function authenticate(request, env, ctx, initData) {
  if (typeof initData !== 'string' || !initData || initData.length > 20_000) {
    return { ok: false, response: json({ ok: false, error: 'invalid_init_data' }, 400) };
  }
  const sessionRequest = new Request(new URL('/api/telegram/session', request.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData })
  });
  const response = await app.fetch(sessionRequest, env, ctx);
  if (!response.ok) return { ok: false, response };
  const data = await response.json().catch(() => null);
  if (!data?.ok || !data?.user?.id) return { ok: false, response: json({ ok: false, error: 'invalid_telegram_session' }, 401) };
  return { ok: true, user: data.user };
}

function invoiceBody(order) {
  return {
    title: `PromptCam AI · тест ${TEST_PACK.tokens} токенов`,
    description: 'Временный тестовый пакет PromptCam AI за 1 Telegram Star.',
    payload: order.invoicePayload,
    currency: 'XTR',
    prices: [{ label: `${TEST_PACK.tokens} AI-токенов · тест`, amount: TEST_PACK.stars }]
  };
}

async function createOrder(env, telegramId) {
  await ensureWallet(env, telegramId);
  const id = crypto.randomUUID();
  const invoicePayload = `${PAYLOAD_PREFIX}${id}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO ai_token_orders (
      id, telegram_id, pack, tokens, stars, currency, invoice_payload, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'XTR', ?, 'pending', ?)
  `).bind(id, telegramId, TEST_PACK.id, TEST_PACK.tokens, TEST_PACK.stars, invoicePayload, now).run();
  return { id, telegramId, invoicePayload };
}

async function createInvoiceLink(env, telegramId) {
  const order = await createOrder(env, telegramId);
  const invoiceUrl = await telegramApi(env, 'createInvoiceLink', invoiceBody(order));
  await env.DB.prepare(`UPDATE ai_token_orders SET status = 'invoice_sent' WHERE id = ?`).bind(order.id).run();
  return { invoiceUrl, pack: TEST_PACK };
}

async function sendInvoice(env, telegramId) {
  const order = await createOrder(env, telegramId);
  await telegramApi(env, 'sendInvoice', { chat_id: telegramId, ...invoiceBody(order) });
  await env.DB.prepare(`UPDATE ai_token_orders SET status = 'invoice_sent' WHERE id = ?`).bind(order.id).run();
}

function shopKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🧪 60 токенов · ⭐1', callback_data: CALLBACK_BUY }],
      [
        { text: '250 токенов · ⭐79', callback_data: 'ait:buy:creator' },
        { text: '800 токенов · ⭐199', callback_data: 'ait:buy:studio' }
      ],
      [{ text: '📜 История пополнений', callback_data: CALLBACK_HISTORY }]
    ]
  };
}

async function sendShop(env, telegramId) {
  const wallet = await ensureWallet(env, telegramId);
  if (!wallet) return;
  await telegramApi(env, 'sendMessage', {
    chat_id: telegramId,
    text: `⚡ PromptCam AI\n\nБаланс: ${Number(wallet.balance || 0)} токенов.\n\n🧪 Пакет за ⭐1 временный — только для проверки платёжной цепочки.`,
    reply_markup: shopKeyboard()
  });
}

async function answerPreCheckout(env, query, ok) {
  const payload = { pre_checkout_query_id: query.id, ok: Boolean(ok) };
  if (!ok) payload.error_message = 'Не удалось проверить тестовый пакет PromptCam AI. Создай новый счёт.';
  await telegramApi(env, 'answerPreCheckoutQuery', payload);
}

async function handlePreCheckout(env, query) {
  const payload = String(query?.invoice_payload || '');
  const order = await env.DB.prepare(`
    SELECT id, telegram_id, pack, tokens, stars, status
    FROM ai_token_orders WHERE invoice_payload = ? LIMIT 1
  `).bind(payload).first();
  const valid = Boolean(
    order && order.pack === TEST_PACK.id &&
    Number(order.tokens) === TEST_PACK.tokens && Number(order.stars) === TEST_PACK.stars &&
    String(query.from?.id || '') === String(order.telegram_id) &&
    query.currency === 'XTR' && Number(query.total_amount) === TEST_PACK.stars &&
    !['credited', 'failed'].includes(String(order.status || ''))
  );
  await answerPreCheckout(env, query, valid);
}

async function creditPayment(env, message) {
  const payment = message?.successful_payment;
  const telegramId = String(message?.from?.id || '');
  const payload = String(payment?.invoice_payload || '');
  if (!payment || !telegramId || !payload.startsWith(PAYLOAD_PREFIX) || payment.currency !== 'XTR') return false;
  await ensureWallet(env, telegramId);

  const order = await env.DB.prepare(`
    SELECT id, telegram_id, pack, tokens, stars, status, telegram_payment_charge_id
    FROM ai_token_orders WHERE invoice_payload = ? LIMIT 1
  `).bind(payload).first();
  if (!order || String(order.telegram_id) !== telegramId || order.pack !== TEST_PACK.id) return false;
  if (Number(order.tokens) !== TEST_PACK.tokens || Number(order.stars) !== TEST_PACK.stars || Number(payment.total_amount) !== TEST_PACK.stars) return false;

  const chargeId = String(payment.telegram_payment_charge_id || '');
  if (!chargeId) return false;
  if (order.status === 'credited') return true;
  if (order.telegram_payment_charge_id && String(order.telegram_payment_charge_id) !== chargeId) return false;

  const now = Number(message.date || Math.floor(Date.now() / 1000));
  const claim = `crediting:${crypto.randomUUID()}`;
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE ai_token_orders
      SET status = ?, telegram_payment_charge_id = ?, paid_at = ?
      WHERE id = ? AND status IN ('pending', 'invoice_sent', 'paid_uncredited')
        AND (telegram_payment_charge_id IS NULL OR telegram_payment_charge_id = ?)
    `).bind(claim, chargeId, now, order.id, chargeId),
    env.DB.prepare(`
      UPDATE ai_token_wallets
      SET balance = balance + ?, lifetime_purchased = lifetime_purchased + ?,
          low_alert_sent = 0, empty_alert_sent = 0, updated_at = ?
      WHERE telegram_id = ? AND EXISTS (
        SELECT 1 FROM ai_token_orders WHERE id = ? AND status = ?
      )
    `).bind(TEST_PACK.tokens, TEST_PACK.tokens, now, telegramId, order.id, claim),
    env.DB.prepare(`
      INSERT INTO ai_token_ledger (
        telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
      )
      SELECT ?, ?, balance, 'purchase', '', ?, ?, ?
      FROM ai_token_wallets WHERE telegram_id = ? AND EXISTS (
        SELECT 1 FROM ai_token_orders WHERE id = ? AND status = ?
      )
    `).bind(telegramId, TEST_PACK.tokens, order.id, TEST_PACK.stars, now, telegramId, order.id, claim),
    env.DB.prepare(`UPDATE ai_token_orders SET status = 'credited' WHERE id = ? AND status = ?`).bind(order.id, claim)
  ]);

  if (changes(results?.[0]) < 1) return true;
  const wallet = await env.DB.prepare(`SELECT balance FROM ai_token_wallets WHERE telegram_id = ? LIMIT 1`).bind(telegramId).first();
  await telegramApi(env, 'sendMessage', {
    chat_id: telegramId,
    text: `✅ Тестовая оплата прошла. +${TEST_PACK.tokens} AI-токенов.\n\nБаланс: ${Number(wallet?.balance || 0)} токенов.`,
    reply_markup: shopKeyboard()
  });
  return true;
}

export async function handleTestPackApi(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'invalid_json' }, 400); }
  const auth = await authenticate(request, env, ctx, body?.initData || '');
  if (!auth.ok) return auth.response;
  if (!await ensureSchema(env)) return json({ ok: false, error: 'ai_wallet_database_unavailable' }, 503);
  try {
    const invoice = await createInvoiceLink(env, String(auth.user.id));
    return json({ ok: true, invoiceUrl: invoice.invoiceUrl, pack: invoice.pack });
  } catch (_) {
    return json({ ok: false, error: 'token_test_invoice_failed' }, 502);
  }
}

export async function maybeHandleTestTokenWebhook(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET || !env.DB) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }

  const callback = update?.callback_query;
  if (callback?.data === CALLBACK_BUY) {
    const telegramId = String(callback.from?.id || '');
    if (telegramId) {
      try {
        await telegramApi(env, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Открываю тестовый счёт ⭐1' });
        await sendInvoice(env, telegramId);
      } catch (_) { /* Telegram will allow retry from the same shop. */ }
    }
    return json({ ok: true });
  }

  const text = String(update?.message?.text || '').trim().toLowerCase();
  if (text === '/tokens' || text === '/tokens@promptcam') {
    const telegramId = String(update.message?.from?.id || '');
    if (telegramId) {
      try { await sendShop(env, telegramId); } catch (_) { /* best effort */ }
    }
    return json({ ok: true });
  }

  const pre = update?.pre_checkout_query;
  if (pre && String(pre.invoice_payload || '').startsWith(PAYLOAD_PREFIX)) {
    try { await handlePreCheckout(env, pre); }
    catch (_) { try { await answerPreCheckout(env, pre, false); } catch (_) { /* best effort */ } }
    return json({ ok: true });
  }

  const payment = update?.message?.successful_payment;
  if (payment && String(payment.invoice_payload || '').startsWith(PAYLOAD_PREFIX)) {
    try {
      await creditPayment(env, update.message);
      return json({ ok: true });
    } catch (_) {
      return json({ ok: false, error: 'token_test_credit_failed' }, 500);
    }
  }

  return null;
}

export function testTokenPack() {
  return { ...TEST_PACK };
}

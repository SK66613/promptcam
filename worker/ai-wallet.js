import app from './speech-context-entry.js';

const STARTER_TOKENS = 20;
const LOW_BALANCE_THRESHOLD = 5;
const LIVE_MINUTE_COST = 1;
const SCRIPT_EDIT_COST = 2;
const FAVORITE_INSERT_COST = 1;
const TOKEN_PAYLOAD_PREFIX = 'pct:';
const CALLBACK_PREFIX = 'ait:';
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export const TOKEN_PACKS = Object.freeze({
  start: { id: 'start', title: 'Старт', tokens: 60, stars: 25 },
  creator: { id: 'creator', title: 'Creator', tokens: 250, stars: 79 },
  studio: { id: 'studio', title: 'Studio', tokens: 800, stars: 199 }
});

let schemaReady = false;
let webhookReady = false;
let webhookPromise = null;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function publicPacks() {
  return Object.values(TOKEN_PACKS).map((pack) => ({ ...pack }));
}

function requireDatabase(env) {
  return env.DB && typeof env.DB.prepare === 'function';
}

async function telegramApi(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('telegram_not_configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const error = new Error(`telegram_api_${method}_failed`);
    error.description = typeof data?.description === 'string' ? data.description : '';
    throw error;
  }
  return data.result;
}

async function ensureSchema(env) {
  if (schemaReady) return true;
  if (!requireDatabase(env)) return false;
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
        CREATE INDEX IF NOT EXISTS idx_ai_token_orders_user_created
        ON ai_token_orders (telegram_id, created_at DESC)
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
      `),
      env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_ai_token_ledger_user_created
        ON ai_token_ledger (telegram_id, created_at DESC)
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS ai_token_live_minutes (
          telegram_id TEXT NOT NULL,
          minute_bucket INTEGER NOT NULL,
          feature TEXT NOT NULL,
          status TEXT NOT NULL,
          cost INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (telegram_id, minute_bucket, feature)
        )
      `)
    ]);
    schemaReady = true;
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
  return env.DB.prepare(`
    SELECT telegram_id, balance, lifetime_purchased, lifetime_spent,
           low_alert_sent, empty_alert_sent, created_at, updated_at
    FROM ai_token_wallets WHERE telegram_id = ? LIMIT 1
  `).bind(telegramId).first();
}

async function authenticate(request, env, ctx, initData) {
  if (typeof initData !== 'string' || !initData || initData.length > 20_000) {
    return { ok: false, response: json({ ok: false, error: 'invalid_init_data' }, 400) };
  }
  const sessionUrl = new URL('/api/telegram/session', request.url);
  const sessionRequest = new Request(sessionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData })
  });
  const response = await app.fetch(sessionRequest, env, ctx);
  if (!response.ok) return { ok: false, response };
  const payload = await response.json().catch(() => null);
  if (!payload?.ok || !payload?.user?.id) {
    return { ok: false, response: json({ ok: false, error: 'invalid_telegram_session' }, 401) };
  }
  return { ok: true, user: payload.user };
}

function purchaseKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '60 токенов · ⭐25', callback_data: `${CALLBACK_PREFIX}buy:start` },
        { text: '250 токенов · ⭐79', callback_data: `${CALLBACK_PREFIX}buy:creator` }
      ],
      [{ text: '800 токенов · ⭐199', callback_data: `${CALLBACK_PREFIX}buy:studio` }],
      [{ text: '📜 История пополнений', callback_data: `${CALLBACK_PREFIX}history` }]
    ]
  };
}

async function readTopups(env, telegramId, limit = 8) {
  const result = await env.DB.prepare(`
    SELECT delta, kind, stars, created_at
    FROM ai_token_ledger
    WHERE telegram_id = ? AND kind IN ('starter', 'purchase')
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(telegramId, limit).all();
  return Array.isArray(result?.results) ? result.results : [];
}

function formatTopupHistory(rows, balance) {
  if (!rows.length) return `📜 Пополнений пока нет.\n\nБаланс: ${balance} AI-токенов.`;
  const lines = rows.map((row) => {
    const date = new Date(Number(row.created_at || 0) * 1000).toISOString().slice(0, 10);
    if (row.kind === 'starter') return `${date} · +${row.delta} · стартовый подарок`;
    return `${date} · +${row.delta} · ⭐${row.stars}`;
  });
  return `📜 Последние пополнения\n\n${lines.join('\n')}\n\nБаланс: ${balance} AI-токенов.`;
}

async function sendHistory(env, telegramId) {
  const wallet = await ensureWallet(env, telegramId);
  if (!wallet) return;
  const rows = await readTopups(env, telegramId);
  await telegramApi(env, 'sendMessage', {
    chat_id: telegramId,
    text: formatTopupHistory(rows, Number(wallet.balance || 0)),
    reply_markup: purchaseKeyboard()
  });
}

async function maybeSendBalanceAlert(env, telegramId) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const wallet = await ensureWallet(env, telegramId);
  if (!wallet) return;
  const balance = Number(wallet.balance || 0);
  try {
    if (balance <= 0 && !Number(wallet.empty_alert_sent || 0)) {
      await telegramApi(env, 'sendMessage', {
        chat_id: telegramId,
        text: '🪫 AI-токены закончились. AI Live, AI Дубль и AI-редактор приостановлены. Пополни баланс — и можно сразу продолжить.',
        reply_markup: purchaseKeyboard()
      });
      await env.DB.prepare(`
        UPDATE ai_token_wallets SET low_alert_sent = 1, empty_alert_sent = 1, updated_at = ?
        WHERE telegram_id = ?
      `).bind(Math.floor(Date.now() / 1000), telegramId).run();
      return;
    }
    if (balance > 0 && balance <= LOW_BALANCE_THRESHOLD && !Number(wallet.low_alert_sent || 0)) {
      await telegramApi(env, 'sendMessage', {
        chat_id: telegramId,
        text: `⚡ Осталось ${balance} AI-токенов. Лучше пополнить заранее, чтобы AI не остановился посреди дубля.`,
        reply_markup: purchaseKeyboard()
      });
      await env.DB.prepare(`
        UPDATE ai_token_wallets SET low_alert_sent = 1, updated_at = ? WHERE telegram_id = ?
      `).bind(Math.floor(Date.now() / 1000), telegramId).run();
    }
  } catch (_) {
    // Bot alerts are best-effort; AI usage itself must not fail because a message could not be sent.
  }
}

function queueBalanceAlert(ctx, env, telegramId) {
  const promise = maybeSendBalanceAlert(env, telegramId);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(promise);
  else promise.catch(() => {});
}

async function createOrder(env, telegramId, packId) {
  const pack = TOKEN_PACKS[packId];
  if (!pack) return null;
  await ensureWallet(env, telegramId);
  const id = crypto.randomUUID();
  const invoicePayload = `${TOKEN_PAYLOAD_PREFIX}${id}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO ai_token_orders (
      id, telegram_id, pack, tokens, stars, currency, invoice_payload, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'XTR', ?, 'pending', ?)
  `).bind(id, telegramId, pack.id, pack.tokens, pack.stars, invoicePayload, now).run();
  return { id, invoicePayload, pack };
}

function invoicePayload(order) {
  return {
    title: `PromptCam AI · ${order.pack.tokens} токенов`,
    description: 'AI-токены для Live AI, AI Дубля и AI-редактора сценариев.',
    payload: order.invoicePayload,
    currency: 'XTR',
    prices: [{ label: `${order.pack.tokens} AI-токенов`, amount: order.pack.stars }]
  };
}

async function sendPackInvoice(env, telegramId, packId) {
  const order = await createOrder(env, telegramId, packId);
  if (!order) throw new Error('unknown_token_pack');
  await telegramApi(env, 'sendInvoice', { chat_id: telegramId, ...invoicePayload(order) });
  await env.DB.prepare(`UPDATE ai_token_orders SET status = 'invoice_sent' WHERE id = ?`).bind(order.id).run();
  return order;
}

async function createPackInvoiceLink(env, telegramId, packId) {
  const order = await createOrder(env, telegramId, packId);
  if (!order) return null;
  const url = await telegramApi(env, 'createInvoiceLink', invoicePayload(order));
  await env.DB.prepare(`UPDATE ai_token_orders SET status = 'invoice_sent' WHERE id = ?`).bind(order.id).run();
  return { order, url };
}

async function answerPreCheckout(env, query, ok, errorMessage = '') {
  const payload = { pre_checkout_query_id: query.id, ok: Boolean(ok) };
  if (!ok && errorMessage) payload.error_message = errorMessage;
  await telegramApi(env, 'answerPreCheckoutQuery', payload);
}

async function handleTokenPreCheckout(env, query) {
  const order = await env.DB.prepare(`
    SELECT id, telegram_id, pack, tokens, stars, status
    FROM ai_token_orders WHERE invoice_payload = ? LIMIT 1
  `).bind(query.invoice_payload || '').first();
  const pack = order ? TOKEN_PACKS[order.pack] : null;
  const valid = Boolean(
    order && pack &&
    String(query.from?.id || '') === String(order.telegram_id) &&
    query.currency === 'XTR' &&
    Number(query.total_amount) === Number(order.stars) &&
    Number(query.total_amount) === Number(pack.stars) &&
    Number(order.tokens) === Number(pack.tokens) &&
    !['credited', 'failed'].includes(order.status)
  );
  await answerPreCheckout(env, query, valid, valid ? '' : 'Не удалось проверить пакет PromptCam AI. Создай новый счёт и попробуй ещё раз.');
}

async function creditTokenOrder(env, message) {
  const payment = message?.successful_payment;
  const telegramId = String(message?.from?.id || '');
  if (!payment || !telegramId || payment.currency !== 'XTR') return null;
  const order = await env.DB.prepare(`
    SELECT id, telegram_id, pack, tokens, stars, status, invoice_payload
    FROM ai_token_orders WHERE invoice_payload = ? LIMIT 1
  `).bind(payment.invoice_payload || '').first();
  if (!order || String(order.telegram_id) !== telegramId) return null;
  const pack = TOKEN_PACKS[order.pack];
  if (!pack || Number(payment.total_amount) !== Number(order.stars) || Number(order.stars) !== pack.stars) return null;
  const chargeId = String(payment.telegram_payment_charge_id || '');
  if (!chargeId) return null;
  await ensureWallet(env, telegramId);
  if (order.status === 'credited') return ensureWallet(env, telegramId);

  const paidAt = Number(message.date || Math.floor(Date.now() / 1000));
  await env.DB.prepare(`
    UPDATE ai_token_orders
    SET status = 'paid_uncredited', telegram_payment_charge_id = ?, paid_at = ?
    WHERE id = ? AND status != 'credited'
  `).bind(chargeId, paidAt, order.id).run();

  const fresh = await env.DB.prepare(`SELECT status FROM ai_token_orders WHERE id = ? LIMIT 1`).bind(order.id).first();
  if (fresh?.status !== 'paid_uncredited') return ensureWallet(env, telegramId);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE ai_token_wallets
      SET balance = balance + ?, lifetime_purchased = lifetime_purchased + ?,
          low_alert_sent = 0, empty_alert_sent = 0, updated_at = ?
      WHERE telegram_id = ?
    `).bind(pack.tokens, pack.tokens, paidAt, telegramId),
    env.DB.prepare(`
      INSERT INTO ai_token_ledger (
        telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
      ) SELECT ?, ?, balance, 'purchase', '', ?, ?, ?
        FROM ai_token_wallets WHERE telegram_id = ?
    `).bind(telegramId, pack.tokens, order.id, pack.stars, paidAt, telegramId),
    env.DB.prepare(`UPDATE ai_token_orders SET status = 'credited' WHERE id = ?`).bind(order.id)
  ]);

  const wallet = await ensureWallet(env, telegramId);
  try {
    await telegramApi(env, 'sendMessage', {
      chat_id: telegramId,
      text: `✅ +${pack.tokens} AI-токенов начислено.\n\nБаланс: ${Number(wallet?.balance || 0)} токенов.`,
      reply_markup: purchaseKeyboard()
    });
  } catch (_) { /* Receipt delivery is best-effort. */ }
  return wallet;
}

async function handleCallback(env, query) {
  const telegramId = String(query?.from?.id || '');
  const data = String(query?.data || '');
  if (!telegramId || !data.startsWith(CALLBACK_PREFIX)) return false;
  try { await telegramApi(env, 'answerCallbackQuery', { callback_query_id: query.id }); }
  catch (_) { /* Continue with the requested action. */ }

  if (data === `${CALLBACK_PREFIX}history`) {
    await sendHistory(env, telegramId);
    return true;
  }
  if (data.startsWith(`${CALLBACK_PREFIX}buy:`)) {
    const packId = data.slice(`${CALLBACK_PREFIX}buy:`.length);
    if (!TOKEN_PACKS[packId]) return true;
    await sendPackInvoice(env, telegramId, packId);
    return true;
  }
  return true;
}

export async function maybeHandleTokenWebhook(request, env) {
  if (request.method !== 'POST') return null;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }
  if (!await ensureSchema(env)) return json({ ok: false, error: 'ai_wallet_database_unavailable' }, 503);

  try {
    if (update.callback_query?.data?.startsWith(CALLBACK_PREFIX)) {
      await handleCallback(env, update.callback_query);
      return json({ ok: true });
    }
    if (update.pre_checkout_query?.invoice_payload?.startsWith(TOKEN_PAYLOAD_PREFIX)) {
      await handleTokenPreCheckout(env, update.pre_checkout_query);
      return json({ ok: true });
    }
    if (update.message?.successful_payment?.invoice_payload?.startsWith(TOKEN_PAYLOAD_PREFIX)) {
      await creditTokenOrder(env, update.message);
      return json({ ok: true });
    }
  } catch (_) {
    return json({ ok: false, error: 'ai_wallet_webhook_failed' }, 500);
  }
  return null;
}

async function readWalletSnapshot(env, telegramId) {
  const wallet = await ensureWallet(env, telegramId);
  if (!wallet) return null;
  return {
    balance: Number(wallet.balance || 0),
    lifetimePurchased: Number(wallet.lifetime_purchased || 0),
    lifetimeSpent: Number(wallet.lifetime_spent || 0),
    low: Number(wallet.balance || 0) <= LOW_BALANCE_THRESHOLD,
    empty: Number(wallet.balance || 0) <= 0
  };
}

export async function handleWalletApi(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'invalid_json' }, 400); }
  const auth = await authenticate(request, env, ctx, body?.initData || '');
  if (!auth.ok) return auth.response;
  if (!await ensureSchema(env)) return json({ ok: false, error: 'ai_wallet_database_unavailable' }, 503);
  const telegramId = String(auth.user.id);
  const action = body?.action === 'buy_pack' ? 'buy_pack' : 'status';

  if (action === 'buy_pack') {
    const packId = typeof body?.pack === 'string' ? body.pack : '';
    if (!TOKEN_PACKS[packId]) return json({ ok: false, error: 'unknown_token_pack' }, 400);
    try {
      const invoice = await createPackInvoiceLink(env, telegramId, packId);
      return json({ ok: true, invoiceUrl: invoice.url, pack: invoice.order.pack });
    } catch (_) {
      return json({ ok: false, error: 'token_invoice_failed' }, 502);
    }
  }

  const wallet = await readWalletSnapshot(env, telegramId);
  const topups = await readTopups(env, telegramId, 12);
  return json({
    ok: true,
    wallet,
    costs: { liveMinute: LIVE_MINUTE_COST, scriptEdit: SCRIPT_EDIT_COST, favoriteInsert: FAVORITE_INSERT_COST },
    packs: publicPacks(),
    topups: topups.map((row) => ({
      tokens: Number(row.delta || 0),
      kind: row.kind,
      stars: Number(row.stars || 0),
      createdAt: Number(row.created_at || 0)
    }))
  });
}

async function chargeFixed(env, ctx, telegramId, cost, feature, reference) {
  await ensureWallet(env, telegramId);
  const now = Math.floor(Date.now() / 1000);
  const update = await env.DB.prepare(`
    UPDATE ai_token_wallets
    SET balance = balance - ?, lifetime_spent = lifetime_spent + ?, updated_at = ?
    WHERE telegram_id = ? AND balance >= ?
  `).bind(cost, cost, now, telegramId, cost).run();
  if (changes(update) < 1) {
    queueBalanceAlert(ctx, env, telegramId);
    const wallet = await readWalletSnapshot(env, telegramId);
    return { ok: false, wallet };
  }
  await env.DB.prepare(`
    INSERT INTO ai_token_ledger (
      telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
    ) SELECT ?, ?, balance, 'spend', ?, ?, 0, ?
      FROM ai_token_wallets WHERE telegram_id = ?
  `).bind(telegramId, -cost, feature, reference, now, telegramId).run();
  const wallet = await readWalletSnapshot(env, telegramId);
  queueBalanceAlert(ctx, env, telegramId);
  return { ok: true, wallet, charged: cost, feature, reference };
}

async function refundFixed(env, telegramId, charge) {
  if (!charge?.charged) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE ai_token_wallets
      SET balance = balance + ?, lifetime_spent = MAX(0, lifetime_spent - ?),
          low_alert_sent = CASE WHEN balance + ? > ? THEN 0 ELSE low_alert_sent END,
          empty_alert_sent = CASE WHEN balance + ? > 0 THEN 0 ELSE empty_alert_sent END,
          updated_at = ?
      WHERE telegram_id = ?
    `).bind(charge.charged, charge.charged, charge.charged, LOW_BALANCE_THRESHOLD, charge.charged, now, telegramId),
    env.DB.prepare(`
      INSERT INTO ai_token_ledger (
        telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
      ) SELECT ?, ?, balance, 'refund', ?, ?, 0, ?
        FROM ai_token_wallets WHERE telegram_id = ?
    `).bind(telegramId, charge.charged, charge.feature, charge.reference, now, telegramId)
  ]);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chargeLiveMinute(env, ctx, telegramId) {
  await ensureWallet(env, telegramId);
  const now = Math.floor(Date.now() / 1000);
  const minuteBucket = Math.floor(now / 60);
  const feature = 'live';
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO ai_token_live_minutes (
      telegram_id, minute_bucket, feature, status, cost, created_at
    ) VALUES (?, ?, ?, 'pending', ?, ?)
  `).bind(telegramId, minuteBucket, feature, LIVE_MINUTE_COST, now).run();

  if (changes(insert) < 1) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existing = await env.DB.prepare(`
        SELECT status FROM ai_token_live_minutes
        WHERE telegram_id = ? AND minute_bucket = ? AND feature = ? LIMIT 1
      `).bind(telegramId, minuteBucket, feature).first();
      if (existing?.status === 'charged') {
        return { ok: true, wallet: await readWalletSnapshot(env, telegramId), charged: 0, existingMinute: true };
      }
      if (existing?.status === 'failed') {
        await env.DB.prepare(`
          DELETE FROM ai_token_live_minutes
          WHERE telegram_id = ? AND minute_bucket = ? AND feature = ? AND status = 'failed'
        `).bind(telegramId, minuteBucket, feature).run();
        return chargeLiveMinute(env, ctx, telegramId);
      }
      await wait(25 + attempt * 25);
    }
    return { ok: false, wallet: await readWalletSnapshot(env, telegramId) };
  }

  const charge = await chargeFixed(env, ctx, telegramId, LIVE_MINUTE_COST, 'live_minute', `live:${minuteBucket}`);
  if (!charge.ok) {
    await env.DB.prepare(`
      UPDATE ai_token_live_minutes SET status = 'failed'
      WHERE telegram_id = ? AND minute_bucket = ? AND feature = ?
    `).bind(telegramId, minuteBucket, feature).run();
    return charge;
  }
  await env.DB.prepare(`
    UPDATE ai_token_live_minutes SET status = 'charged'
    WHERE telegram_id = ? AND minute_bucket = ? AND feature = ?
  `).bind(telegramId, minuteBucket, feature).run();
  return { ...charge, liveMinute: { minuteBucket, feature } };
}

async function refundMeteredCharge(env, telegramId, charge) {
  if (!charge?.charged) return;
  await refundFixed(env, telegramId, charge);
  if (charge.liveMinute) {
    await env.DB.prepare(`
      DELETE FROM ai_token_live_minutes
      WHERE telegram_id = ? AND minute_bucket = ? AND feature = ?
    `).bind(telegramId, charge.liveMinute.minuteBucket, charge.liveMinute.feature).run();
  }
}

function tokenRequired(wallet) {
  return json({
    ok: false,
    error: 'ai_tokens_required',
    wallet: wallet || { balance: 0, low: true, empty: true },
    packs: publicPacks()
  }, 402);
}

export async function meterAiRequest(request, env, ctx) {
  if (request.method !== 'POST') return app.fetch(request, env, ctx);
  const url = new URL(request.url);
  let costType = '';
  if (url.pathname === '/api/ai/live') costType = 'live';
  else if (url.pathname === '/api/ai/script') costType = 'script';
  else if (url.pathname === '/api/ai/favorite-insert') costType = 'favorite';
  else return app.fetch(request, env, ctx);

  let body;
  try { body = await request.clone().json(); }
  catch (_) { return app.fetch(request, env, ctx); }
  const auth = await authenticate(request, env, ctx, body?.initData || '');
  if (!auth.ok) return auth.response;
  if (!await ensureSchema(env)) return json({ ok: false, error: 'ai_wallet_database_unavailable' }, 503);
  const telegramId = String(auth.user.id);
  const reference = crypto.randomUUID();
  let charge;
  if (costType === 'live') charge = await chargeLiveMinute(env, ctx, telegramId);
  else if (costType === 'script') charge = await chargeFixed(env, ctx, telegramId, SCRIPT_EDIT_COST, 'script_edit', reference);
  else charge = await chargeFixed(env, ctx, telegramId, FAVORITE_INSERT_COST, 'favorite_insert', reference);
  if (!charge.ok) return tokenRequired(charge.wallet);

  const response = await app.fetch(request, env, ctx);
  if (!response.ok && charge.charged) {
    await refundMeteredCharge(env, telegramId, charge);
  }
  const current = await readWalletSnapshot(env, telegramId);
  const headers = new Headers(response.headers);
  if (current) headers.set('X-PromptCam-AI-Tokens', String(current.balance));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function ensureWalletWebhook(request, env, ctx) {
  if (webhookReady) return true;
  if (webhookPromise) return webhookPromise;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !WEBHOOK_SECRET_PATTERN.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    return false;
  }
  webhookPromise = (async () => {
    try {
      const url = new URL(request.url);
      await telegramApi(env, 'setWebhook', {
        url: `${url.origin}/api/telegram/webhook`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'pre_checkout_query', 'callback_query']
      });
      webhookReady = true;
      return true;
    } catch (_) {
      return false;
    } finally {
      webhookPromise = null;
    }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(webhookPromise);
  return webhookPromise;
}

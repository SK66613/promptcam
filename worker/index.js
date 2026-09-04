const encoder = new TextEncoder();
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 5 * 60;
const MONTH_SECONDS = 30 * 24 * 60 * 60;

const PLANS = Object.freeze({
  day: {
    id: 'day',
    title: '1 день',
    description: 'PromptCam Pro на 24 часа',
    stars: 1,
    durationSeconds: 24 * 60 * 60,
    recurring: false,
    badge: ''
  },
  week: {
    id: 'week',
    title: '7 дней',
    description: 'PromptCam Pro на 7 дней',
    stars: 75,
    durationSeconds: 7 * 24 * 60 * 60,
    recurring: false,
    badge: 'Популярно'
  },
  month: {
    id: 'month',
    title: '30 дней',
    description: 'PromptCam Pro с ежемесячным продлением',
    stars: 199,
    durationSeconds: MONTH_SECONDS,
    recurring: true,
    subscriptionPeriod: MONTH_SECONDS,
    badge: 'Автопродление'
  },
  year: {
    id: 'year',
    title: '1 год',
    description: 'PromptCam Pro на 365 дней',
    stars: 999,
    durationSeconds: 365 * 24 * 60 * 60,
    recurring: false,
    badge: 'Выгодно'
  }
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

async function hmacSha256(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifyTelegramHash(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const signature = hexToBytes(hash);
  if (!signature) return false;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const verificationKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    'HMAC',
    verificationKey,
    signature,
    encoder.encode(dataCheckString)
  );
}

function parseTelegramUser(params) {
  const rawUser = params.get('user');
  if (!rawUser) return null;
  try {
    const user = JSON.parse(rawUser);
    if (!user || typeof user !== 'object' || !Number.isFinite(Number(user.id))) return null;
    return {
      id: String(user.id),
      first_name: typeof user.first_name === 'string' ? user.first_name : '',
      last_name: typeof user.last_name === 'string' ? user.last_name : '',
      username: typeof user.username === 'string' ? user.username : '',
      language_code: typeof user.language_code === 'string' ? user.language_code : '',
      is_premium: Boolean(user.is_premium),
      photo_url: typeof user.photo_url === 'string' ? user.photo_url : ''
    };
  } catch (_) {
    return null;
  }
}

async function validateTelegramInitData(initData, botToken) {
  if (typeof initData !== 'string' || !initData || initData.length > 16384) {
    return { ok: false, reason: 'invalid_init_data' };
  }

  const params = new URLSearchParams(initData);
  const rawAuthDate = params.get('auth_date');
  if (!rawAuthDate) return { ok: false, reason: 'missing_auth_date' };

  const authDate = Number(rawAuthDate);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'missing_auth_date' };
  if (authDate > now + FUTURE_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'future_auth_date' };
  if (now - authDate > MAX_INIT_DATA_AGE_SECONDS) return { ok: false, reason: 'expired_init_data' };

  if (!(await verifyTelegramHash(initData, botToken))) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const user = parseTelegramUser(params);
  if (!user) return { ok: false, reason: 'missing_user' };

  return {
    ok: true,
    authDate,
    queryId: params.get('query_id') || '',
    user
  };
}

function publicPlans() {
  return Object.values(PLANS).map(({ durationSeconds, subscriptionPeriod, ...plan }) => plan);
}

function requireDatabase(env) {
  return env.DB && typeof env.DB.prepare === 'function';
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}

async function authenticateMiniApp(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, response: json({ ok: false, error: 'telegram_not_configured' }, 503) };
  const body = await parseJsonBody(request);
  if (!body) return { ok: false, response: json({ ok: false, error: 'invalid_json' }, 400) };
  const result = await validateTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
  if (!result.ok) return { ok: false, response: json({ ok: false, error: result.reason }, 401) };
  return { ok: true, body, session: result };
}

async function telegramSession(request, env) {
  const auth = await authenticateMiniApp(request, env);
  if (!auth.ok) return auth.response;
  return json({
    ok: true,
    authDate: auth.session.authDate,
    queryId: auth.session.queryId,
    user: auth.session.user
  });
}

async function upsertUser(db, user) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name, language_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      language_code = excluded.language_code,
      updated_at = excluded.updated_at
  `).bind(
    user.id,
    user.username,
    user.first_name,
    user.last_name,
    user.language_code,
    now,
    now
  ).run();
}

async function readAccess(db, telegramId) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(`
    SELECT plan, access_until, recurring, telegram_payment_charge_id
    FROM entitlements
    WHERE telegram_id = ?
    LIMIT 1
  `).bind(telegramId).first();

  const expiresAt = Number(row?.access_until || 0);
  return {
    pro: expiresAt > now,
    plan: expiresAt > now ? (row?.plan || '') : '',
    expiresAt: expiresAt > now ? expiresAt : 0,
    recurring: expiresAt > now ? Boolean(row?.recurring) : false
  };
}

async function billingMe(request, env) {
  const auth = await authenticateMiniApp(request, env);
  if (!auth.ok) return auth.response;

  if (!requireDatabase(env)) {
    return json({
      ok: true,
      billingConfigured: false,
      access: { pro: false, plan: '', expiresAt: 0, recurring: false },
      plans: publicPlans()
    });
  }

  try {
    await upsertUser(env.DB, auth.session.user);
    const access = await readAccess(env.DB, auth.session.user.id);
    return json({ ok: true, billingConfigured: true, access, plans: publicPlans() });
  } catch (_) {
    return json({
      ok: false,
      error: 'billing_database_not_initialized',
      billingConfigured: false,
      plans: publicPlans()
    }, 503);
  }
}

async function telegramApi(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(`telegram_api_${method}_failed`);
  return data.result;
}

async function createBillingInvoice(request, env) {
  const auth = await authenticateMiniApp(request, env);
  if (!auth.ok) return auth.response;
  if (!requireDatabase(env)) return json({ ok: false, error: 'billing_not_configured' }, 503);

  const plan = PLANS[auth.body.plan];
  if (!plan) return json({ ok: false, error: 'unknown_plan' }, 400);

  try {
    await upsertUser(env.DB, auth.session.user);
  } catch (_) {
    return json({ ok: false, error: 'billing_database_not_initialized' }, 503);
  }

  const orderId = crypto.randomUUID();
  const invoicePayload = `pc:${orderId}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(`
      INSERT INTO billing_orders (id, telegram_id, plan, stars, currency, invoice_payload, status, created_at)
      VALUES (?, ?, ?, ?, 'XTR', ?, 'pending', ?)
    `).bind(orderId, auth.session.user.id, plan.id, plan.stars, invoicePayload, now).run();

    const invoiceRequest = {
      title: `PromptCam Pro · ${plan.title}`,
      description: plan.description,
      payload: invoicePayload,
      currency: 'XTR',
      prices: [{ label: `PromptCam Pro · ${plan.title}`, amount: plan.stars }]
    };
    if (plan.recurring) invoiceRequest.subscription_period = plan.subscriptionPeriod;

    const invoiceUrl = await telegramApi(env, 'createInvoiceLink', invoiceRequest);
    await env.DB.prepare(`UPDATE billing_orders SET invoice_url = ? WHERE id = ?`).bind(invoiceUrl, orderId).run();

    return json({
      ok: true,
      orderId,
      invoiceUrl,
      plan: { id: plan.id, title: plan.title, stars: plan.stars, recurring: plan.recurring }
    });
  } catch (_) {
    try {
      await env.DB.prepare(`UPDATE billing_orders SET status = 'invoice_failed' WHERE id = ?`).bind(orderId).run();
    } catch (_) {
      // The database may not be initialized yet.
    }
    return json({ ok: false, error: 'invoice_creation_failed' }, 502);
  }
}

async function answerPreCheckout(env, query, ok, errorMessage) {
  const payload = { pre_checkout_query_id: query.id, ok: Boolean(ok) };
  if (!ok && errorMessage) payload.error_message = errorMessage;
  await telegramApi(env, 'answerPreCheckoutQuery', payload);
}

async function handlePreCheckout(env, query) {
  if (!requireDatabase(env)) {
    await answerPreCheckout(env, query, false, 'PromptCam billing is temporarily unavailable.');
    return;
  }

  try {
    const order = await env.DB.prepare(`
      SELECT id, telegram_id, plan, stars, currency, status
      FROM billing_orders
      WHERE invoice_payload = ?
      LIMIT 1
    `).bind(query.invoice_payload || '').first();

    const plan = order ? PLANS[order.plan] : null;
    const valid = Boolean(
      order &&
      plan &&
      String(query.from?.id || '') === String(order.telegram_id) &&
      query.currency === 'XTR' &&
      Number(query.total_amount) === Number(order.stars) &&
      Number(query.total_amount) === plan.stars &&
      order.status !== 'invoice_failed'
    );

    await answerPreCheckout(
      env,
      query,
      valid,
      valid ? '' : 'Не удалось проверить заказ PromptCam. Создай новый счёт и попробуй ещё раз.'
    );
  } catch (_) {
    await answerPreCheckout(env, query, false, 'PromptCam billing is temporarily unavailable.');
  }
}

async function handleSuccessfulPayment(env, message) {
  const payment = message?.successful_payment;
  const telegramId = String(message?.from?.id || '');
  if (!payment || !telegramId || payment.currency !== 'XTR' || !requireDatabase(env)) return;

  const order = await env.DB.prepare(`
    SELECT id, telegram_id, plan, stars, invoice_payload
    FROM billing_orders
    WHERE invoice_payload = ?
    LIMIT 1
  `).bind(payment.invoice_payload || '').first();
  if (!order || String(order.telegram_id) !== telegramId) return;

  const plan = PLANS[order.plan];
  if (!plan || Number(payment.total_amount) !== Number(order.stars) || Number(payment.total_amount) !== plan.stars) return;

  const chargeId = String(payment.telegram_payment_charge_id || '');
  if (!chargeId) return;

  const paidAt = Number(message.date || Math.floor(Date.now() / 1000));
  const subscriptionExpiration = Number(payment.subscription_expiration_date || 0);
  const grantUntil = subscriptionExpiration > paidAt
    ? subscriptionExpiration
    : paidAt + plan.durationSeconds;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO payments (
        telegram_payment_charge_id, telegram_id, order_id, plan, stars, currency,
        invoice_payload, is_recurring, is_first_recurring, subscription_expiration_date, created_at
      ) VALUES (?, ?, ?, ?, ?, 'XTR', ?, ?, ?, ?, ?)
    `).bind(
      chargeId,
      telegramId,
      order.id,
      plan.id,
      plan.stars,
      payment.invoice_payload,
      payment.is_recurring ? 1 : 0,
      payment.is_first_recurring ? 1 : 0,
      subscriptionExpiration || null,
      paidAt
    ),
    env.DB.prepare(`
      INSERT INTO entitlements (
        telegram_id, plan, access_until, source, telegram_payment_charge_id, recurring, updated_at
      ) VALUES (?, ?, ?, 'telegram_stars', ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        plan = CASE WHEN excluded.access_until >= entitlements.access_until THEN excluded.plan ELSE entitlements.plan END,
        access_until = MAX(entitlements.access_until, excluded.access_until),
        source = 'telegram_stars',
        telegram_payment_charge_id = CASE WHEN excluded.access_until >= entitlements.access_until THEN excluded.telegram_payment_charge_id ELSE entitlements.telegram_payment_charge_id END,
        recurring = CASE WHEN excluded.access_until >= entitlements.access_until THEN excluded.recurring ELSE entitlements.recurring END,
        updated_at = excluded.updated_at
    `).bind(
      telegramId,
      plan.id,
      grantUntil,
      chargeId,
      plan.recurring ? 1 : 0,
      paidAt
    ),
    env.DB.prepare(`
      UPDATE billing_orders
      SET status = 'paid', paid_at = ?, telegram_payment_charge_id = ?, subscription_expiration_date = ?
      WHERE id = ?
    `).bind(paidAt, chargeId, subscriptionExpiration || null, order.id)
  ]);
}

async function telegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: 'webhook_not_configured' }, 503);
  }

  const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (providedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: 'invalid_webhook_secret' }, 401);
  }

  const update = await parseJsonBody(request);
  if (!update) return json({ ok: false, error: 'invalid_json' }, 400);

  try {
    if (update.pre_checkout_query) {
      await handlePreCheckout(env, update.pre_checkout_query);
      return json({ ok: true });
    }

    if (update.message?.successful_payment) {
      await handleSuccessfulPayment(env, update.message);
      return json({ ok: true });
    }

    return json({ ok: true, ignored: true });
  } catch (_) {
    return json({ ok: false, error: 'webhook_processing_failed' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'promptcam',
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
        billingDatabaseConfigured: requireDatabase(env),
        telegramWebhookConfigured: Boolean(env.TELEGRAM_WEBHOOK_SECRET)
      });
    }

    if (url.pathname === '/api/telegram/session') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return telegramSession(request, env);
    }

    if (url.pathname === '/api/me') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return billingMe(request, env);
    }

    if (url.pathname === '/api/billing/invoice') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return createBillingInvoice(request, env);
    }

    if (url.pathname === '/api/telegram/webhook') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return telegramWebhook(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

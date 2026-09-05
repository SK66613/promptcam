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

function hasDb(env) {
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
    const error = new Error(`telegram_${method}_failed`);
    error.description = String(data?.description || '');
    throw error;
  }
  return data.result;
}

export async function ensureSubscriptionSchema(env) {
  if (!hasDb(env)) return false;
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS subscription_controls (
          telegram_id TEXT PRIMARY KEY,
          telegram_payment_charge_id TEXT NOT NULL,
          is_canceled INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_subscription_controls_charge
        ON subscription_controls (telegram_payment_charge_id)
      `)
    ]);
    return true;
  } catch (_) {
    return false;
  }
}

async function firstRecurringCharge(env, telegramId) {
  try {
    const row = await env.DB.prepare(`
      SELECT telegram_payment_charge_id
      FROM payments
      WHERE telegram_id = ? AND plan = 'month' AND is_first_recurring = 1
      ORDER BY created_at ASC
      LIMIT 1
    `).bind(String(telegramId)).first();
    return String(row?.telegram_payment_charge_id || '');
  } catch (_) {
    return '';
  }
}

async function currentEntitlement(env, telegramId) {
  if (!hasDb(env)) return null;
  try {
    return await env.DB.prepare(`
      SELECT plan, access_until, recurring, telegram_payment_charge_id
      FROM entitlements
      WHERE telegram_id = ?
      LIMIT 1
    `).bind(String(telegramId)).first();
  } catch (_) {
    return null;
  }
}

export async function getSubscriptionStatus(env, telegramId) {
  if (!telegramId || !await ensureSubscriptionSchema(env)) {
    return { active: false, recurring: false, canceled: false, canManage: false, expiresAt: 0 };
  }
  const entitlement = await currentEntitlement(env, telegramId);
  const now = Math.floor(Date.now() / 1000);
  const active = Number(entitlement?.access_until || 0) > now;
  const recurring = active && Boolean(Number(entitlement?.recurring || 0)) && String(entitlement?.plan || '') === 'month';
  if (!recurring) {
    return { active, recurring: false, canceled: false, canManage: false, expiresAt: active ? Number(entitlement?.access_until || 0) : 0 };
  }

  let control = null;
  try {
    control = await env.DB.prepare(`
      SELECT telegram_payment_charge_id, is_canceled
      FROM subscription_controls
      WHERE telegram_id = ?
      LIMIT 1
    `).bind(String(telegramId)).first();
  } catch (_) { /* runtime schema already attempted */ }

  const chargeId = String(control?.telegram_payment_charge_id || '') ||
    await firstRecurringCharge(env, telegramId) ||
    String(entitlement?.telegram_payment_charge_id || '');
  return {
    active: true,
    recurring: true,
    canceled: Boolean(Number(control?.is_canceled || 0)),
    canManage: Boolean(chargeId),
    expiresAt: Number(entitlement?.access_until || 0),
    chargeId
  };
}

export async function recordRecurringPayment(env, telegramId, chargeId, isFirstRecurring) {
  if (!telegramId || !chargeId || !await ensureSubscriptionSchema(env)) return false;
  const now = Math.floor(Date.now() / 1000);
  try {
    if (isFirstRecurring) {
      await env.DB.prepare(`
        INSERT INTO subscription_controls (telegram_id, telegram_payment_charge_id, is_canceled, updated_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          telegram_payment_charge_id = excluded.telegram_payment_charge_id,
          is_canceled = 0,
          updated_at = excluded.updated_at
      `).bind(String(telegramId), String(chargeId), now).run();
    } else {
      await env.DB.prepare(`
        UPDATE subscription_controls
        SET is_canceled = 0, updated_at = ?
        WHERE telegram_id = ?
      `).bind(now, String(telegramId)).run();
    }
    return true;
  } catch (_) {
    return false;
  }
}

export async function editSubscriptionForUser(env, telegramId, cancel) {
  const status = await getSubscriptionStatus(env, telegramId);
  if (!status.recurring || !status.active) return { ok: false, error: 'no_active_recurring_subscription', status };
  if (!status.canManage || !status.chargeId) return { ok: false, error: 'subscription_charge_missing', status };
  if (Boolean(cancel) === status.canceled) return { ok: true, status };

  try {
    await telegramApi(env, 'editUserStarSubscription', {
      user_id: Number(telegramId),
      telegram_payment_charge_id: status.chargeId,
      is_canceled: Boolean(cancel)
    });
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`
      INSERT INTO subscription_controls (telegram_id, telegram_payment_charge_id, is_canceled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        telegram_payment_charge_id = excluded.telegram_payment_charge_id,
        is_canceled = excluded.is_canceled,
        updated_at = excluded.updated_at
    `).bind(String(telegramId), status.chargeId, cancel ? 1 : 0, now).run();
    return { ok: true, status: await getSubscriptionStatus(env, telegramId) };
  } catch (error) {
    return { ok: false, error: 'subscription_edit_failed', detail: String(error?.description || '').slice(0, 180), status };
  }
}

async function authenticate(app, request, env, ctx, initData) {
  if (typeof initData !== 'string' || !initData || initData.length > 20_000) return null;
  const url = new URL('/api/telegram/session', request.url);
  const response = await app.fetch(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData })
  }), env, ctx);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.ok && payload?.user?.id ? payload.user : null;
}

export async function handleSubscriptionApi(request, env, ctx, app) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'invalid_json' }, 400); }
  const user = await authenticate(app, request, env, ctx, body?.initData || '');
  if (!user) return json({ ok: false, error: 'invalid_telegram_session' }, 401);

  const action = String(body?.action || 'status');
  if (action === 'status') {
    const status = await getSubscriptionStatus(env, user.id);
    delete status.chargeId;
    return json({ ok: true, subscription: status });
  }
  if (action !== 'cancel' && action !== 'resume') return json({ ok: false, error: 'invalid_action' }, 400);
  const result = await editSubscriptionForUser(env, user.id, action === 'cancel');
  const safeStatus = { ...(result.status || {}) };
  delete safeStatus.chargeId;
  if (!result.ok) return json({ ok: false, error: result.error, subscription: safeStatus }, 409);
  return json({ ok: true, subscription: safeStatus });
}

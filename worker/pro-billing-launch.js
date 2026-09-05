export const LAUNCH_PLANS = Object.freeze({
  day: { id: 'day', title: '1 день', stars: 25, durationSeconds: 24 * 60 * 60, recurring: false, description: 'PromptCam Pro на 24 часа' },
  week: { id: 'week', title: '7 дней', stars: 75, durationSeconds: 7 * 24 * 60 * 60, recurring: false, description: 'PromptCam Pro на 7 дней' },
  month: { id: 'month', title: '30 дней', stars: 199, durationSeconds: 30 * 24 * 60 * 60, recurring: true, subscriptionPeriod: 30 * 24 * 60 * 60, description: 'PromptCam Pro с ежемесячным продлением' },
  year: { id: 'year', title: '1 год', stars: 999, durationSeconds: 365 * 24 * 60 * 60, recurring: false, description: 'PromptCam Pro на 365 дней' }
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
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

async function ensureUser(env, user) {
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
    String(user.id),
    String(user.username || ''),
    String(user.first_name || ''),
    String(user.last_name || ''),
    String(user.language_code || ''),
    now,
    now
  ).run();
}

function invoiceBody(order, plan) {
  const payload = {
    title: `PromptCam Pro · ${plan.title}`,
    description: plan.description,
    payload: order.invoicePayload,
    currency: 'XTR',
    prices: [{ label: `PromptCam Pro · ${plan.title}`, amount: plan.stars }]
  };
  if (plan.recurring) payload.subscription_period = plan.subscriptionPeriod;
  return payload;
}

async function createOrder(env, telegramId, plan) {
  const id = crypto.randomUUID();
  const invoicePayload = `pc:${id}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO billing_orders (id, telegram_id, plan, stars, currency, invoice_payload, status, created_at)
    VALUES (?, ?, ?, ?, 'XTR', ?, 'pending', ?)
  `).bind(id, String(telegramId), plan.id, plan.stars, invoicePayload, now).run();
  return { id, invoicePayload };
}

export async function handleLaunchBillingInvoice(request, env, user, body) {
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'billing_not_configured' }, 503);
  const plan = LAUNCH_PLANS[body?.plan];
  if (!plan) return json({ ok: false, error: 'unknown_plan' }, 400);
  try {
    await ensureUser(env, user);
    const order = await createOrder(env, user.id, plan);
    const invoiceUrl = await telegramApi(env, 'createInvoiceLink', invoiceBody(order, plan));
    await env.DB.prepare(`UPDATE billing_orders SET invoice_url = ? WHERE id = ?`).bind(invoiceUrl, order.id).run();
    return json({ ok: true, orderId: order.id, invoiceUrl, plan: { id: plan.id, title: plan.title, stars: plan.stars, recurring: plan.recurring } });
  } catch (_) {
    return json({ ok: false, error: 'invoice_creation_failed' }, 502);
  }
}

export async function sendLaunchProInvoice(env, telegramId, planId) {
  const plan = LAUNCH_PLANS[planId];
  if (!plan || !env.DB) throw new Error('unknown_plan');
  const user = await env.DB.prepare(`SELECT telegram_id FROM users WHERE telegram_id = ? LIMIT 1`).bind(String(telegramId)).first();
  if (!user) throw new Error('billing_user_missing');
  const order = await createOrder(env, telegramId, plan);
  await telegramApi(env, 'sendInvoice', { chat_id: String(telegramId), ...invoiceBody(order, plan) });
  await env.DB.prepare(`UPDATE billing_orders SET status = 'invoice_sent' WHERE id = ?`).bind(order.id).run();
  return order;
}

async function answerPreCheckout(env, query, ok, message = '') {
  const payload = { pre_checkout_query_id: query.id, ok: Boolean(ok) };
  if (!ok && message) payload.error_message = message;
  await telegramApi(env, 'answerPreCheckoutQuery', payload);
}

async function handlePreCheckout(env, query) {
  if (!env.DB) {
    await answerPreCheckout(env, query, false, 'PromptCam billing временно недоступен.');
    return;
  }
  try {
    const order = await env.DB.prepare(`
      SELECT id, telegram_id, plan, stars, currency, status
      FROM billing_orders WHERE invoice_payload = ? LIMIT 1
    `).bind(String(query.invoice_payload || '')).first();
    const valid = Boolean(
      order && LAUNCH_PLANS[order.plan] &&
      String(order.telegram_id) === String(query.from?.id || '') &&
      query.currency === 'XTR' &&
      Number(query.total_amount) === Number(order.stars) &&
      !['invoice_failed', 'refunded'].includes(String(order.status || ''))
    );
    await answerPreCheckout(env, query, valid, valid ? '' : 'Не удалось проверить заказ PromptCam. Создай новый счёт.');
  } catch (_) {
    await answerPreCheckout(env, query, false, 'PromptCam billing временно недоступен.');
  }
}

async function handleSuccessfulPayment(env, message) {
  const payment = message?.successful_payment;
  const telegramId = String(message?.from?.id || '');
  if (!payment || !telegramId || payment.currency !== 'XTR' || !env.DB) return;
  const order = await env.DB.prepare(`
    SELECT id, telegram_id, plan, stars, invoice_payload
    FROM billing_orders WHERE invoice_payload = ? LIMIT 1
  `).bind(String(payment.invoice_payload || '')).first();
  if (!order || String(order.telegram_id) !== telegramId || !LAUNCH_PLANS[order.plan]) return;
  if (Number(payment.total_amount) !== Number(order.stars)) return;
  const chargeId = String(payment.telegram_payment_charge_id || '');
  if (!chargeId) return;

  const plan = LAUNCH_PLANS[order.plan];
  const paidAt = Number(message.date || Math.floor(Date.now() / 1000));
  const subscriptionExpiration = Number(payment.subscription_expiration_date || 0);
  const grantUntil = subscriptionExpiration > paidAt ? subscriptionExpiration : paidAt + plan.durationSeconds;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO payments (
        telegram_payment_charge_id, telegram_id, order_id, plan, stars, currency,
        invoice_payload, is_recurring, is_first_recurring, subscription_expiration_date, created_at
      ) VALUES (?, ?, ?, ?, ?, 'XTR', ?, ?, ?, ?, ?)
    `).bind(
      chargeId, telegramId, order.id, plan.id, Number(order.stars), payment.invoice_payload,
      payment.is_recurring ? 1 : 0, payment.is_first_recurring ? 1 : 0,
      subscriptionExpiration || null, paidAt
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
    `).bind(telegramId, plan.id, grantUntil, chargeId, payment.is_recurring ? 1 : 0, paidAt),
    env.DB.prepare(`
      UPDATE billing_orders
      SET status = 'paid', paid_at = ?, telegram_payment_charge_id = ?, subscription_expiration_date = ?
      WHERE id = ?
    `).bind(paidAt, chargeId, subscriptionExpiration || null, order.id)
  ]);
}

export async function maybeHandleLaunchBillingWebhook(request, env) {
  if (request.method !== 'POST' || !env.TELEGRAM_WEBHOOK_SECRET) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }

  const checkout = update?.pre_checkout_query;
  if (checkout && String(checkout.invoice_payload || '').startsWith('pc:')) {
    await handlePreCheckout(env, checkout);
    return json({ ok: true });
  }

  const payment = update?.message?.successful_payment;
  if (payment && String(payment.invoice_payload || '').startsWith('pc:')) {
    try {
      await handleSuccessfulPayment(env, update.message);
      return json({ ok: true });
    } catch (_) {
      return json({ ok: false, error: 'billing_payment_processing_failed' }, 500);
    }
  }
  return null;
}

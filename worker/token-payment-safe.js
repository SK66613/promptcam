const TOKEN_PAYLOAD_PREFIX = 'pct:';

const PACKS = Object.freeze({
  start: { id: 'start', tokens: 60, stars: 25 },
  creator: { id: 'creator', tokens: 250, stars: 79 },
  studio: { id: 'studio', tokens: 800, stars: 199 }
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

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export async function maybeHandleSafeTokenPayment(request, env) {
  if (request.method !== 'POST' || !env.DB || !env.TELEGRAM_WEBHOOK_SECRET) return null;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return null;

  let update;
  try { update = await request.clone().json(); }
  catch (_) { return null; }

  const message = update?.message;
  const payment = message?.successful_payment;
  const invoicePayload = String(payment?.invoice_payload || '');
  if (!payment || !invoicePayload.startsWith(TOKEN_PAYLOAD_PREFIX)) return null;

  const telegramId = String(message?.from?.id || '');
  if (!telegramId || payment.currency !== 'XTR') return json({ ok: true, ignored: true });

  try {
    const order = await env.DB.prepare(`
      SELECT id, telegram_id, pack, tokens, stars, status, telegram_payment_charge_id
      FROM ai_token_orders
      WHERE invoice_payload = ?
      LIMIT 1
    `).bind(invoicePayload).first();

    if (!order || String(order.telegram_id) !== telegramId) return json({ ok: true, ignored: true });
    const pack = PACKS[order.pack];
    if (!pack || Number(order.tokens) !== pack.tokens || Number(order.stars) !== pack.stars) {
      return json({ ok: true, ignored: true });
    }
    if (Number(payment.total_amount) !== pack.stars) return json({ ok: true, ignored: true });

    const chargeId = String(payment.telegram_payment_charge_id || '');
    if (!chargeId) return json({ ok: true, ignored: true });
    if (order.status === 'credited') return json({ ok: true, duplicate: true });
    if (order.telegram_payment_charge_id && String(order.telegram_payment_charge_id) !== chargeId) {
      return json({ ok: false, error: 'token_charge_mismatch' }, 409);
    }

    const paidAt = Number(message.date || Math.floor(Date.now() / 1000));
    const claim = `crediting:${crypto.randomUUID()}`;

    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE ai_token_orders
        SET status = ?, telegram_payment_charge_id = ?, paid_at = ?
        WHERE id = ?
          AND status IN ('pending', 'invoice_sent', 'paid_uncredited')
          AND (telegram_payment_charge_id IS NULL OR telegram_payment_charge_id = ?)
      `).bind(claim, chargeId, paidAt, order.id, chargeId),
      env.DB.prepare(`
        UPDATE ai_token_wallets
        SET balance = balance + ?,
            lifetime_purchased = lifetime_purchased + ?,
            low_alert_sent = 0,
            empty_alert_sent = 0,
            updated_at = ?
        WHERE telegram_id = ?
          AND EXISTS (
            SELECT 1 FROM ai_token_orders
            WHERE id = ? AND status = ?
          )
      `).bind(pack.tokens, pack.tokens, paidAt, telegramId, order.id, claim),
      env.DB.prepare(`
        INSERT INTO ai_token_ledger (
          telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
        )
        SELECT ?, ?, balance, 'purchase', '', ?, ?, ?
        FROM ai_token_wallets
        WHERE telegram_id = ?
          AND EXISTS (
            SELECT 1 FROM ai_token_orders
            WHERE id = ? AND status = ?
          )
      `).bind(telegramId, pack.tokens, order.id, pack.stars, paidAt, telegramId, order.id, claim),
      env.DB.prepare(`
        UPDATE ai_token_orders
        SET status = 'credited'
        WHERE id = ? AND status = ?
      `).bind(order.id, claim)
    ]);

    const claimed = changes(results?.[0]) > 0;
    return json({ ok: true, credited: claimed, duplicate: !claimed });
  } catch (_) {
    return json({ ok: false, error: 'token_payment_credit_failed' }, 500);
  }
}

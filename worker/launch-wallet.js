function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export async function ensureLaunchWallet(env, telegramId) {
  if (!env.DB || !telegramId) return false;
  const now = Math.floor(Date.now() / 1000);
  try {
    const insert = await env.DB.prepare(`
      INSERT OR IGNORE INTO ai_token_wallets (
        telegram_id, balance, lifetime_purchased, lifetime_spent,
        low_alert_sent, empty_alert_sent, created_at, updated_at
      ) VALUES (?, 20, 0, 0, 0, 0, ?, ?)
    `).bind(String(telegramId), now, now).run();
    if (changes(insert) > 0) {
      await env.DB.prepare(`
        INSERT INTO ai_token_ledger (
          telegram_id, delta, balance_after, kind, feature, reference, stars, created_at
        ) VALUES (?, 20, 20, 'starter', '', 'starter', 0, ?)
      `).bind(String(telegramId), now).run();
    }
    return true;
  } catch (_) {
    return false;
  }
}

export async function maybeEnsureWalletForWebhook(request, env) {
  if (request.method !== 'POST') return;
  let update;
  try { update = await request.clone().json(); }
  catch (_) { return; }
  const telegramId = String(update?.message?.from?.id || update?.callback_query?.from?.id || update?.pre_checkout_query?.from?.id || '');
  if (!telegramId) return;
  const command = String(update?.message?.text || '').trim().toLowerCase().split(/\s+/)[0].split('@')[0];
  const callback = String(update?.callback_query?.data || '');
  if (command === '/tokens' || callback === 'pch:view:tokens' || callback.startsWith('pch:token:')) {
    await ensureLaunchWallet(env, telegramId);
  }
}

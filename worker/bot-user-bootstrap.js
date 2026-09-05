export async function ensureBotUserFromWebhook(request, env) {
  if (request.method !== 'POST' || !env.DB || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== env.TELEGRAM_WEBHOOK_SECRET) return false;

  let update;
  try { update = await request.clone().json(); }
  catch (_) { return false; }

  const user = update?.message?.from || update?.callback_query?.from || update?.pre_checkout_query?.from;
  const telegramId = String(user?.id || '');
  if (!telegramId) return false;

  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(`
      INSERT INTO users (
        telegram_id, username, first_name, last_name, language_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        language_code = excluded.language_code,
        updated_at = excluded.updated_at
    `).bind(
      telegramId,
      typeof user?.username === 'string' ? user.username : '',
      typeof user?.first_name === 'string' ? user.first_name : '',
      typeof user?.last_name === 'string' ? user.last_name : '',
      typeof user?.language_code === 'string' ? user.language_code : '',
      now,
      now
    ).run();
    return true;
  } catch (_) {
    return false;
  }
}

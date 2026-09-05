const LIMIT_PER_MINUTE = 8;

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export async function consumePurchaseRate(env, telegramId) {
  if (!env.DB || !telegramId) return { ok: false, configured: false, retryAfter: 60 };
  const now = Math.floor(Date.now() / 1000);
  const minuteBucket = Math.floor(now / 60);
  const bucketId = `purchase:${telegramId}`;
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO ai_usage_minute (telegram_id, minute_bucket, requests, updated_at)
      VALUES (?, ?, 0, ?)
    `).bind(bucketId, minuteBucket, now).run();
    const result = await env.DB.prepare(`
      UPDATE ai_usage_minute
      SET requests = requests + 1, updated_at = ?
      WHERE telegram_id = ? AND minute_bucket = ? AND requests < ?
    `).bind(now, bucketId, minuteBucket, LIMIT_PER_MINUTE).run();
    if (changes(result) < 1) {
      return { ok: false, configured: true, retryAfter: Math.max(1, 60 - (now % 60)) };
    }
    return { ok: true, configured: true, retryAfter: 0 };
  } catch (_) {
    return { ok: false, configured: false, retryAfter: 60 };
  }
}

export function purchaseRateResponse(retryAfter = 60) {
  return new Response(JSON.stringify({ ok: false, error: 'purchase_rate_limited', retryAfter }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(Math.max(1, Number(retryAfter || 60))),
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

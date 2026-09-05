export const TERMS_VERSION = '2026-09-05-v1';
export const PRIVACY_VERSION = '2026-09-05-v1';

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

export async function ensureLegalSchema(env) {
  if (!hasDb(env)) return false;
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS legal_consents (
          telegram_id TEXT PRIMARY KEY,
          terms_version TEXT NOT NULL,
          privacy_version TEXT NOT NULL,
          accepted_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS support_sessions (
          telegram_id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          pending INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created
        ON support_tickets (status, created_at DESC)
      `)
    ]);
    return true;
  } catch (_) {
    return false;
  }
}

export async function hasCurrentConsent(env, telegramId) {
  if (!telegramId || !await ensureLegalSchema(env)) return false;
  try {
    const row = await env.DB.prepare(`
      SELECT terms_version, privacy_version
      FROM legal_consents
      WHERE telegram_id = ?
      LIMIT 1
    `).bind(String(telegramId)).first();
    return row?.terms_version === TERMS_VERSION && row?.privacy_version === PRIVACY_VERSION;
  } catch (_) {
    return false;
  }
}

export async function saveConsent(env, telegramId) {
  if (!telegramId || !await ensureLegalSchema(env)) return false;
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(`
      INSERT INTO legal_consents (telegram_id, terms_version, privacy_version, accepted_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        terms_version = excluded.terms_version,
        privacy_version = excluded.privacy_version,
        accepted_at = excluded.accepted_at,
        updated_at = excluded.updated_at
    `).bind(String(telegramId), TERMS_VERSION, PRIVACY_VERSION, now, now).run();
    return true;
  } catch (_) {
    return false;
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

export function legalRequiredResponse() {
  return json({
    ok: false,
    error: 'legal_consent_required',
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    termsUrl: '/terms.html',
    privacyUrl: '/privacy.html'
  }, 428);
}

export async function requireMiniAppConsent(request, env, ctx, app, body) {
  const user = await authenticate(app, request, env, ctx, body?.initData || '');
  if (!user) return { ok: false, response: json({ ok: false, error: 'invalid_telegram_session' }, 401) };
  const accepted = await hasCurrentConsent(env, user.id);
  if (!accepted) return { ok: false, response: legalRequiredResponse(), user };
  return { ok: true, user };
}

export async function handleLegalApi(request, env, ctx, app) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'invalid_json' }, 400); }

  const user = await authenticate(app, request, env, ctx, body?.initData || '');
  if (!user) return json({ ok: false, error: 'invalid_telegram_session' }, 401);
  if (!await ensureLegalSchema(env)) return json({ ok: false, error: 'legal_database_unavailable' }, 503);

  if (body?.action === 'accept') {
    if (body?.termsVersion !== TERMS_VERSION || body?.privacyVersion !== PRIVACY_VERSION) {
      return json({ ok: false, error: 'legal_version_mismatch', termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }, 409);
    }
    const saved = await saveConsent(env, user.id);
    if (!saved) return json({ ok: false, error: 'legal_consent_save_failed' }, 503);
  }

  const accepted = await hasCurrentConsent(env, user.id);
  return json({
    ok: true,
    accepted,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    termsUrl: '/terms.html',
    privacyUrl: '/privacy.html'
  });
}

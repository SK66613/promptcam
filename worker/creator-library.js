import app from './index.js';

const LIBRARY_MAX_REQUEST_BYTES = 30_000;
const TEMPLATE_LIMIT = 50;
const FAVORITE_LIMIT = 200;
const TEMPLATE_TITLE_MAX_CHARS = 80;
const TEMPLATE_CONTENT_MAX_CHARS = 12_000;
const FAVORITE_TEXT_MAX_CHARS = 240;
const FAVORITE_DETAIL_MAX_CHARS = 360;
const FAVORITE_SOURCE_MAX_CHARS = 24;
const FAVORITE_MODE_MAX_CHARS = 32;
const FAVORITE_KIND_MAX_CHARS = 80;
const ACTIONS = new Set([
  'list',
  'save_template',
  'delete_template',
  'save_favorite',
  'delete_favorite'
]);

let schemaReady = false;

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

function compactText(value, maxLength, preserveNewlines = false) {
  if (typeof value !== 'string') return '';
  const normalized = preserveNewlines
    ? value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()
    : value.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

function positiveId(value) {
  const number = Math.round(Number(value || 0));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function requestTooLarge(request) {
  const raw = request.headers.get('Content-Length');
  if (!raw) return false;
  const size = Number(raw);
  return Number.isFinite(size) && size > LIBRARY_MAX_REQUEST_BYTES;
}

async function ensureSchema(env) {
  if (schemaReady) return true;
  if (!env.DB || typeof env.DB.prepare !== 'function') return false;
  try {
    if (typeof env.DB.batch === 'function') {
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS script_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `),
        env.DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_script_templates_user_updated
          ON script_templates (telegram_id, updated_at DESC)
        `),
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ai_favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT NOT NULL,
            source TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `),
        env.DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_ai_favorites_user_updated
          ON ai_favorites (telegram_id, updated_at DESC)
        `)
      ]);
    } else {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS script_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `).run();
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS ai_favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id TEXT NOT NULL,
          source TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `).run();
    }
    schemaReady = true;
    return true;
  } catch (_) {
    return false;
  }
}

async function authenticate(request, env, ctx, initData) {
  const sessionUrl = new URL('/api/telegram/session', request.url);
  const response = await app.fetch(new Request(sessionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData })
  }), env, ctx);
  if (!response.ok) return { ok: false, response };
  const payload = await response.json().catch(() => null);
  if (!payload?.ok || !payload?.user?.id) {
    return { ok: false, response: json({ ok: false, error: 'invalid_telegram_session' }, 401) };
  }
  return { ok: true, user: payload.user };
}

async function listLibrary(env, telegramId) {
  const [templatesResult, favoritesResult] = await Promise.all([
    env.DB.prepare(`
      SELECT id, title, content, created_at, updated_at
      FROM script_templates
      WHERE telegram_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).bind(telegramId, TEMPLATE_LIMIT).all(),
    env.DB.prepare(`
      SELECT id, source, mode, kind, text, detail, created_at, updated_at
      FROM ai_favorites
      WHERE telegram_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).bind(telegramId, FAVORITE_LIMIT).all()
  ]);
  return {
    templates: Array.isArray(templatesResult?.results) ? templatesResult.results : [],
    favorites: Array.isArray(favoritesResult?.results) ? favoritesResult.results : []
  };
}

async function saveTemplate(env, telegramId, body) {
  const title = compactText(body.title, TEMPLATE_TITLE_MAX_CHARS);
  const content = compactText(body.content, TEMPLATE_CONTENT_MAX_CHARS, true);
  if (!title) return json({ ok: false, error: 'template_title_required' }, 400);
  if (!content) return json({ ok: false, error: 'template_content_required' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(`
    SELECT id, created_at FROM script_templates
    WHERE telegram_id = ? AND title = ?
    LIMIT 1
  `).bind(telegramId, title).first();

  let id = positiveId(existing?.id);
  if (id) {
    await env.DB.prepare(`
      UPDATE script_templates
      SET content = ?, updated_at = ?
      WHERE id = ? AND telegram_id = ?
    `).bind(content, now, id, telegramId).run();
  } else {
    const count = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM script_templates WHERE telegram_id = ?
    `).bind(telegramId).first();
    if (Number(count?.count || 0) >= TEMPLATE_LIMIT) {
      return json({ ok: false, error: 'template_limit_reached', limit: TEMPLATE_LIMIT }, 409);
    }
    const result = await env.DB.prepare(`
      INSERT INTO script_templates (telegram_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(telegramId, title, content, now, now).run();
    id = positiveId(result?.meta?.last_row_id ?? result?.lastRowId);
  }

  return json({
    ok: true,
    template: {
      id,
      title,
      content,
      created_at: Number(existing?.created_at || now),
      updated_at: now
    }
  });
}

async function deleteTemplate(env, telegramId, body) {
  const id = positiveId(body.id);
  if (!id) return json({ ok: false, error: 'invalid_template_id' }, 400);
  await env.DB.prepare(`DELETE FROM script_templates WHERE id = ? AND telegram_id = ?`)
    .bind(id, telegramId).run();
  return json({ ok: true, id });
}

function normalizeFavorite(body) {
  return {
    source: compactText(body.source, FAVORITE_SOURCE_MAX_CHARS) || 'live',
    mode: compactText(body.mode, FAVORITE_MODE_MAX_CHARS),
    kind: compactText(body.kind, FAVORITE_KIND_MAX_CHARS),
    text: compactText(body.text, FAVORITE_TEXT_MAX_CHARS),
    detail: compactText(body.detail, FAVORITE_DETAIL_MAX_CHARS, true)
  };
}

async function saveFavorite(env, telegramId, body) {
  const favorite = normalizeFavorite(body);
  if (!favorite.text) return json({ ok: false, error: 'favorite_text_required' }, 400);

  const existing = await env.DB.prepare(`
    SELECT id, created_at, updated_at
    FROM ai_favorites
    WHERE telegram_id = ? AND source = ? AND mode = ? AND kind = ? AND text = ? AND detail = ?
    LIMIT 1
  `).bind(
    telegramId,
    favorite.source,
    favorite.mode,
    favorite.kind,
    favorite.text,
    favorite.detail
  ).first();

  const now = Math.floor(Date.now() / 1000);
  let id = positiveId(existing?.id);
  if (id) {
    await env.DB.prepare(`UPDATE ai_favorites SET updated_at = ? WHERE id = ? AND telegram_id = ?`)
      .bind(now, id, telegramId).run();
  } else {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ai_favorites WHERE telegram_id = ?`)
      .bind(telegramId).first();
    if (Number(count?.count || 0) >= FAVORITE_LIMIT) {
      return json({ ok: false, error: 'favorite_limit_reached', limit: FAVORITE_LIMIT }, 409);
    }
    const result = await env.DB.prepare(`
      INSERT INTO ai_favorites (
        telegram_id, source, mode, kind, text, detail, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      telegramId,
      favorite.source,
      favorite.mode,
      favorite.kind,
      favorite.text,
      favorite.detail,
      now,
      now
    ).run();
    id = positiveId(result?.meta?.last_row_id ?? result?.lastRowId);
  }

  return json({
    ok: true,
    favorite: {
      id,
      ...favorite,
      created_at: Number(existing?.created_at || now),
      updated_at: now
    }
  });
}

async function deleteFavorite(env, telegramId, body) {
  const id = positiveId(body.id);
  if (!id) return json({ ok: false, error: 'invalid_favorite_id' }, 400);
  await env.DB.prepare(`DELETE FROM ai_favorites WHERE id = ? AND telegram_id = ?`)
    .bind(id, telegramId).run();
  return json({ ok: true, id });
}

export async function handleCreatorLibrary(request, env, ctx) {
  if (requestTooLarge(request)) return json({ ok: false, error: 'library_request_too_large' }, 413);
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || !ACTIONS.has(body.action)) {
    return json({ ok: false, error: 'invalid_library_action' }, 400);
  }
  if (typeof body.initData !== 'string' || !body.initData || body.initData.length > 20_000) {
    return json({ ok: false, error: 'invalid_init_data' }, 400);
  }

  const auth = await authenticate(request, env, ctx, body.initData);
  if (!auth.ok) return auth.response;
  if (!await ensureSchema(env)) return json({ ok: false, error: 'library_database_unavailable' }, 503);

  const telegramId = String(auth.user.id);
  try {
    if (body.action === 'list') {
      return json({ ok: true, ...(await listLibrary(env, telegramId)) });
    }
    if (body.action === 'save_template') return saveTemplate(env, telegramId, body);
    if (body.action === 'delete_template') return deleteTemplate(env, telegramId, body);
    if (body.action === 'save_favorite') return saveFavorite(env, telegramId, body);
    if (body.action === 'delete_favorite') return deleteFavorite(env, telegramId, body);
  } catch (_) {
    return json({ ok: false, error: 'library_database_failed' }, 503);
  }
  return json({ ok: false, error: 'invalid_library_action' }, 400);
}

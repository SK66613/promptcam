import app from './index.js';

const TELEGRAM_ALLOWED_UPDATES = ['message', 'pre_checkout_query'];
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const AI_ALLOWED_MODES = new Set(['jokes', 'director', 'ideas', 'hooks']);
const AI_ALLOWED_RHYTHMS = new Set(['smart', 'active']);
const AI_ALLOWED_TRIGGERS = new Set(['scene', 'heartbeat', 'manual']);
const AI_FRAME_PATTERN = /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const AI_MAX_REQUEST_BYTES = 800_000;
const AI_MAX_FRAME_CHARS = 650_000;
const AI_RATE_LIMIT_PER_MINUTE = 30;
const AI_DEFAULT_MODEL = 'gpt-5.6-luna';

const AI_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['suggest', 'none'] },
    type: { type: 'string', enum: ['joke', 'director', 'idea', 'hook', 'none'] },
    text: { type: 'string', maxLength: 120 },
    scene: { type: 'string', maxLength: 140 }
  },
  required: ['action', 'type', 'text', 'scene']
};

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

async function telegramApi(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = typeof data?.description === 'string' ? data.description : '';
    const error = new Error(`telegram_api_${method}_failed`);
    error.description = description;
    throw error;
  }
  return data.result;
}

function desiredWebhookUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/api/telegram/webhook`;
}

async function ensureTelegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: 'telegram_not_configured' };
  if (!env.TELEGRAM_WEBHOOK_SECRET) return { ok: false, error: 'telegram_webhook_not_configured' };
  if (!WEBHOOK_SECRET_PATTERN.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    return { ok: false, error: 'telegram_webhook_secret_invalid' };
  }

  const url = desiredWebhookUrl(request);
  try {
    await telegramApi(env, 'setWebhook', {
      url,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES
    });
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: 'telegram_webhook_setup_failed', reason: error?.description || '' };
  }
}

function requestTooLarge(request) {
  const rawLength = request.headers.get('Content-Length');
  if (!rawLength) return false;
  const length = Number(rawLength);
  return Number.isFinite(length) && length > AI_MAX_REQUEST_BYTES;
}

async function parseJsonBody(request) {
  try { return await request.json(); }
  catch (_) { return null; }
}

function normalizeLiveAiBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_json' };
  if (typeof body.initData !== 'string' || !body.initData) return { ok: false, error: 'invalid_init_data' };
  if (!AI_ALLOWED_MODES.has(body.mode)) return { ok: false, error: 'invalid_ai_mode' };
  if (typeof body.frame !== 'string' || body.frame.length > AI_MAX_FRAME_CHARS || !AI_FRAME_PATTERN.test(body.frame)) {
    return { ok: false, error: 'invalid_ai_frame' };
  }
  const rhythm = AI_ALLOWED_RHYTHMS.has(body.rhythm) ? body.rhythm : 'smart';
  const trigger = AI_ALLOWED_TRIGGERS.has(body.trigger) ? body.trigger : 'scene';
  return { ok: true, body: { ...body, rhythm, trigger } };
}

async function authenticateLiveAi(request, env, ctx, initData) {
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

async function consumeAiRateLimit(env, telegramId) {
  if (!env.DB || typeof env.DB.prepare !== 'function') return { ok: false, configured: false };

  const now = Math.floor(Date.now() / 1000);
  const minuteBucket = Math.floor(now / 60);
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO ai_usage_minute (telegram_id, minute_bucket, requests, updated_at)
      VALUES (?, ?, 0, ?)
    `).bind(telegramId, minuteBucket, now).run();

    const update = await env.DB.prepare(`
      UPDATE ai_usage_minute
      SET requests = requests + 1, updated_at = ?
      WHERE telegram_id = ?
        AND minute_bucket = ?
        AND requests < ?
    `).bind(now, telegramId, minuteBucket, AI_RATE_LIMIT_PER_MINUTE).run();

    const changes = Number(update?.meta?.changes ?? update?.changes ?? 0);
    if (changes < 1) {
      return {
        ok: false,
        configured: true,
        limited: true,
        retryAfter: Math.max(1, 60 - (now % 60)),
        remaining: 0
      };
    }

    const row = await env.DB.prepare(`
      SELECT requests FROM ai_usage_minute
      WHERE telegram_id = ? AND minute_bucket = ?
      LIMIT 1
    `).bind(telegramId, minuteBucket).first();
    const current = Number(row?.requests || AI_RATE_LIMIT_PER_MINUTE);
    return { ok: true, configured: true, remaining: Math.max(0, AI_RATE_LIMIT_PER_MINUTE - current) };
  } catch (_) {
    return { ok: false, configured: false };
  }
}

function modeInstruction(mode) {
  if (mode === 'director') return 'Give one immediate directing tip: what to show, say, or do next.';
  if (mode === 'ideas') return 'Give one natural next idea based on what is visibly happening.';
  if (mode === 'hooks') return 'Give one short hook or audience question that fits the visible scene.';
  return 'Give one gentle situational joke about the visible scene. Never mock appearance or identity.';
}

function rhythmInstruction(rhythm, trigger) {
  if (rhythm === 'active') {
    const heartbeat = trigger === 'heartbeat'
      ? 'The scene may be calm. Still give a fresh short line grounded in what is visible.'
      : 'React to this visible moment with a short spoken line.';
    return `Active rhythm. ${heartbeat} Prefer action=suggest; use action=none only if no safe grounded line is possible.`;
  }
  return 'Smart rhythm. It is fine to return action=none when there is nothing genuinely useful or funny to say.';
}

function buildLiveAiPrompt(mode, languageCode, rhythm, trigger) {
  const language = typeof languageCode === 'string' && languageCode ? languageCode : 'en';
  return [
    `Mode=${mode}. Rhythm=${rhythm}. Trigger=${trigger}. Reply language=${language}.`,
    modeInstruction(mode),
    rhythmInstruction(rhythm, trigger),
    'Use only clear, non-sensitive visible details. Never identify people or infer private traits.',
    'Keep the spoken line very short: usually 3-10 words.',
    'scene must be a tiny neutral visible-scene summary.'
  ].join('\n');
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function normalizeAiResult(value) {
  if (!value || typeof value !== 'object') return null;
  const action = value.action === 'suggest' ? 'suggest' : value.action === 'none' ? 'none' : '';
  const allowedTypes = new Set(['joke', 'director', 'idea', 'hook', 'none']);
  const type = allowedTypes.has(value.type) ? value.type : '';
  const text = typeof value.text === 'string' ? value.text.trim().slice(0, 120) : '';
  const scene = typeof value.scene === 'string' ? value.scene.trim().slice(0, 140) : '';
  if (!action || !type) return null;
  if (action === 'none') return { action: 'none', type: 'none', text: '', scene };
  if (!text || type === 'none') return null;
  return { action, type, text, scene };
}

async function callLiveAiProvider(env, body, user) {
  if (!env.OPENAI_API_KEY) return { ok: false, error: 'ai_not_configured', status: 503 };

  const model = typeof env.OPENAI_LIVE_MODEL === 'string' && env.OPENAI_LIVE_MODEL.trim()
    ? env.OPENAI_LIVE_MODEL.trim()
    : AI_DEFAULT_MODEL;
  const providerStartedAt = Date.now();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 96,
      instructions: 'You are PromptCam Live AI. React fast. Return only the required structured result.',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: buildLiveAiPrompt(body.mode, user.language_code, body.rhythm, body.trigger) },
          { type: 'input_image', image_url: body.frame, detail: 'low' }
        ]
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'promptcam_live_ai',
          strict: true,
          schema: AI_RESPONSE_SCHEMA
        }
      }
    })
  });

  const payload = await response.json().catch(() => null);
  const providerLatencyMs = Math.max(0, Date.now() - providerStartedAt);
  if (!response.ok) return { ok: false, error: 'ai_provider_failed', status: 502, providerLatencyMs, model };

  const rawText = extractResponseText(payload);
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch (_) { return { ok: false, error: 'ai_invalid_response', status: 502, providerLatencyMs, model }; }

  const result = normalizeAiResult(parsed);
  if (!result) return { ok: false, error: 'ai_invalid_response', status: 502, providerLatencyMs, model };
  return { ok: true, result, providerLatencyMs, model };
}

async function recordAiEvent(env, event) {
  if (!env.DB || typeof env.DB.prepare !== 'function') return;
  try {
    await env.DB.prepare(`
      INSERT INTO ai_request_events (
        telegram_id, created_at, mode, rhythm, trigger_type, action,
        status, total_ms, provider_ms, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.telegramId,
      event.createdAt,
      event.mode,
      event.rhythm,
      event.trigger,
      event.action,
      event.status,
      event.totalMs,
      event.providerMs,
      event.model
    ).run();
  } catch (_) {
    // Telemetry is best-effort and must never affect the live response.
  }
}

function queueAiEvent(ctx, env, event) {
  const promise = recordAiEvent(env, event);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(promise);
  else promise.catch(() => {});
}

async function liveAi(request, env, ctx) {
  const startedAt = Date.now();
  if (requestTooLarge(request)) return json({ ok: false, error: 'request_too_large' }, 413);

  const rawBody = await parseJsonBody(request);
  const normalized = normalizeLiveAiBody(rawBody);
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
  const body = normalized.body;

  const auth = await authenticateLiveAi(request, env, ctx, body.initData);
  if (!auth.ok) return auth.response;
  if (!env.OPENAI_API_KEY) return json({ ok: false, error: 'ai_not_configured' }, 503);

  const telegramId = String(auth.user.id);
  const rateLimit = await consumeAiRateLimit(env, telegramId);
  if (!rateLimit.configured) return json({ ok: false, error: 'ai_database_not_initialized' }, 503);
  if (rateLimit.limited) {
    return json(
      { ok: false, error: 'ai_rate_limited', retryAfter: rateLimit.retryAfter },
      429,
      { 'Retry-After': String(rateLimit.retryAfter) }
    );
  }

  const provider = await callLiveAiProvider(env, body, auth.user);
  const totalMs = Math.max(0, Date.now() - startedAt);
  const providerMs = Number(provider.providerLatencyMs || 0);
  const model = provider.model || AI_DEFAULT_MODEL;

  if (!provider.ok) {
    queueAiEvent(ctx, env, {
      telegramId,
      createdAt: Math.floor(Date.now() / 1000),
      mode: body.mode,
      rhythm: body.rhythm,
      trigger: body.trigger,
      action: 'error',
      status: provider.error,
      totalMs,
      providerMs,
      model
    });
    return json({
      ok: false,
      error: provider.error,
      latency: { totalMs, providerMs }
    }, provider.status);
  }

  queueAiEvent(ctx, env, {
    telegramId,
    createdAt: Math.floor(Date.now() / 1000),
    mode: body.mode,
    rhythm: body.rhythm,
    trigger: body.trigger,
    action: provider.result.action,
    status: 'ok',
    totalMs,
    providerMs,
    model
  });

  return json({
    ok: true,
    ...provider.result,
    rhythm: body.rhythm,
    trigger: body.trigger,
    latency: { totalMs, providerMs },
    rateLimit: { remaining: rateLimit.remaining }
  }, 200, {
    'Server-Timing': `promptcam-ai;dur=${totalMs}`
  });
}

async function augmentedHealth(request, env, ctx) {
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload?.ok) return response;
  return json({ ...payload, aiProviderConfigured: Boolean(env.OPENAI_API_KEY) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return augmentedHealth(request, env, ctx);
    }

    if (url.pathname === '/api/ai/live') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return liveAi(request, env, ctx);
    }

    if (url.pathname === '/api/billing/invoice' && request.method === 'POST') {
      const response = await app.fetch(request.clone(), env, ctx);
      if (!response.ok) return response;

      const payload = await response.clone().json().catch(() => null);
      if (!payload?.ok || !payload?.invoiceUrl) return response;

      const webhook = await ensureTelegramWebhook(request, env);
      if (!webhook.ok) {
        return json({ ok: false, error: webhook.error, reason: webhook.reason || '' }, 503);
      }
      return response;
    }

    return app.fetch(request, env, ctx);
  }
};

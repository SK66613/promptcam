import app from './index.js';

const TELEGRAM_ALLOWED_UPDATES = ['message', 'pre_checkout_query'];
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const AI_ALLOWED_MODES = new Set(['jokes', 'director', 'ideas', 'hooks']);
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
    text: { type: 'string', maxLength: 180 },
    scene: { type: 'string', maxLength: 220 }
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
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'telegram_not_configured' };
  }
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return { ok: false, error: 'telegram_webhook_not_configured' };
  }
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
    return {
      ok: false,
      error: 'telegram_webhook_setup_failed',
      reason: error?.description || ''
    };
  }
}

function requestTooLarge(request) {
  const rawLength = request.headers.get('Content-Length');
  if (!rawLength) return false;
  const length = Number(rawLength);
  return Number.isFinite(length) && length > AI_MAX_REQUEST_BYTES;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}

function validateLiveAiBody(body) {
  if (!body || typeof body !== 'object') return 'invalid_json';
  if (typeof body.initData !== 'string' || !body.initData) return 'invalid_init_data';
  if (!AI_ALLOWED_MODES.has(body.mode)) return 'invalid_ai_mode';
  if (typeof body.frame !== 'string' || body.frame.length > AI_MAX_FRAME_CHARS) return 'invalid_ai_frame';
  if (!AI_FRAME_PATTERN.test(body.frame)) return 'invalid_ai_frame';
  return '';
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
  if (!env.DB || typeof env.DB.prepare !== 'function') {
    return { ok: false, configured: false };
  }

  const now = Math.floor(Date.now() / 1000);
  const minuteBucket = Math.floor(now / 60);
  try {
    const row = await env.DB.prepare(`
      SELECT requests
      FROM ai_usage_minute
      WHERE telegram_id = ? AND minute_bucket = ?
      LIMIT 1
    `).bind(telegramId, minuteBucket).first();

    const current = Number(row?.requests || 0);
    if (current >= AI_RATE_LIMIT_PER_MINUTE) {
      return {
        ok: false,
        configured: true,
        limited: true,
        retryAfter: Math.max(1, 60 - (now % 60)),
        remaining: 0
      };
    }

    await env.DB.prepare(`
      INSERT INTO ai_usage_minute (telegram_id, minute_bucket, requests, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(telegram_id, minute_bucket) DO UPDATE SET
        requests = ai_usage_minute.requests + 1,
        updated_at = excluded.updated_at
    `).bind(telegramId, minuteBucket, now).run();

    return {
      ok: true,
      configured: true,
      remaining: Math.max(0, AI_RATE_LIMIT_PER_MINUTE - current - 1)
    };
  } catch (_) {
    return { ok: false, configured: false };
  }
}

function modeInstruction(mode) {
  if (mode === 'director') {
    return 'Give one short, immediately useful directing suggestion for what the speaker should show, say, or do next.';
  }
  if (mode === 'ideas') {
    return 'Give one short idea that helps the speaker continue the video naturally based on what is visibly happening.';
  }
  if (mode === 'hooks') {
    return 'Give one short hook or audience question that fits the visible scene and can be spoken naturally right now.';
  }
  return 'Give one gentle, situational joke about the visible scene. Never mock appearance, body, identity, disability, or other sensitive traits.';
}

function buildLiveAiPrompt(mode, languageCode) {
  const language = typeof languageCode === 'string' && languageCode ? languageCode : 'en';
  return [
    `Mode: ${mode}. User language code: ${language}.`,
    modeInstruction(mode),
    'Comment only on clearly visible, non-sensitive details. Do not identify people or infer private/sensitive traits.',
    'Be useful and concise: normally 3–14 words. Avoid repetition and generic filler.',
    'If there is nothing worth saying from this frame, return action=none, type=none, text="".',
    'scene should be a very short neutral summary of visible non-sensitive scene context.'
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
  const text = typeof value.text === 'string' ? value.text.trim().slice(0, 180) : '';
  const scene = typeof value.scene === 'string' ? value.scene.trim().slice(0, 220) : '';
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

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 180,
      instructions: 'You are PromptCam Live AI, a realtime camera copilot. Follow the requested mode and return only the required structured result.',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: buildLiveAiPrompt(body.mode, user.language_code) },
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
  if (!response.ok) return { ok: false, error: 'ai_provider_failed', status: 502 };

  const rawText = extractResponseText(payload);
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch (_) { return { ok: false, error: 'ai_invalid_response', status: 502 }; }

  const result = normalizeAiResult(parsed);
  if (!result) return { ok: false, error: 'ai_invalid_response', status: 502 };
  return { ok: true, result };
}

async function liveAi(request, env, ctx) {
  if (requestTooLarge(request)) return json({ ok: false, error: 'request_too_large' }, 413);

  const body = await parseJsonBody(request);
  const validationError = validateLiveAiBody(body);
  if (validationError) return json({ ok: false, error: validationError }, 400);

  const auth = await authenticateLiveAi(request, env, ctx, body.initData);
  if (!auth.ok) return auth.response;

  const rateLimit = await consumeAiRateLimit(env, String(auth.user.id));
  if (!rateLimit.configured) {
    return json({ ok: false, error: 'ai_database_not_initialized' }, 503);
  }
  if (rateLimit.limited) {
    return json(
      { ok: false, error: 'ai_rate_limited', retryAfter: rateLimit.retryAfter },
      429,
      { 'Retry-After': String(rateLimit.retryAfter) }
    );
  }

  const provider = await callLiveAiProvider(env, body, auth.user);
  if (!provider.ok) return json({ ok: false, error: provider.error }, provider.status);

  return json({
    ok: true,
    ...provider.result,
    rateLimit: { remaining: rateLimit.remaining }
  });
}

async function augmentedHealth(request, env, ctx) {
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) return response;
  const payload = await response.json().catch(() => null);
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
        return json({
          ok: false,
          error: webhook.error,
          reason: webhook.reason || ''
        }, 503);
      }

      return response;
    }

    return app.fetch(request, env, ctx);
  }
};

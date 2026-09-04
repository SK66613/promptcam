import app from './index.js';

const SPEECH_MAX_REQUEST_BYTES = 2_000_000;
const SPEECH_MAX_AUDIO_BYTES = 1_500_000;
const SPEECH_RATE_LIMIT_PER_MINUTE = 18;
const SPEECH_DEFAULT_MODEL = 'gpt-transcribe';
const SPEECH_SCRIPT_CONTEXT_MAX_CHARS = 700;
const SPEECH_PREVIOUS_TEXT_MAX_CHARS = 320;
const SPEECH_TRANSCRIPT_MAX_CHARS = 1600;
const SPEECH_ALLOWED_MIME_TYPES = new Set([
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'video/mp4',
  'video/webm'
]);

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

function compactText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function requestTooLarge(request) {
  const rawLength = request.headers.get('Content-Length');
  if (!rawLength) return false;
  const length = Number(rawLength);
  return Number.isFinite(length) && length > SPEECH_MAX_REQUEST_BYTES;
}

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function extensionForMimeType(type) {
  if (type === 'audio/webm' || type === 'video/webm') return 'webm';
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3';
  if (type === 'audio/wav' || type === 'audio/x-wav') return 'wav';
  if (type === 'video/mp4') return 'mp4';
  return 'm4a';
}

function isFileLike(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.size === 'number' &&
    typeof value.arrayBuffer === 'function'
  );
}

async function authenticateSpeech(request, env, ctx, initData) {
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

async function consumeSpeechRateLimit(env, telegramId) {
  if (!env.DB || typeof env.DB.prepare !== 'function') return { ok: false, configured: false };
  const now = Math.floor(Date.now() / 1000);
  const minuteBucket = Math.floor(now / 60);
  const bucketId = `speech:${telegramId}`;

  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO ai_usage_minute (telegram_id, minute_bucket, requests, updated_at)
      VALUES (?, ?, 0, ?)
    `).bind(bucketId, minuteBucket, now).run();

    const update = await env.DB.prepare(`
      UPDATE ai_usage_minute
      SET requests = requests + 1, updated_at = ?
      WHERE telegram_id = ?
        AND minute_bucket = ?
        AND requests < ?
    `).bind(now, bucketId, minuteBucket, SPEECH_RATE_LIMIT_PER_MINUTE).run();

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
    `).bind(bucketId, minuteBucket).first();
    const current = Number(row?.requests || SPEECH_RATE_LIMIT_PER_MINUTE);
    return { ok: true, configured: true, remaining: Math.max(0, SPEECH_RATE_LIMIT_PER_MINUTE - current) };
  } catch (_) {
    return { ok: false, configured: false };
  }
}

function transcriptionPrompt(scriptContext, previousText) {
  const parts = [];
  if (scriptContext) parts.push(`Video script/topic context: ${scriptContext}`);
  if (previousText) parts.push(`Recent transcript context before this chunk: ${previousText}`);
  if (!parts.length) return '';
  parts.push('Transcribe only speech that is actually present in the uploaded audio chunk.');
  return parts.join('\n');
}

async function callSpeechProvider(env, audio, mimeType, scriptContext, previousText, user) {
  if (!env.OPENAI_API_KEY) return { ok: false, error: 'ai_not_configured', status: 503 };
  const model = typeof env.OPENAI_TRANSCRIBE_MODEL === 'string' && env.OPENAI_TRANSCRIBE_MODEL.trim()
    ? env.OPENAI_TRANSCRIBE_MODEL.trim()
    : SPEECH_DEFAULT_MODEL;
  const providerStartedAt = Date.now();

  const form = new FormData();
  form.append('model', model);
  const extension = extensionForMimeType(mimeType);
  form.append('file', audio, `promptcam-speech.${extension}`);
  const prompt = transcriptionPrompt(scriptContext, previousText);
  if (prompt) form.append('prompt', prompt);
  const language = compactText(user?.language_code || '', 12).split(/[-_]/)[0].toLowerCase();
  if (/^[a-z]{2,3}$/.test(language)) form.append('language', language);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: form
  });
  const payload = await response.json().catch(() => null);
  const providerLatencyMs = Math.max(0, Date.now() - providerStartedAt);
  if (!response.ok) {
    return { ok: false, error: 'speech_provider_failed', status: 502, providerLatencyMs, model };
  }

  const text = compactText(payload?.text || '', SPEECH_TRANSCRIPT_MAX_CHARS);
  return { ok: true, text, providerLatencyMs, model };
}

export async function handleSpeechRequest(request, env, ctx) {
  const startedAt = Date.now();
  if (requestTooLarge(request)) return json({ ok: false, error: 'speech_request_too_large' }, 413);
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('multipart/form-data')) {
    return json({ ok: false, error: 'invalid_speech_content_type' }, 400);
  }

  let form;
  try { form = await request.formData(); }
  catch (_) { return json({ ok: false, error: 'invalid_speech_form' }, 400); }

  const initData = typeof form.get('initData') === 'string' ? String(form.get('initData')) : '';
  if (!initData || initData.length > 20_000) return json({ ok: false, error: 'invalid_init_data' }, 400);

  const audio = form.get('audio');
  if (!isFileLike(audio) || audio.size < 200 || audio.size > SPEECH_MAX_AUDIO_BYTES) {
    return json({ ok: false, error: 'invalid_speech_audio' }, 400);
  }
  const mimeType = normalizeMimeType(audio.type);
  if (!SPEECH_ALLOWED_MIME_TYPES.has(mimeType)) {
    return json({ ok: false, error: 'unsupported_speech_audio' }, 415);
  }

  const durationMs = Math.max(0, Math.min(7000, Math.round(Number(form.get('durationMs') || 0))));
  const scriptContext = compactText(String(form.get('scriptContext') || ''), SPEECH_SCRIPT_CONTEXT_MAX_CHARS);
  const previousText = compactText(String(form.get('previousText') || ''), SPEECH_PREVIOUS_TEXT_MAX_CHARS);

  const auth = await authenticateSpeech(request, env, ctx, initData);
  if (!auth.ok) return auth.response;
  if (!env.OPENAI_API_KEY) return json({ ok: false, error: 'ai_not_configured' }, 503);

  const telegramId = String(auth.user.id);
  const rateLimit = await consumeSpeechRateLimit(env, telegramId);
  if (!rateLimit.configured) return json({ ok: false, error: 'ai_database_not_initialized' }, 503);
  if (rateLimit.limited) {
    return json(
      { ok: false, error: 'speech_rate_limited', retryAfter: rateLimit.retryAfter },
      429,
      { 'Retry-After': String(rateLimit.retryAfter) }
    );
  }

  const provider = await callSpeechProvider(env, audio, mimeType, scriptContext, previousText, auth.user);
  const totalMs = Math.max(0, Date.now() - startedAt);
  const providerMs = Number(provider.providerLatencyMs || 0);
  if (!provider.ok) {
    return json({
      ok: false,
      error: provider.error,
      latency: { totalMs, providerMs }
    }, provider.status);
  }

  return json({
    ok: true,
    text: provider.text,
    durationMs,
    model: provider.model,
    latency: { totalMs, providerMs },
    rateLimit: { remaining: rateLimit.remaining }
  }, 200, {
    'Server-Timing': `promptcam-speech;dur=${totalMs}`
  });
}

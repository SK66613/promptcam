import app from './speech-entry.js';
import { maybeHandleTakeDirector } from './take-director.js';
import { handleScriptAi } from './script-ai.js';
import { handleCreatorLibrary } from './creator-library.js';

const SPEECH_CONTEXT_MODES = new Set(['crew', 'acting']);
const SPEECH_CONTEXT_MAX_CHARS = 520;
const SCRIPT_CONTEXT_MAX_CHARS = 1000;
const COMBINED_CONTEXT_MAX_CHARS = 1600;
const SPEECH_CONTEXT_MAX_SPAN_MS = 35_000;
const LIVE_AI_MAX_REQUEST_BYTES = 1_500_000;

function compactText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeSpanMs(value) {
  const number = Math.round(Number(value || 0));
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(SPEECH_CONTEXT_MAX_SPAN_MS, number);
}

function requestTooLarge(request) {
  const rawLength = request.headers.get('Content-Length');
  if (!rawLength) return false;
  const length = Number(rawLength);
  return Number.isFinite(length) && length > LIVE_AI_MAX_REQUEST_BYTES;
}

async function rewriteLiveAiRequest(request) {
  if (requestTooLarge(request)) return { request, speech: null };
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { request, speech: null };
  }

  let body;
  try { body = await request.clone().json(); }
  catch (_) { return { request, speech: null }; }
  if (!body || typeof body !== 'object' || !SPEECH_CONTEXT_MODES.has(body.mode)) {
    return { request, speech: null };
  }

  const speechText = compactText(body.speechContext?.text, SPEECH_CONTEXT_MAX_CHARS);
  const spanMs = normalizeSpanMs(body.speechContext?.spanMs);
  delete body.speechContext;
  if (!speechText) {
    const headers = new Headers(request.headers);
    headers.delete('Content-Length');
    return {
      request: new Request(request, { headers, body: JSON.stringify(body) }),
      speech: null
    };
  }

  const scriptText = compactText(body.scriptContext, SCRIPT_CONTEXT_MAX_CHARS);
  const seconds = Math.max(1, Math.round(spanMs / 1000));
  body.scriptContext = [
    `[RECENT_ACTUAL_SPEECH_WORDS_ONLY_NO_PROSODY_LAST_${seconds}S] ${speechText}`,
    `[TELEPROMPTER_SCRIPT_TOPIC] ${scriptText}`
  ].join('\n').slice(0, COMBINED_CONTEXT_MAX_CHARS);

  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/json');
  headers.delete('Content-Length');

  return {
    request: new Request(request, { headers, body: JSON.stringify(body) }),
    speech: { chars: speechText.length, spanMs }
  };
}

function withSpeechDebugHeader(response, speech) {
  if (!speech) return response;
  const headers = new Headers(response.headers);
  headers.set('X-PromptCam-Speech-Context', `chars=${speech.chars};spanMs=${speech.spanMs}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/library') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleCreatorLibrary(request, env, ctx);
    }

    if (url.pathname === '/api/ai/script') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleScriptAi(request, env, ctx);
    }

    if (url.pathname === '/api/ai/live' && request.method === 'POST') {
      const takeResponse = await maybeHandleTakeDirector(request, env, ctx);
      if (takeResponse) return takeResponse;
      const rewritten = await rewriteLiveAiRequest(request);
      const response = await app.fetch(rewritten.request, env, ctx);
      return withSpeechDebugHeader(response, rewritten.speech);
    }
    return app.fetch(request, env, ctx);
  }
};

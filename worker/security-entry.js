import app from './launch-entry.js';

const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  headers.set('Content-Security-Policy-Report-Only', REPORT_ONLY_CSP);

  const contentType = String(headers.get('Content-Type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    headers.set('Cache-Control', 'no-store, max-age=0');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await app.fetch(request, env, ctx);
      return secureResponse(response);
    } catch (_) {
      return secureResponse(new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      }));
    }
  }
};

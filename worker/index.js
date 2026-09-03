const encoder = new TextEncoder();
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 5 * 60;

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

async function hmacSha256(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifyTelegramHash(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const signature = hexToBytes(hash);
  if (!signature) return false;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const verificationKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    'HMAC',
    verificationKey,
    signature,
    encoder.encode(dataCheckString)
  );
}

function parseTelegramUser(params) {
  const rawUser = params.get('user');
  if (!rawUser) return null;
  try {
    const user = JSON.parse(rawUser);
    if (!user || typeof user !== 'object' || !Number.isFinite(Number(user.id))) return null;
    return {
      id: String(user.id),
      first_name: typeof user.first_name === 'string' ? user.first_name : '',
      last_name: typeof user.last_name === 'string' ? user.last_name : '',
      username: typeof user.username === 'string' ? user.username : '',
      language_code: typeof user.language_code === 'string' ? user.language_code : '',
      is_premium: Boolean(user.is_premium),
      photo_url: typeof user.photo_url === 'string' ? user.photo_url : ''
    };
  } catch (_) {
    return null;
  }
}

async function validateTelegramInitData(initData, botToken) {
  if (typeof initData !== 'string' || !initData || initData.length > 16384) {
    return { ok: false, reason: 'invalid_init_data' };
  }

  const params = new URLSearchParams(initData);
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'missing_auth_date' };
  if (authDate > now + FUTURE_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'future_auth_date' };
  if (now - authDate > MAX_INIT_DATA_AGE_SECONDS) return { ok: false, reason: 'expired_init_data' };

  if (!(await verifyTelegramHash(initData, botToken))) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const user = parseTelegramUser(params);
  if (!user) return { ok: false, reason: 'missing_user' };

  return {
    ok: true,
    authDate,
    queryId: params.get('query_id') || '',
    user
  };
}

async function telegramSession(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({ ok: false, error: 'telegram_not_configured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const result = await validateTelegramInitData(body?.initData, env.TELEGRAM_BOT_TOKEN);
  if (!result.ok) return json({ ok: false, error: result.reason }, 401);

  return json({
    ok: true,
    authDate: result.authDate,
    queryId: result.queryId,
    user: result.user
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'promptcam',
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN)
      });
    }

    if (url.pathname === '/api/telegram/session') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return telegramSession(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

import app from './speech-context-entry.js';
import {
  ensureWalletWebhook,
  handleWalletApi,
  maybeHandleTokenWebhook,
  meterAiRequest
} from './ai-wallet.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/telegram/webhook' && request.method === 'POST') {
      const tokenResponse = await maybeHandleTokenWebhook(request, env, ctx);
      if (tokenResponse) return tokenResponse;
      return app.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/ai/wallet') {
      ensureWalletWebhook(request, env, ctx).catch(() => {});
      return handleWalletApi(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/ai/')) {
      ensureWalletWebhook(request, env, ctx).catch(() => {});
      return meterAiRequest(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  }
};

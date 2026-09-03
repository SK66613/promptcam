(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const isTelegram = Boolean(tg?.initData);
  const root = document.documentElement;
  root.dataset.telegram = isTelegram ? 'true' : 'false';

  const bridge = {
    isTelegram,
    platform: tg?.platform || 'web',
    version: tg?.version || '',
    sessionValid: false,
    user: null
  };
  window.PromptCamTelegram = bridge;

  if (!isTelegram) return;

  const byId = (id) => document.getElementById(id);
  const editor = byId('editorView');
  const camera = byId('cameraView');
  const dialog = byId('resultDialog');
  const backButton = byId('backButton');
  const retryButton = byId('retryButton');
  const openCameraButton = byId('openCameraButton');
  const recordButton = byId('recordButton');
  const identity = byId('telegramIdentity');
  const identityText = byId('telegramIdentityText');

  const safe = (callback) => {
    try { return callback(); } catch (_) { return undefined; }
  };

  safe(() => tg.ready());
  safe(() => tg.expand());
  safe(() => tg.setHeaderColor('#09090d'));
  safe(() => tg.setBackgroundColor('#09090d'));
  if (typeof tg.setBottomBarColor === 'function') safe(() => tg.setBottomBarColor('#09090d'));

  if (identity) identity.classList.remove('hidden');

  function cameraIsOpen() {
    return Boolean(camera && !camera.classList.contains('hidden'));
  }

  function syncTelegramChrome() {
    const insideFlow = Boolean(dialog?.open || cameraIsOpen());
    if (insideFlow) safe(() => tg.BackButton.show());
    else safe(() => tg.BackButton.hide());

    if (cameraIsOpen() && typeof tg.disableVerticalSwipes === 'function') {
      safe(() => tg.disableVerticalSwipes());
    } else if (typeof tg.enableVerticalSwipes === 'function') {
      safe(() => tg.enableVerticalSwipes());
    }
  }

  function handleTelegramBack() {
    if (dialog?.open && retryButton) {
      retryButton.click();
      return;
    }
    if (cameraIsOpen() && backButton) {
      backButton.click();
      return;
    }
    safe(() => tg.close());
  }

  safe(() => tg.BackButton.onClick(handleTelegramBack));

  const observer = new MutationObserver(syncTelegramChrome);
  if (editor) observer.observe(editor, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  if (camera) observer.observe(camera, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  if (dialog) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });

  openCameraButton?.addEventListener('click', () => {
    safe(() => tg.HapticFeedback?.impactOccurred('light'));
    if (typeof tg.requestFullscreen === 'function' && !tg.isFullscreen) safe(() => tg.requestFullscreen());
  }, { capture: true });

  recordButton?.addEventListener('click', () => {
    safe(() => tg.HapticFeedback?.impactOccurred('medium'));
  }, { capture: true });

  function renderIdentity(user) {
    if (!identity || !identityText) return;
    identity.classList.remove('hidden');
    identityText.textContent = user?.first_name || user?.username || 'Telegram';
  }

  async function validateSession() {
    try {
      const response = await fetch('/api/telegram/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData }),
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) return;
      const payload = await response.json();
      bridge.sessionValid = true;
      bridge.user = payload.user || null;
      renderIdentity(bridge.user);
      window.dispatchEvent(new CustomEvent('promptcam:telegram-session', { detail: payload }));
    } catch (_) {
      // Mini App stays usable even if server-side Telegram validation is not configured yet.
    }
  }

  if (typeof tg.onEvent === 'function') {
    safe(() => tg.onEvent('viewportChanged', syncTelegramChrome));
    safe(() => tg.onEvent('safeAreaChanged', syncTelegramChrome));
    safe(() => tg.onEvent('contentSafeAreaChanged', syncTelegramChrome));
    safe(() => tg.onEvent('themeChanged', () => {
      safe(() => tg.setHeaderColor('#09090d'));
      safe(() => tg.setBackgroundColor('#09090d'));
    }));
  }

  renderIdentity(null);
  syncTelegramChrome();
  validateSession();
})();

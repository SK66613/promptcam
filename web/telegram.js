(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const isTelegram = Boolean(tg?.initData);
  const root = document.documentElement;
  root.dataset.telegram = isTelegram ? 'true' : 'false';

  const MOBILE_PLATFORMS = new Set(['ios', 'android', 'android_x']);
  const DESKTOP_PLATFORMS = new Set(['tdesktop', 'macos', 'web', 'weba', 'webk']);
  const telegramPlatform = String(tg?.platform || 'web').toLowerCase();
  const coarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const compactViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 1024;
  const isMobileTelegram = isTelegram && (
    MOBILE_PLATFORMS.has(telegramPlatform) ||
    (!DESKTOP_PLATFORMS.has(telegramPlatform) && coarsePointer && compactViewport)
  );
  const isDesktopTelegram = isTelegram && !isMobileTelegram;
  root.dataset.telegramDevice = isMobileTelegram ? 'mobile' : isDesktopTelegram ? 'desktop' : 'web';

  const bridge = {
    isTelegram,
    platform: telegramPlatform,
    version: tg?.version || '',
    isMobile: isMobileTelegram,
    isDesktop: isDesktopTelegram,
    fullscreenPolicy: isMobileTelegram ? 'always' : isDesktopTelegram ? 'never' : 'none',
    sessionValid: false,
    user: null
  };
  window.PromptCamTelegram = bridge;

  if (isTelegram) {
    try { tg.ready(); } catch (_) { /* Older clients may ignore this. */ }
  }

  function loadEditorShell() {
    if (!document.querySelector('link[data-promptcam-editor-tabs]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/editor-tabs.css';
      link.dataset.promptcamEditorTabs = 'true';
      document.head.append(link);
    }
    if (document.querySelector('script[data-promptcam-editor-tabs]')) return;
    const script = document.createElement('script');
    script.src = '/editor-tabs.js';
    script.dataset.promptcamEditorTabs = 'true';
    script.addEventListener('error', () => {
      document.documentElement.dataset.promptcamNativeMainButton = 'false';
    }, { once: true });
    document.head.append(script);
  }

  // Defer DOM restructuring until every regular `defer` script (including app.js)
  // has finished initialization. A deferred script runs while readyState can already
  // be `interactive`, so checking only for `loading` was too early in Telegram WebView.
  if (document.readyState === 'complete') {
    loadEditorShell();
  } else {
    document.addEventListener('DOMContentLoaded', loadEditorShell, { once: true });
  }

  if (!isTelegram) return;

  const byId = (id) => document.getElementById(id);
  const editor = byId('editorView');
  const camera = byId('cameraView');
  const dialog = byId('resultDialog');
  const paywall = byId('paywallDialog');
  const backButton = byId('backButton');
  const retryButton = byId('retryButton');
  const openCameraButton = byId('openCameraButton');
  const recordButton = byId('recordButton');
  const identity = byId('telegramIdentity');
  const identityText = byId('telegramIdentityText');

  const safe = (callback) => {
    try { return callback(); } catch (_) { return undefined; }
  };

  function enforceFullscreenPolicy() {
    if (isMobileTelegram) {
      safe(() => tg.expand());
      if (typeof tg.requestFullscreen === 'function' && !tg.isFullscreen) {
        safe(() => tg.requestFullscreen());
      }
      return;
    }

    if (isDesktopTelegram && typeof tg.exitFullscreen === 'function' && tg.isFullscreen) {
      safe(() => tg.exitFullscreen());
    }
  }

  enforceFullscreenPolicy();
  safe(() => tg.setHeaderColor('#09090d'));
  safe(() => tg.setBackgroundColor('#09090d'));
  if (typeof tg.setBottomBarColor === 'function') safe(() => tg.setBottomBarColor('#09090d'));

  if (identity) identity.classList.remove('hidden');

  function cameraIsOpen() {
    return Boolean(camera && !camera.classList.contains('hidden'));
  }

  function syncTelegramChrome() {
    const insideFlow = Boolean(paywall?.open || dialog?.open || cameraIsOpen());
    if (insideFlow) safe(() => tg.BackButton.show());
    else safe(() => tg.BackButton.hide());

    if (cameraIsOpen() && typeof tg.disableVerticalSwipes === 'function') {
      safe(() => tg.disableVerticalSwipes());
    } else if (typeof tg.enableVerticalSwipes === 'function') {
      safe(() => tg.enableVerticalSwipes());
    }
  }

  function handleTelegramBack() {
    if (paywall?.open) {
      paywall.close();
      return;
    }
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
  if (paywall) observer.observe(paywall, { attributes: true, attributeFilter: ['open'] });

  openCameraButton?.addEventListener('click', () => {
    safe(() => tg.HapticFeedback?.impactOccurred('light'));
    enforceFullscreenPolicy();
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
    safe(() => tg.onEvent('fullscreenChanged', enforceFullscreenPolicy));
    safe(() => tg.onEvent('activated', enforceFullscreenPolicy));
    safe(() => tg.onEvent('themeChanged', () => {
      safe(() => tg.setHeaderColor('#09090d'));
      safe(() => tg.setBackgroundColor('#09090d'));
    }));
  }

  renderIdentity(null);
  syncTelegramChrome();
  validateSession();
})();

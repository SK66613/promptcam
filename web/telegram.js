(() => {
  'use strict';

  window.__PromptCamEarlyErrors = window.__PromptCamEarlyErrors || [];
  if (!window.__PromptCamEarlyErrorHook) {
    window.__PromptCamEarlyErrorHook = true;
    window.addEventListener('error', (event) => {
      if (window.__PromptCamDebugActive) return;
      window.__PromptCamEarlyErrors.push({
        kind: 'early-error',
        message: String(event.message || 'Script error').slice(0, 260),
        file: String(event.filename || '').split('?')[0].split('#')[0],
        line: Number(event.lineno || 0),
        column: Number(event.colno || 0)
      });
    }, true);
    window.addEventListener('unhandledrejection', (event) => {
      if (window.__PromptCamDebugActive) return;
      const reason = event.reason?.message || event.reason || 'Unhandled promise rejection';
      window.__PromptCamEarlyErrors.push({ kind: 'early-promise', message: String(reason).slice(0, 260), file: '', line: 0, column: 0 });
    });
  }

  function ensureEmergencyDebugButton() {
    if (document.getElementById('pcdbgBtn') || document.getElementById('promptcamDebugEmergency')) return;
    if (!window.PromptCamDebug?.open || !document.body) return;
    const button = document.createElement('button');
    button.id = 'promptcamDebugEmergency';
    button.type = 'button';
    button.textContent = 'DBG';
    button.setAttribute('aria-label', 'Открыть диагностику PromptCam');
    button.style.cssText = 'position:fixed;z-index:2147483645;left:10px;bottom:76px;height:28px;padding:0 9px;border:1px solid rgba(255,190,80,.5);border-radius:9px;background:rgba(6,7,12,.92);color:#ffd189;font:800 10px -apple-system,sans-serif;';
    button.addEventListener('click', () => {
      button.remove();
      window.PromptCamDebug?.open?.();
    }, { once: true });
    document.body.append(button);
  }

  function loadDebugPanel() {
    if (window.PromptCamDebug || document.querySelector('script[data-promptcam-debug]')) return;
    const script = document.createElement('script');
    script.src = '/debug-panel.js';
    script.dataset.promptcamDebug = 'true';
    script.addEventListener('load', () => {
      window.__PromptCamDebugActive = true;
      const early = Array.isArray(window.__PromptCamEarlyErrors) ? window.__PromptCamEarlyErrors : [];
      early.slice(-10).forEach((item, index) => {
        window.PromptCamDebug?.mark?.(`Early error ${index + 1}`, 'error', `${item.message}${item.file ? ` · ${item.file}:${item.line || 0}` : ''}`);
      });
      window.PromptCamDebug?.mark?.('Debug loader', 'ok', 'debug-panel.js loaded from telegram bridge');
      if (document.readyState !== 'loading') ensureEmergencyDebugButton();
    }, { once: true });
    script.addEventListener('error', () => {
      window.__PromptCamEarlyErrors.push({ kind: 'debug-loader', message: 'debug-panel.js failed to load', file: '/debug-panel.js', line: 0, column: 0 });
    }, { once: true });
    document.head.append(script);
  }

  loadDebugPanel();

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

  function lockTelegramVerticalSwipes() {
    if (typeof tg.disableVerticalSwipes === 'function') safe(() => tg.disableVerticalSwipes());
  }

  function enforceFullscreenPolicy() {
    if (isMobileTelegram) {
      safe(() => tg.expand());
      if (typeof tg.requestFullscreen === 'function' && !tg.isFullscreen) {
        safe(() => tg.requestFullscreen());
      }
      lockTelegramVerticalSwipes();
      return;
    }

    if (isDesktopTelegram && typeof tg.exitFullscreen === 'function' && tg.isFullscreen) {
      safe(() => tg.exitFullscreen());
    }
  }

  enforceFullscreenPolicy();
  lockTelegramVerticalSwipes();
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

    // PromptCam owns vertical scrolling inside the WebView. Keep Telegram's swipe-to-collapse
    // gesture disabled on editor, camera, dialogs and sheets so the Mini App does not jump away.
    lockTelegramVerticalSwipes();
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
    safe(() => tg.onEvent('fullscreenChanged', () => {
      enforceFullscreenPolicy();
      syncTelegramChrome();
    }));
    safe(() => tg.onEvent('activated', () => {
      enforceFullscreenPolicy();
      syncTelegramChrome();
    }));
    safe(() => tg.onEvent('themeChanged', () => {
      safe(() => tg.setHeaderColor('#09090d'));
      safe(() => tg.setBackgroundColor('#09090d'));
    }));
  }

  renderIdentity(null);
  syncTelegramChrome();
  validateSession();
})();

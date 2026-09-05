(() => {
  'use strict';

  const editor = document.getElementById('editorView');
  const shell = editor?.querySelector('.editor-shell');
  const brand = shell?.querySelector('.app-brand');
  const scriptHeading = shell?.querySelector('.script-heading');
  const editorCard = shell?.querySelector('.editor-card');
  const settingsHeading = shell?.querySelector('.settings-heading');
  const settingsStack = shell?.querySelector('.settings-stack');
  const openCameraButton = document.getElementById('openCameraButton');
  const privacyNote = shell?.querySelector('.privacy-note');
  const camera = document.getElementById('cameraView');
  const resultDialog = document.getElementById('resultDialog');
  const paywallDialog = document.getElementById('paywallDialog');
  const scriptInput = document.getElementById('scriptInput');
  if (!editor || !shell || !brand || !scriptHeading || !editorCard || !settingsHeading || !settingsStack || !openCameraButton) return;

  const tg = window.Telegram?.WebApp;
  const STORAGE_KEY = 'promptcam.editor-tab.v1';
  const DEFINITIONS = [
    ['script', 'Сценарий'],
    ['ai', 'AI'],
    ['settings', 'Настройки'],
    ['library', 'Библиотека']
  ];

  const tabs = document.createElement('nav');
  tabs.className = 'editor-tabs';
  tabs.setAttribute('aria-label', 'Разделы редактора');

  const panels = new Map();
  const buttons = new Map();
  for (const [key, label] of DEFINITIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'editor-tab';
    button.dataset.editorTab = key;
    button.textContent = label;
    button.setAttribute('aria-pressed', 'false');
    tabs.append(button);
    buttons.set(key, button);

    const panel = document.createElement('section');
    panel.className = 'editor-tab-panel';
    panel.dataset.editorPanel = key;
    panel.hidden = true;
    panels.set(key, panel);
  }

  const aiPlaceholder = document.createElement('div');
  aiPlaceholder.className = 'editor-tab-placeholder';
  aiPlaceholder.textContent = 'AI для сценария загружается…';
  panels.get('ai').append(aiPlaceholder);

  const libraryPlaceholder = document.createElement('div');
  libraryPlaceholder.className = 'editor-tab-placeholder';
  libraryPlaceholder.textContent = 'Шаблоны и избранное загружаются…';
  panels.get('library').append(libraryPlaceholder);

  panels.get('script').append(scriptHeading, editorCard);
  panels.get('settings').append(settingsHeading, settingsStack);

  brand.after(tabs);
  let anchor = tabs;
  for (const [key] of DEFINITIONS) {
    const panel = panels.get(key);
    anchor.after(panel);
    anchor = panel;
  }

  const dock = document.createElement('div');
  dock.className = 'editor-camera-dock';
  dock.append(openCameraButton);
  shell.after(dock);
  if (privacyNote) panels.get('script').append(privacyNote);

  function readTab() {
    try {
      const value = sessionStorage.getItem(STORAGE_KEY) || '';
      return panels.has(value) ? value : 'script';
    } catch (_) {
      return 'script';
    }
  }

  function setTab(key, { focus = false } = {}) {
    const next = panels.has(key) ? key : 'script';
    for (const [name, panel] of panels) panel.hidden = name !== next;
    for (const [name, button] of buttons) {
      const selected = name === next;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    try { sessionStorage.setItem(STORAGE_KEY, next); } catch (_) { /* optional */ }
    if (focus) buttons.get(next)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  for (const [key, button] of buttons) {
    button.addEventListener('click', () => setTab(key));
  }

  function mountDynamicCards() {
    const scriptAiCard = document.querySelector('.script-ai-card');
    if (scriptAiCard && scriptAiCard.parentElement !== panels.get('ai')) {
      aiPlaceholder.remove();
      panels.get('ai').append(scriptAiCard);
    }
    const libraryCard = document.querySelector('.creator-library-card');
    if (libraryCard && libraryCard.parentElement !== panels.get('library')) {
      libraryPlaceholder.remove();
      panels.get('library').append(libraryCard);
    }
  }

  const observer = new MutationObserver(mountDynamicCards);
  observer.observe(shell, { childList: true, subtree: true });
  mountDynamicCards();

  function editorIsVisible() {
    return !editor.classList.contains('hidden') && !camera?.classList.contains('is-recording') && !resultDialog?.open && !paywallDialog?.open;
  }

  function scriptReady() {
    return Boolean(scriptInput?.value.trim());
  }

  function openCamera() {
    if (!scriptReady()) {
      setTab('script');
      scriptInput?.focus();
      openCameraButton.click();
      return;
    }
    openCameraButton.click();
  }

  let nativeMainButton = false;
  let mainButtonHandler = null;

  function configureTelegramMainButton() {
    const mainButton = tg?.MainButton;
    if (!tg?.initData || !mainButton || typeof mainButton.show !== 'function') {
      document.documentElement.dataset.promptcamNativeMainButton = 'false';
      return false;
    }

    nativeMainButton = true;
    document.documentElement.dataset.promptcamNativeMainButton = 'true';
    mainButtonHandler = openCamera;
    try {
      mainButton.setText?.('Открыть камеру');
      if (typeof mainButton.setParams === 'function') {
        mainButton.setParams({ text: 'Открыть камеру', is_visible: true, is_active: scriptReady(), has_shine_effect: true });
      }
      mainButton.onClick?.(mainButtonHandler);
    } catch (_) {
      nativeMainButton = false;
      document.documentElement.dataset.promptcamNativeMainButton = 'false';
      return false;
    }
    syncMainButton();
    return true;
  }

  function syncMainButton() {
    if (!nativeMainButton) return;
    const mainButton = tg?.MainButton;
    if (!mainButton) return;
    try {
      if (editorIsVisible()) {
        mainButton.setText?.('Открыть камеру');
        if (scriptReady()) mainButton.enable?.();
        else mainButton.disable?.();
        mainButton.show?.();
      } else {
        mainButton.hide?.();
      }
    } catch (_) { /* Telegram clients differ by version. */ }
  }

  scriptInput?.addEventListener('input', syncMainButton);
  const chromeObserver = new MutationObserver(syncMainButton);
  chromeObserver.observe(editor, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  if (camera) chromeObserver.observe(camera, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  if (resultDialog) chromeObserver.observe(resultDialog, { attributes: true, attributeFilter: ['open'] });
  if (paywallDialog) chromeObserver.observe(paywallDialog, { attributes: true, attributeFilter: ['open'] });

  window.addEventListener('promptcam:creator-modules-ready', mountDynamicCards);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    chromeObserver.disconnect();
    try {
      if (nativeMainButton && mainButtonHandler) tg?.MainButton?.offClick?.(mainButtonHandler);
      tg?.MainButton?.hide?.();
    } catch (_) { /* optional */ }
  });

  setTab(readTab());
  configureTelegramMainButton();
  editor.classList.add('editor-tabs-ready');

  window.PromptCamEditorTabs = Object.freeze({
    setTab,
    getTab: () => [...panels.entries()].find(([, panel]) => !panel.hidden)?.[0] || 'script',
    syncCameraButton: syncMainButton
  });

  if (!document.querySelector('script[data-promptcam-ai-wallet-ui]')) {
    const walletScript = document.createElement('script');
    walletScript.src = '/ai-wallet-ui.js?v=40';
    walletScript.dataset.promptcamAiWalletUi = 'true';
    document.head.append(walletScript);
  }
})();

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
  aiPlaceholder.textContent = 'Настройки AI Live загружаются…';
  panels.get('ai').append(aiPlaceholder);

  const libraryPlaceholder = document.createElement('div');
  libraryPlaceholder.className = 'editor-tab-placeholder';
  libraryPlaceholder.textContent = 'Шаблоны и избранное загружаются…';
  panels.get('library').append(libraryPlaceholder);

  panels.get('script').append(scriptHeading, editorCard);
  panels.get('settings').append(settingsHeading, settingsStack);
  if (privacyNote) panels.get('script').append(privacyNote);

  // Keep the original camera CTA as a hidden programmatic trigger. app.js, Telegram
  // fullscreen handling and permission logic continue to use this exact button.
  openCameraButton.classList.add('promptcam-legacy-camera-trigger');
  openCameraButton.hidden = true;
  panels.get('script').append(openCameraButton);

  brand.after(tabs);
  let anchor = tabs;
  for (const [key] of DEFINITIONS) {
    const panel = panels.get(key);
    anchor.after(panel);
    anchor = panel;
  }

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
    window.dispatchEvent(new CustomEvent('promptcam:editor-tab', { detail: { tab: next } }));
  }

  for (const [key, button] of buttons) button.addEventListener('click', () => setTab(key));

  function mountDynamicCards() {
    const scriptAiCard = document.querySelector('.script-ai-card');
    if (scriptAiCard && scriptAiCard.parentElement !== panels.get('script')) {
      editorCard.insertAdjacentElement('afterend', scriptAiCard);
    }

    const aiSetup = document.querySelector('.promptcam-ai-setup-card');
    if (aiSetup && aiSetup.parentElement !== panels.get('ai')) {
      aiPlaceholder.remove();
      panels.get('ai').append(aiSetup);
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

  function scriptReady() {
    return Boolean(scriptInput?.value.trim());
  }

  function openCamera() {
    if (!scriptReady()) {
      setTab('script');
      scriptInput?.focus();
      return false;
    }
    openCameraButton.click();
    return true;
  }

  // The expandable PromptCam dock replaces Telegram MainButton on the editor.
  try { tg?.MainButton?.hide?.(); } catch (_) { /* optional */ }
  document.documentElement.dataset.promptcamNativeMainButton = 'false';

  function loadScriptOnce(src, attribute) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[${attribute}]`);
      if (existing) {
        if (existing.dataset.promptcamReady === 'true') resolve(existing);
        else {
          existing.addEventListener('load', () => resolve(existing), { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.setAttribute(attribute, 'true');
      script.addEventListener('load', () => {
        script.dataset.promptcamReady = 'true';
        resolve(script);
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.append(script);
    });
  }

  function loadStyleOnce(href, attribute) {
    if (document.querySelector(`link[${attribute}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(attribute, 'true');
    document.head.append(link);
  }

  async function loadEditorHub() {
    loadStyleOnce('/editor-hub-v42.css?v=42', 'data-promptcam-editor-hub-v42');
    try {
      await loadScriptOnce('/editor-hub-v42.js?v=42', 'data-promptcam-editor-hub-v42');
      await loadScriptOnce('/ai-setup-v42.js?v=42', 'data-promptcam-ai-setup-v42');
      await loadScriptOnce('/ai-wallet-ui.js?v=42', 'data-promptcam-ai-wallet-ui');
      mountDynamicCards();
      window.dispatchEvent(new CustomEvent('promptcam:editor-hub-ready'));
    } catch (_) {
      // Existing tabs and camera trigger remain available if an optional hub asset fails.
    }
  }

  window.addEventListener('promptcam:creator-modules-ready', mountDynamicCards);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });

  setTab(readTab());
  editor.classList.add('editor-tabs-ready');

  window.PromptCamEditorTabs = Object.freeze({
    setTab,
    openCamera,
    scriptReady,
    getTab: () => [...panels.entries()].find(([, panel]) => !panel.hidden)?.[0] || 'script',
    getPanel: (key) => panels.get(key) || null,
    syncCameraButton: () => window.PromptCamEditorHub?.sync?.()
  });

  loadEditorHub();
})();

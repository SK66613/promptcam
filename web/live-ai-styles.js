(() => {
  'use strict';

  const STORAGE_KEY = 'promptcam.live-ai.presentation-style.v1';
  const COACHING_MODES = new Set(['crew', 'acting']);
  const STYLES = [
    ['calm', '😌 Спокойный', 'Стабильно и мягко'],
    ['energetic', '⚡ Энергичный', 'Живее и выразительнее'],
    ['expert', '🧠 Эксперт', 'Собранно и уверенно'],
    ['friendly', '🤝 Дружелюбный', 'Тепло и открыто']
  ];
  const VALID_STYLES = new Set(STYLES.map(([value]) => value));
  const panel = document.getElementById('liveAiPanel');
  const status = document.getElementById('liveAiStatus');
  const originalFetch = window.fetch.bind(window);

  let selectedStyle = readStyle();
  let currentMode = window.PromptCamLiveAI?.getStatus?.().mode || '';
  let label = null;
  let group = null;
  let buttons = [];

  function readStyle() {
    try {
      const value = localStorage.getItem(STORAGE_KEY) || '';
      return VALID_STYLES.has(value) ? value : 'expert';
    } catch (_) {
      return 'expert';
    }
  }

  function storeStyle(value) {
    try { localStorage.setItem(STORAGE_KEY, value); }
    catch (_) { /* Storage is optional. */ }
  }

  function coachingMode() {
    return COACHING_MODES.has(currentMode);
  }

  function render() {
    const visible = coachingMode();
    if (label) label.hidden = !visible;
    if (group) group.hidden = !visible;
    for (const button of buttons) {
      const selected = button.dataset.liveAiStyle === selectedStyle;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  function setStyle(value) {
    if (!VALID_STYLES.has(value)) return false;
    selectedStyle = value;
    storeStyle(value);
    render();
    if (status && coachingMode()) status.textContent = 'Стиль подачи изменён · применю в следующих подсказках';
    return true;
  }

  function ensureControls() {
    if (!panel || panel.querySelector('[data-live-ai-style]')) return;
    const rhythm = panel.querySelector('.live-ai-rhythm');
    if (!rhythm) return;

    label = document.createElement('span');
    label.className = 'live-ai-rhythm-label';
    label.textContent = 'СТИЛЬ ПОДАЧИ';

    group = document.createElement('div');
    group.className = 'live-ai-rhythm';
    group.setAttribute('aria-label', 'Стиль подачи AI Live');

    for (const [value, title, hint] of STYLES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'live-ai-rhythm-option';
      button.dataset.liveAiStyle = value;
      button.setAttribute('aria-pressed', 'false');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const small = document.createElement('small');
      small.textContent = hint;
      button.append(strong, small);
      button.addEventListener('click', () => setStyle(value));
      group.append(button);
    }

    rhythm.after(label, group);
    buttons = [...group.querySelectorAll('[data-live-ai-style]')];
    render();
  }

  function isLiveAiRequest(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    if (typeof raw !== 'string') return false;
    try {
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin && url.pathname === '/api/ai/live';
    } catch (_) {
      return raw === '/api/ai/live';
    }
  }

  window.fetch = function promptCamStyleFetch(input, init = {}) {
    if (!isLiveAiRequest(input) || typeof init?.body !== 'string') return originalFetch(input, init);
    try {
      const payload = JSON.parse(init.body);
      if (COACHING_MODES.has(payload?.mode)) {
        payload.presentationStyle = selectedStyle;
        return originalFetch(input, { ...init, body: JSON.stringify(payload) });
      }
    } catch (_) {
      // Keep unrelated requests untouched.
    }
    return originalFetch(input, init);
  };

  window.addEventListener('promptcam:live-ai-state', (event) => {
    currentMode = typeof event.detail?.mode === 'string' ? event.detail.mode : '';
    render();
  });

  ensureControls();

  window.PromptCamLiveAIStyles = Object.freeze({
    getStyle: () => selectedStyle,
    setStyle,
    getStatus: () => ({ style: selectedStyle, mode: currentMode, visible: coachingMode() })
  });
})();

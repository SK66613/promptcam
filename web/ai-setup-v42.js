(() => {
  'use strict';

  const live = window.PromptCamLiveAI;
  if (!live) return;

  const MODES = [
    ['jokes', '😄 Шутки'],
    ['director', '🎬 Режиссёр'],
    ['ideas', '💡 Идеи'],
    ['hooks', '🎣 Хуки'],
    ['crew', '🎬 Съёмочная группа'],
    ['acting', '🎭 Актёрский коуч'],
    ['critic', '🧐 Критик'],
    ['flatterer', '😎 Льстец']
  ];
  const RHYTHMS = [
    ['smart', 'Умный'],
    ['active', 'Активный']
  ];
  const STYLES = [
    ['calm', '😌 Спокойный'],
    ['energetic', '⚡ Энергичный'],
    ['expert', '🧠 Эксперт'],
    ['friendly', '🤝 Дружелюбный']
  ];

  const card = document.createElement('section');
  card.className = 'promptcam-ai-setup-card';
  card.setAttribute('aria-label', 'Настройки AI Live до съёмки');

  const head = document.createElement('div');
  head.className = 'promptcam-ai-setup-head';
  const title = document.createElement('span');
  title.className = 'promptcam-ai-setup-title';
  const titleStrong = document.createElement('strong');
  titleStrong.textContent = '✨ AI для съёмки';
  const titleSmall = document.createElement('small');
  titleSmall.textContent = 'Настрой AI заранее — эти же параметры используются в камере';
  title.append(titleStrong, titleSmall);
  const statePill = document.createElement('span');
  statePill.className = 'promptcam-ai-setup-state';
  statePill.textContent = 'OFF';
  head.append(title, statePill);

  function section(label) {
    const wrap = document.createElement('div');
    wrap.className = 'promptcam-ai-setup-section';
    const caption = document.createElement('span');
    caption.className = 'promptcam-ai-setup-label';
    caption.textContent = label;
    wrap.append(caption);
    card.append(wrap);
    return wrap;
  }

  card.append(head);

  const liveSection = section('AI LIVE');
  const liveToggle = document.createElement('button');
  liveToggle.type = 'button';
  liveToggle.className = 'promptcam-ai-setup-toggle';
  liveToggle.setAttribute('aria-pressed', 'false');
  const liveCopy = document.createElement('span');
  const liveTitle = document.createElement('strong'); liveTitle.textContent = 'AI Live';
  const liveHint = document.createElement('small'); liveHint.textContent = 'Включится и продолжит работу, когда откроешь камеру';
  liveCopy.append(liveTitle, liveHint);
  const liveValue = document.createElement('b'); liveValue.textContent = 'OFF';
  liveToggle.append(liveCopy, liveValue);
  liveSection.append(liveToggle);

  const takeToggle = document.createElement('button');
  takeToggle.type = 'button';
  takeToggle.className = 'promptcam-ai-setup-toggle';
  takeToggle.setAttribute('aria-pressed', 'false');
  const takeCopy = document.createElement('span');
  const takeTitle = document.createElement('strong'); takeTitle.textContent = '🎬 AI Дубль';
  const takeHint = document.createElement('small'); takeHint.textContent = 'Следит за сценарием и помогает только когда дубль страдает';
  takeCopy.append(takeTitle, takeHint);
  const takeValue = document.createElement('b'); takeValue.textContent = 'OFF';
  takeToggle.append(takeCopy, takeValue);
  liveSection.append(takeToggle);

  const modeSection = section('РЕЖИМ');
  const modeGrid = document.createElement('div'); modeGrid.className = 'promptcam-ai-setup-grid';
  const modeButtons = new Map();
  for (const [value, label] of MODES) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'promptcam-ai-option'; button.textContent = label;
    button.dataset.aiSetupMode = value;
    button.addEventListener('click', () => live.setMode?.(value));
    modeGrid.append(button); modeButtons.set(value, button);
  }
  modeSection.append(modeGrid);

  const rhythmSection = section('РИТМ AI');
  const rhythmGrid = document.createElement('div'); rhythmGrid.className = 'promptcam-ai-setup-grid';
  const rhythmButtons = new Map();
  for (const [value, label] of RHYTHMS) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'promptcam-ai-option'; button.textContent = label;
    button.dataset.aiSetupRhythm = value;
    button.addEventListener('click', () => live.setRhythm?.(value));
    rhythmGrid.append(button); rhythmButtons.set(value, button);
  }
  rhythmSection.append(rhythmGrid);

  const styleSection = section('СТИЛЬ ПОДАЧИ · ДЛЯ ГРУППЫ / КОУЧА');
  const styleGrid = document.createElement('div'); styleGrid.className = 'promptcam-ai-setup-grid';
  const styleButtons = new Map();
  for (const [value, label] of STYLES) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'promptcam-ai-option'; button.textContent = label;
    button.dataset.aiSetupStyle = value;
    button.addEventListener('click', () => window.PromptCamLiveAIStyles?.setStyle?.(value));
    styleGrid.append(button); styleButtons.set(value, button);
  }
  styleSection.append(styleGrid);

  const status = document.createElement('p');
  status.className = 'promptcam-ai-setup-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  card.append(status);

  function takeApi() {
    return window.PromptCamTakeDirector || null;
  }

  function sync() {
    const liveState = live.getStatus?.() || {};
    const take = takeApi();
    const takeEnabled = Boolean(take?.isEnabled?.());
    const enabled = Boolean(liveState.enabled);

    statePill.textContent = takeEnabled ? 'AI ДУБЛЬ' : enabled ? 'ON' : 'OFF';
    statePill.dataset.on = String(enabled || takeEnabled);
    liveToggle.setAttribute('aria-pressed', String(enabled));
    liveValue.textContent = enabled ? 'ON' : 'OFF';
    takeToggle.disabled = !take;
    takeToggle.setAttribute('aria-pressed', String(takeEnabled));
    takeValue.textContent = take ? (takeEnabled ? 'ON' : 'OFF') : '…';

    for (const [value, button] of modeButtons) {
      const selected = liveState.mode === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = takeEnabled;
    }
    for (const [value, button] of rhythmButtons) {
      const selected = liveState.rhythm === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = takeEnabled;
    }

    const style = window.PromptCamLiveAIStyles?.getStyle?.() || 'expert';
    const styleAvailable = !takeEnabled && (liveState.mode === 'crew' || liveState.mode === 'acting');
    for (const [value, button] of styleButtons) {
      button.classList.toggle('is-selected', style === value);
      button.setAttribute('aria-pressed', String(style === value));
      button.disabled = !styleAvailable;
    }

    if (takeEnabled) {
      status.textContent = 'AI Дубль управляет режимом и ритмом сам · Crew + Smart.';
      status.dataset.tone = 'success';
    } else if (enabled) {
      status.textContent = 'Настройки сохранены · AI продолжит работу после открытия камеры.';
      status.dataset.tone = 'success';
    } else {
      status.textContent = take ? 'Включи AI Live или AI Дубль до начала съёмки.' : 'AI Дубль загружается…';
      delete status.dataset.tone;
    }
  }

  liveToggle.addEventListener('click', async () => {
    const current = live.getStatus?.() || {};
    await live.setEnabled?.(!current.enabled);
    sync();
  });

  takeToggle.addEventListener('click', async () => {
    const take = takeApi();
    if (!take) return;
    await take.setEnabled?.(!take.isEnabled?.());
    sync();
  });

  window.addEventListener('promptcam:live-ai-state', sync);
  window.addEventListener('promptcam:creator-modules-ready', sync);
  window.addEventListener('promptcam:editor-tab', (event) => {
    if (event.detail?.tab === 'ai') sync();
  });

  const panel = window.PromptCamEditorTabs?.getPanel?.('ai');
  if (panel) panel.append(card);
  else document.querySelector('.editor-tab-panel[data-editor-panel="ai"]')?.append(card);

  sync();

  window.PromptCamAISetup = Object.freeze({ sync, getStatus: () => ({ live: live.getStatus?.() || {}, take: takeApi()?.getStatus?.() || null }) });
})();

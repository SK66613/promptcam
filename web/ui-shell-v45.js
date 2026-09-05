(() => {
  'use strict';

  const camera = document.getElementById('cameraView');
  const tg = window.Telegram?.WebApp;
  let sheetObserver = null;
  let cameraObserver = null;
  let decorateTimer = 0;
  let touchStartX = 0;
  let touchStartY = 0;

  document.documentElement.classList.add('promptcam-ui-v45');
  if (document.body) document.body.style.touchAction = 'auto';

  const ICONS = Object.freeze({
    bolt: '<path d="M13.2 2.5 5 13h6l-.8 8.5L19 10.2h-6l.2-7.7Z"/>',
    camera: '<path d="M4.5 7.5h3l1.5-2h6l1.5 2h3v11h-15Z"/><circle cx="12" cy="13" r="3.4"/>',
    star: '<path d="m12 3 2.7 5.5 6 .9-4.35 4.2 1.03 6-5.38-2.83L6.62 19.6l1.03-6L3.3 9.4l6-.9L12 3Z"/>',
    sparkle: '<path d="m12 3 1.1 3.2L16 7.3l-2.9 1.1L12 11.6l-1.1-3.2L8 7.3l2.9-1.1L12 3Z"/><path d="m18.3 13 .7 2 2 .7-2 .8-.7 2-.8-2-2-.8 2-.7.8-2Z"/>',
    clapper: '<path d="M4 8h16v11H4Z"/><path d="m5 4 14-2 1 4-14 2-1-4Z"/><path d="m8 3.6 2.4 3.2M13 2.9l2.4 3.2"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M8.5 14c1.1 1.5 2.2 2.2 3.5 2.2s2.4-.7 3.5-2.2"/>',
    bulb: '<path d="M9 18h6M9.8 21h4.4"/><path d="M8.7 15.2C7.6 14.2 7 12.8 7 11.2a5 5 0 0 1 10 0c0 1.6-.6 3-1.7 4-.7.7-1.1 1.3-1.1 2.1H9.8c0-.8-.4-1.4-1.1-2.1Z"/>',
    hook: '<path d="M17 4v9a5 5 0 0 1-10 0v-1"/><path d="m4 12 3 3 3-3"/>',
    users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.7-3.2 2.5-5 5.5-5s4.8 1.8 5.5 5"/><circle cx="17" cy="8" r="2.2"/><path d="M15.5 13.5c2.8-.4 4.6 1.2 5 4"/>',
    actor: '<circle cx="12" cy="8" r="3"/><path d="M6.5 20c.7-4.1 2.5-6 5.5-6s4.8 1.9 5.5 6"/><path d="m18.5 4 .6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/><path d="M8.5 10.5h4"/>',
    heart: '<path d="M20 8.8C20 14 12 19.5 12 19.5S4 14 4 8.8A4.3 4.3 0 0 1 12 6.6 4.3 4.3 0 0 1 20 8.8Z"/>',
    moon: '<path d="M19 15.3A8 8 0 0 1 8.7 5a7 7 0 1 0 10.3 10.3Z"/>',
    badge: '<path d="m12 3 2.2 2.2 3-.4.4 3L20 10l-1.7 2.5.7 3-3 .7-1.5 2.8-2.5-1.7L9.5 19 8 16.2l-3-.7.7-3L4 10l2.4-2.2.4-3 3 .4L12 3Z"/><path d="m9.5 11.8 1.6 1.6 3.6-3.7"/>'
  });

  function svgIcon(name, extraClass = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('pc-icon-v45');
    if (extraClass) svg.classList.add(extraClass);
    svg.innerHTML = ICONS[name] || ICONS.sparkle;
    return svg;
  }

  function centerActiveTab() {
    const tabs = document.querySelector('.editor-tabs');
    const active = tabs?.querySelector('.editor-tab.is-selected');
    if (!tabs || !active) return;
    const left = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
    tabs.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }

  function polishTabs() {
    const tabs = document.querySelector('.editor-tabs');
    if (!tabs || tabs.dataset.pcV45 === 'true') return;
    tabs.dataset.pcV45 = 'true';
    tabs.addEventListener('click', () => window.setTimeout(centerActiveTab, 0));
    window.setTimeout(centerActiveTab, 20);
  }

  function polishDock() {
    const dock = document.querySelector('.promptcam-editor-hub');
    if (!dock) return;
    const names = { tokens: 'bolt', camera: 'camera', tariff: 'star' };
    for (const button of dock.querySelectorAll('.promptcam-hub-button')) {
      const kind = button.dataset.hubAction || '';
      const icon = button.querySelector('.hub-icon');
      if (!icon || !names[kind]) continue;
      const count = kind === 'tokens' ? button.querySelector('.hub-token-count') : null;
      if (icon.dataset.pcV45 !== 'true') {
        icon.replaceChildren(svgIcon(names[kind], 'pc-icon-lg'));
        icon.dataset.pcV45 = 'true';
      }
      if (count && count.parentElement !== icon) icon.append(count);
    }
  }

  function ensureBackdrop() {
    const sheets = [...document.querySelectorAll('.promptcam-hub-sheet')];
    if (!sheets.length) return;
    let backdrop = document.querySelector('.promptcam-hub-backdrop-v45');
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'promptcam-hub-backdrop-v45';
      backdrop.hidden = true;
      backdrop.setAttribute('aria-label', 'Закрыть панель');
      backdrop.addEventListener('click', () => window.PromptCamEditorHub?.close?.());
      backdrop.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
      document.body.append(backdrop);
    }
    const sync = () => {
      const isOpen = sheets.some((sheet) => !sheet.hidden);
      backdrop.hidden = !isOpen;
      document.documentElement.classList.toggle('promptcam-hub-sheet-open', isOpen);
    };
    if (!sheetObserver) {
      sheetObserver = new MutationObserver(sync);
      sheets.forEach((sheet) => sheetObserver.observe(sheet, { attributes: true, attributeFilter: ['hidden'] }));
    }
    sync();
  }

  const MODES = Object.freeze({
    jokes: ['smile', 'Шутки'], director: ['clapper', 'Режиссёр'], ideas: ['bulb', 'Идеи'], hooks: ['hook', 'Хуки'],
    crew: ['users', 'Съёмочная группа'], acting: ['actor', 'Актёрский коуч'], critic: ['search', 'Критик'], flatterer: ['sparkle', 'Льстец']
  });
  const STYLES = Object.freeze({
    calm: ['moon', 'Спокойный'], energetic: ['bolt', 'Энергичный'], expert: ['badge', 'Эксперт'], friendly: ['heart', 'Дружелюбный']
  });

  function iconizeOption(button, meta) {
    if (!button || !meta || button.dataset.pcV45 === 'true') return;
    button.replaceChildren(svgIcon(meta[0], 'pc-icon-sm'), document.createTextNode(meta[1]));
    button.classList.add('pc-iconized-v45');
    button.dataset.pcV45 = 'true';
  }

  function polishAiSetup() {
    const panel = document.querySelector('.editor-tab-panel[data-editor-panel="ai"]');
    const card = panel?.querySelector('.promptcam-ai-setup-card');
    if (!panel || !card) return;
    panel.querySelectorAll(':scope > .editor-tab-placeholder').forEach((node) => node.remove());

    const title = card.querySelector('.promptcam-ai-setup-title');
    if (title && !title.querySelector('.pc-icon-v45')) {
      title.prepend(svgIcon('sparkle'));
      const strong = title.querySelector('strong');
      if (strong) strong.textContent = 'AI для съёмки';
    }

    for (const toggle of card.querySelectorAll('.promptcam-ai-setup-toggle')) {
      const copy = toggle.querySelector(':scope > span');
      const strong = copy?.querySelector('strong');
      if (!copy || !strong || copy.querySelector('.pc-icon-v45')) continue;
      copy.insertBefore(svgIcon(strong.textContent.includes('Дубль') ? 'clapper' : 'sparkle'), strong);
      if (strong.textContent.includes('Дубль')) strong.textContent = 'AI Дубль';
    }

    for (const button of card.querySelectorAll('[data-ai-setup-mode]')) iconizeOption(button, MODES[button.dataset.aiSetupMode]);
    for (const button of card.querySelectorAll('[data-ai-setup-style]')) iconizeOption(button, STYLES[button.dataset.aiSetupStyle]);
  }

  const takeArm = {
    bound: false,
    liveWasOnBeforeArm: false,
    wasRecording: Boolean(camera?.classList.contains('is-recording')),
    internal: false
  };

  function recording() {
    return Boolean(camera?.classList.contains('is-recording'));
  }

  async function internalLive(value) {
    const live = window.PromptCamLiveAI;
    if (!live) return;
    takeArm.internal = true;
    try { await live.setEnabled?.(value); }
    finally { takeArm.internal = false; }
  }

  function bindTakeArmBehavior() {
    if (takeArm.bound) return;
    const take = window.PromptCamTakeDirector;
    const live = window.PromptCamLiveAI;
    const setup = document.querySelector('.promptcam-ai-setup-card');
    if (!take || !live || !setup) return;
    const toggle = [...setup.querySelectorAll('.promptcam-ai-setup-toggle')]
      .find((node) => node.querySelector('strong')?.textContent?.includes('AI Дубль'));
    if (!toggle) return;

    takeArm.bound = true;
    toggle.addEventListener('click', () => {
      if (!take.isEnabled?.()) takeArm.liveWasOnBeforeArm = Boolean(live.getStatus?.().enabled);
    }, true);
    toggle.addEventListener('click', () => {
      window.setTimeout(async () => {
        if (take.isEnabled?.() && !takeArm.liveWasOnBeforeArm && !recording()) {
          if (live.getStatus?.().enabled) await internalLive(false);
          window.PromptCamAISetup?.sync?.();
        }
      }, 35);
    });

    if (camera && !cameraObserver) {
      cameraObserver = new MutationObserver(async () => {
        const nowRecording = recording();
        if (nowRecording === takeArm.wasRecording) return;
        takeArm.wasRecording = nowRecording;
        if (!take.isEnabled?.()) return;
        if (nowRecording) {
          if (!live.getStatus?.().enabled) await internalLive(true);
          live.setMode?.('crew');
          live.setRhythm?.('smart');
          window.setTimeout(() => window.PromptCamSpeechContext?.start?.(), 90);
        } else if (!takeArm.liveWasOnBeforeArm && live.getStatus?.().enabled) {
          await internalLive(false);
        }
        window.PromptCamAISetup?.sync?.();
      });
      cameraObserver.observe(camera, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function guardHorizontalPagePan() {
    if (document.documentElement.dataset.pcHorizontalGuard === 'true') return;
    document.documentElement.dataset.pcHorizontalGuard = 'true';
    document.addEventListener('touchstart', (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { capture: true, passive: true });
    document.addEventListener('touchmove', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.editor-tabs,.promptcam-swipe-shell,input[type="range"]')) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (Math.abs(dx) > Math.abs(dy) + 5 && Math.abs(dx) > 9) event.preventDefault();
    }, { capture: true, passive: false });
  }

  function schedule() {
    if (decorateTimer) return;
    decorateTimer = window.setTimeout(() => {
      decorateTimer = 0;
      polishTabs();
      polishDock();
      ensureBackdrop();
      polishAiSetup();
      bindTakeArmBehavior();
    }, 0);
  }

  window.addEventListener('promptcam:editor-tab', () => {
    schedule();
    window.setTimeout(centerActiveTab, 20);
  });
  window.addEventListener('promptcam:editor-hub-ready', schedule);
  window.addEventListener('promptcam:creator-modules-ready', schedule);
  window.addEventListener('promptcam:ai-wallet', schedule);
  window.addEventListener('promptcam:live-ai-state', () => window.setTimeout(() => window.PromptCamAISetup?.sync?.(), 0));
  window.addEventListener('pagehide', () => {
    sheetObserver?.disconnect();
    cameraObserver?.disconnect();
  }, { once: true });

  guardHorizontalPagePan();
  schedule();
  window.setTimeout(schedule, 250);
  window.setTimeout(schedule, 1000);

  window.PromptCamUIShellV45 = Object.freeze({ refresh: schedule, centerActiveTab });
})();

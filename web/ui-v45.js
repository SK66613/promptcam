(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const scriptInput = document.getElementById('scriptInput');
  const editor = document.getElementById('editorView');
  const camera = document.getElementById('cameraView');
  const explanationCache = new Map();
  let libraryObserver = null;
  let sheetObserver = null;
  let cameraObserver = null;
  let decorateTimer = 0;
  let touchStartX = 0;
  let touchStartY = 0;

  document.documentElement.classList.add('promptcam-ui-v45');

  const ICONS = Object.freeze({
    bolt: '<path d="M13.2 2.5 5 13h6l-.8 8.5L19 10.2h-6l.2-7.7Z"/>',
    camera: '<path d="M4.5 7.5h3l1.5-2h6l1.5 2h3v11h-15Z"/><circle cx="12" cy="13" r="3.4"/>',
    star: '<path d="m12 3 2.7 5.5 6 .9-4.35 4.2 1.03 6-5.38-2.83L6.62 19.6l1.03-6L3.3 9.4l6-.9L12 3Z"/>',
    sparkle: '<path d="m12 3 1.1 3.2L16 7.3l-2.9 1.1L12 11.6l-1.1-3.2L8 7.3l2.9-1.1L12 3Z"/><path d="m18.3 13 .7 2 2 .7-2 .8-.7 2-.8-2-2-.8 2-.7.8-2Z"/><path d="m5.7 13.5.9 2.5 2.4.9-2.4.9-.9 2.5-.9-2.5-2.4-.9 2.4-.9.9-2.5Z"/>',
    clapper: '<path d="M4 8h16v11H4Z"/><path d="m5 4 14-2 1 4-14 2-1-4Z"/><path d="m8 3.6 2.4 3.2M13 2.9l2.4 3.2"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M8.5 14c1.1 1.5 2.2 2.2 3.5 2.2s2.4-.7 3.5-2.2"/>',
    bulb: '<path d="M9 18h6M9.8 21h4.4"/><path d="M8.7 15.2C7.6 14.2 7 12.8 7 11.2a5 5 0 0 1 10 0c0 1.6-.6 3-1.7 4-.7.7-1.1 1.3-1.1 2.1H9.8c0-.8-.4-1.4-1.1-2.1Z"/>',
    hook: '<path d="M17 4v9a5 5 0 0 1-10 0v-1"/><path d="m4 12 3 3 3-3"/>',
    users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.7-3.2 2.5-5 5.5-5s4.8 1.8 5.5 5"/><circle cx="17" cy="8" r="2.2"/><path d="M15.5 13.5c2.8-.4 4.6 1.2 5 4"/>',
    actor: '<circle cx="12" cy="8" r="3"/><path d="M6.5 20c.7-4.1 2.5-6 5.5-6s4.8 1.9 5.5 6"/><path d="m18.5 4 .6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/><path d="M8.5 10.5h4"/>',
    heart: '<path d="M20 8.8C20 14 12 19.5 12 19.5S4 14 4 8.8A4.3 4.3 0 0 1 12 6.6 4.3 4.3 0 0 1 20 8.8Z"/>',
    moon: '<path d="M19 15.3A8 8 0 0 1 8.7 5a7 7 0 1 0 10.3 10.3Z"/>',
    badge: '<path d="m12 3 2.2 2.2 3-.4.4 3L20 10l-1.7 2.5.7 3-3 .7-1.5 2.8-2.5-1.7L9.5 19 8 16.2l-3-.7.7-3L4 10l2.4-2.2.4-3 3 .4L12 3Z"/><path d="m9.5 11.8 1.6 1.6 3.6-3.7"/>',
    folder: '<path d="M3.5 7h6l1.6 2h9.4v9.5h-17Z"/><path d="M3.5 7V5h6l1.6 2"/>',
    save: '<path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h7V4M8 20v-6h8v6"/>',
    apply: '<path d="M5 4h10l4 4v12H5Z"/><path d="M15 4v4h4M8 14l2.2 2.2L16 10.5"/>',
    explain: '<path d="M5 5.5h14v11H9l-4 3v-14Z"/><path d="M9 9h6M9 12.5h4"/><path d="m18.5 2 .5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z"/>'
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

  function setIconLabel(button, iconName, label) {
    if (!button) return;
    button.replaceChildren(svgIcon(iconName, 'pc-icon-sm'), document.createTextNode(label));
    button.classList.add('pc-iconized-v45');
  }

  function centerActiveTab() {
    const tabs = document.querySelector('.editor-tabs');
    const active = tabs?.querySelector('.editor-tab.is-selected');
    if (!tabs || !active) return;
    const target = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
    tabs.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
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
    const iconNames = { tokens: 'bolt', camera: 'camera', tariff: 'star' };
    for (const button of dock.querySelectorAll('.promptcam-hub-button')) {
      const kind = button.dataset.hubAction || '';
      const icon = button.querySelector('.hub-icon');
      if (!icon || !iconNames[kind]) continue;
      let count = kind === 'tokens' ? button.querySelector('.hub-token-count') : null;
      if (icon.dataset.pcV45 !== 'true') {
        icon.replaceChildren(svgIcon(iconNames[kind], 'pc-icon-lg'));
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
      const open = sheets.some((sheet) => !sheet.hidden);
      backdrop.hidden = !open;
      document.documentElement.classList.toggle('promptcam-hub-sheet-open', open);
    };
    if (!sheetObserver) {
      sheetObserver = new MutationObserver(sync);
      sheets.forEach((sheet) => sheetObserver.observe(sheet, { attributes: true, attributeFilter: ['hidden'] }));
    }
    sync();
  }

  const MODE_META = Object.freeze({
    jokes: ['smile', 'Шутки'],
    director: ['clapper', 'Режиссёр'],
    ideas: ['bulb', 'Идеи'],
    hooks: ['hook', 'Хуки'],
    crew: ['users', 'Съёмочная группа'],
    acting: ['actor', 'Актёрский коуч'],
    critic: ['search', 'Критик'],
    flatterer: ['sparkle', 'Льстец']
  });
  const STYLE_META = Object.freeze({
    calm: ['moon', 'Спокойный'],
    energetic: ['bolt', 'Энергичный'],
    expert: ['badge', 'Эксперт'],
    friendly: ['heart', 'Дружелюбный']
  });

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

    const toggles = [...card.querySelectorAll('.promptcam-ai-setup-toggle')];
    for (const toggle of toggles) {
      const copy = toggle.querySelector(':scope > span');
      const strong = copy?.querySelector('strong');
      if (!copy || !strong || copy.querySelector('.pc-icon-v45')) continue;
      copy.insertBefore(svgIcon(strong.textContent.includes('Дубль') ? 'clapper' : 'sparkle'), strong);
      if (strong.textContent.includes('Дубль')) strong.textContent = 'AI Дубль';
    }

    for (const button of card.querySelectorAll('[data-ai-setup-mode]')) {
      if (button.dataset.pcV45 === 'true') continue;
      const meta = MODE_META[button.dataset.aiSetupMode];
      if (!meta) continue;
      button.replaceChildren(svgIcon(meta[0], 'pc-icon-sm'), document.createTextNode(meta[1]));
      button.classList.add('pc-iconized-v45');
      button.dataset.pcV45 = 'true';
    }
    for (const button of card.querySelectorAll('[data-ai-setup-style]')) {
      if (button.dataset.pcV45 === 'true') continue;
      const meta = STYLE_META[button.dataset.aiSetupStyle];
      if (!meta) continue;
      button.replaceChildren(svgIcon(meta[0], 'pc-icon-sm'), document.createTextNode(meta[1]));
      button.classList.add('pc-iconized-v45');
      button.dataset.pcV45 = 'true';
    }
  }

  function polishWalletCopy() {
    const cost = document.querySelector('.ai-wallet-costs');
    if (!cost) return;
    const next = cost.textContent
      .replace('Встроить с AI', 'AI-пояснение')
      .replace('Встроить в сценарий', 'AI-пояснение');
    if (next !== cost.textContent) cost.textContent = next;
    const icon = document.querySelector('.ai-wallet-icon');
    if (icon && !icon.querySelector('.pc-icon-v45')) {
      icon.replaceChildren(svgIcon('bolt'));
      icon.style.fontSize = '0';
    }
  }

  function libraryItemKey(item) {
    const script = String(scriptInput?.value || '');
    let hash = 2166136261;
    for (let index = 0; index < script.length; index += Math.max(1, Math.floor(script.length / 160))) {
      hash ^= script.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${Number(item?.id || 0)}:${script.length}:${hash >>> 0}`;
  }

  function explanationBlock(row) {
    let block = row.querySelector('.creator-explanation-v45');
    if (block) return block;
    block = document.createElement('div');
    block.className = 'creator-explanation-v45';
    block.hidden = true;
    const actions = row.querySelector('.creator-row-actions');
    if (actions) row.insertBefore(block, actions);
    else row.append(block);
    return block;
  }

  function renderExplanation(block, data) {
    block.replaceChildren();
    delete block.dataset.tone;
    const head = document.createElement('div');
    head.className = 'creator-explanation-head-v45';
    head.append(svgIcon('explain', 'pc-icon-sm'), document.createTextNode('AI-пояснение'));
    block.append(head);

    const lines = [
      ['Когда:', data.moment || 'В подходящем месте сценария.'],
      ['Как:', data.how || 'Примени подсказку как конкретное действие в кадре.']
    ];
    if (data.why) lines.push(['Зачем:', data.why]);
    for (const [label, value] of lines) {
      const p = document.createElement('p');
      const b = document.createElement('b');
      b.textContent = `${label} `;
      p.append(b, document.createTextNode(value));
      block.append(p);
    }
    block.hidden = false;
  }

  function renderExplanationMessage(block, message, tone = '') {
    block.replaceChildren();
    if (tone) block.dataset.tone = tone;
    else delete block.dataset.tone;
    const head = document.createElement('div');
    head.className = 'creator-explanation-head-v45';
    head.append(svgIcon('explain', 'pc-icon-sm'), document.createTextNode('AI-пояснение'));
    const p = document.createElement('p');
    p.textContent = message;
    block.append(head, p);
    block.hidden = false;
  }

  async function explainFavorite(item, button, block) {
    const script = String(scriptInput?.value || '').trim();
    if (!script) {
      renderExplanationMessage(block, 'Сначала добавь сценарий — тогда AI сможет привязать совет к конкретному моменту.', 'error');
      return;
    }
    if (!initData) {
      renderExplanationMessage(block, 'AI-пояснение доступно внутри Telegram Mini App.', 'error');
      return;
    }

    const key = libraryItemKey(item);
    const cached = explanationCache.get(key);
    if (cached) {
      if (!block.hidden && block.dataset.cacheKey === key) {
        block.hidden = true;
        return;
      }
      block.dataset.cacheKey = key;
      renderExplanation(block, cached);
      return;
    }

    button.disabled = true;
    block.dataset.cacheKey = key;
    renderExplanationMessage(block, 'Смотрю сценарий и привязываю совет к нужному моменту…');
    try {
      const response = await fetch('/api/ai/favorite-insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'explain',
          initData,
          script,
          favorite: item.text || '',
          detail: item.detail || '',
          source: item.source || 'live',
          kind: item.kind || ''
        }),
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        const error = new Error(data?.error || 'favorite_explain_failed');
        error.status = response.status;
        error.retryAfter = Number(data?.retryAfter || response.headers.get('Retry-After') || 0);
        throw error;
      }
      const result = { moment: data.moment || '', how: data.how || '', why: data.why || '' };
      explanationCache.set(key, result);
      renderExplanation(block, result);
      await window.PromptCamAIWallet?.refresh?.({ silent: true });
      tg?.HapticFeedback?.impactOccurred?.('light');
    } catch (error) {
      if (error?.status === 402) {
        renderExplanationMessage(block, 'AI-токены закончились. Открой «Токены» в нижнем меню и пополни баланс.', 'error');
      } else if (error?.status === 429) {
        renderExplanationMessage(block, `Слишком много запросов подряд. Попробуй через ${Math.max(2, error.retryAfter || 8)} с.`, 'error');
      } else if (error?.status === 401) {
        renderExplanationMessage(block, 'Telegram-сессия устарела. Переоткрой PromptCam.', 'error');
      } else {
        renderExplanationMessage(block, 'Не получилось подготовить пояснение. Попробуй ещё раз.', 'error');
      }
    } finally {
      button.disabled = false;
    }
  }

  function polishLibrary() {
    const card = document.querySelector('.creator-library-card');
    if (!card) return;

    const libraryIcon = card.querySelector('.creator-library-icon');
    if (libraryIcon && !libraryIcon.querySelector('.pc-icon-v45')) libraryIcon.replaceChildren(svgIcon('folder'));

    const save = card.querySelector('.creator-library-save');
    if (save && save.dataset.pcV45 !== 'true') {
      setIconLabel(save, 'save', 'Сохранить текущий');
      save.dataset.pcV45 = 'true';
    }

    const hint = card.querySelector('.creator-favorite-list')?.closest('.creator-library-pane')?.querySelector('.creator-library-toolbar-personal small');
    if (hint) hint.textContent = 'Нажми «Пояснить» — AI покажет, к какому моменту текущего сценария относится совет и как его применить.';

    const oldPreview = card.querySelector('.creator-smart-preview');
    if (oldPreview) oldPreview.hidden = true;

    const templates = window.PromptCamCreatorLibrary?.getTemplates?.() || [];
    const templateRows = [...card.querySelectorAll('.creator-template-row-personal')];
    templateRows.forEach((row, index) => {
      const item = templates[index];
      if (item?.id) row.dataset.pcItemId = String(item.id);
      const actions = row.querySelector('.creator-row-actions');
      if (!actions) return;
      actions.style.removeProperty('display');
      const primary = actions.querySelector('button.primary');
      if (primary && primary.dataset.pcV45 !== 'true') {
        setIconLabel(primary, 'apply', 'Применить');
        primary.classList.add('creator-template-apply-v45');
        primary.dataset.pcV45 = 'true';
        primary.setAttribute('aria-label', 'Применить шаблон');
      }
    });

    const favorites = window.PromptCamCreatorLibrary?.getFavorites?.() || [];
    const favoriteRows = [...card.querySelectorAll('.creator-favorite-row-personal')];
    favoriteRows.forEach((row, index) => {
      const item = favorites[index];
      if (!item?.id) return;
      row.dataset.pcItemId = String(item.id);
      const actions = row.querySelector('.creator-row-actions');
      if (!actions) return;
      actions.style.removeProperty('display');

      for (const button of [...actions.querySelectorAll('button')]) {
        const text = String(button.textContent || '').toLowerCase();
        if (text.includes('встроить')) button.remove();
      }
      row.dataset.scriptInsert = 'false';
      actions.classList.remove('is-production-only');

      let explain = actions.querySelector('.creator-explain-v45');
      const block = explanationBlock(row);
      if (!explain) {
        explain = document.createElement('button');
        explain.type = 'button';
        explain.className = 'creator-explain-v45';
        explain.append(svgIcon('explain', 'pc-icon-sm'), document.createTextNode('Пояснить'));
        explain.setAttribute('aria-label', 'AI-пояснение к подсказке');
        explain.addEventListener('click', () => explainFavorite(item, explain, block));
        actions.append(explain);
      }
      const cached = explanationCache.get(libraryItemKey(item));
      if (cached && block.hidden) renderExplanation(block, cached);
    });
  }

  function bindLibraryObserver() {
    const card = document.querySelector('.creator-library-card');
    if (!card || card.dataset.pcV45Observed === 'true') return;
    card.dataset.pcV45Observed = 'true';
    libraryObserver?.disconnect();
    libraryObserver = new MutationObserver(scheduleDecorate);
    libraryObserver.observe(card, { childList: true, subtree: true });
  }

  const takeArm = {
    bound: false,
    liveWasOnBeforeArm: false,
    wasRecording: Boolean(camera?.classList.contains('is-recording')),
    internalLiveChange: false
  };

  function recording() {
    return Boolean(camera?.classList.contains('is-recording'));
  }

  async function setInternalLive(value) {
    const live = window.PromptCamLiveAI;
    if (!live) return;
    takeArm.internalLiveChange = true;
    try { await live.setEnabled?.(value); }
    finally { takeArm.internalLiveChange = false; }
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
          if (live.getStatus?.().enabled) await setInternalLive(false);
          window.PromptCamAISetup?.sync?.();
        }
      }, 30);
    });

    if (camera && !cameraObserver) {
      cameraObserver = new MutationObserver(async () => {
        const nowRecording = recording();
        if (nowRecording === takeArm.wasRecording) return;
        takeArm.wasRecording = nowRecording;
        if (!take.isEnabled?.()) return;

        if (nowRecording) {
          if (!live.getStatus?.().enabled) await setInternalLive(true);
          live.setMode?.('crew');
          live.setRhythm?.('smart');
          window.setTimeout(() => window.PromptCamSpeechContext?.start?.(), 90);
        } else if (!takeArm.liveWasOnBeforeArm && live.getStatus?.().enabled) {
          await setInternalLive(false);
        }
        window.PromptCamAISetup?.sync?.();
      });
      cameraObserver.observe(camera, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function preventHorizontalRubberBand() {
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

  function scheduleDecorate() {
    if (decorateTimer) return;
    decorateTimer = window.setTimeout(() => {
      decorateTimer = 0;
      polishTabs();
      polishDock();
      ensureBackdrop();
      polishAiSetup();
      polishWalletCopy();
      polishLibrary();
      bindLibraryObserver();
      bindTakeArmBehavior();
    }, 0);
  }

  window.addEventListener('promptcam:editor-tab', (event) => {
    scheduleDecorate();
    window.setTimeout(centerActiveTab, event.detail?.tab ? 20 : 0);
  });
  window.addEventListener('promptcam:editor-hub-ready', scheduleDecorate);
  window.addEventListener('promptcam:creator-modules-ready', scheduleDecorate);
  window.addEventListener('promptcam:creator-library-ready', scheduleDecorate);
  window.addEventListener('promptcam:ai-wallet', scheduleDecorate);
  window.addEventListener('promptcam:live-ai-state', () => window.setTimeout(() => window.PromptCamAISetup?.sync?.(), 0));

  scriptInput?.addEventListener('input', () => {
    explanationCache.clear();
    document.querySelectorAll('.creator-explanation-v45').forEach((block) => {
      block.hidden = true;
      block.replaceChildren();
      delete block.dataset.cacheKey;
    });
  });

  window.addEventListener('pagehide', () => {
    libraryObserver?.disconnect();
    sheetObserver?.disconnect();
    cameraObserver?.disconnect();
  }, { once: true });

  preventHorizontalRubberBand();
  scheduleDecorate();
  window.setTimeout(scheduleDecorate, 250);
  window.setTimeout(scheduleDecorate, 1000);

  window.PromptCamUIV45 = Object.freeze({
    refresh: scheduleDecorate,
    getStatus: () => ({
      library: Boolean(document.querySelector('.creator-library-card')),
      dock: Boolean(document.querySelector('.promptcam-editor-hub')),
      aiSetup: Boolean(document.querySelector('.promptcam-ai-setup-card')),
      takeArmed: Boolean(window.PromptCamTakeDirector?.isEnabled?.())
    })
  });
})();

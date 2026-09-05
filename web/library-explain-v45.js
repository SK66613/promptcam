(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const scriptInput = document.getElementById('scriptInput');
  const explanationCache = new Map();
  let observer = null;
  let timer = 0;

  const ICONS = Object.freeze({
    folder: '<path d="M3.5 7h6l1.6 2h9.4v9.5h-17Z"/><path d="M3.5 7V5h6l1.6 2"/>',
    save: '<path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h7V4M8 20v-6h8v6"/>',
    apply: '<path d="M5 4h10l4 4v12H5Z"/><path d="M15 4v4h4M8 14l2.2 2.2L16 10.5"/>',
    explain: '<path d="M5 5.5h14v11H9l-4 3v-14Z"/><path d="M9 9h6M9 12.5h4"/><path d="m18.5 2 .5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z"/>'
  });

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('pc-icon-v45', 'pc-icon-sm');
    svg.innerHTML = ICONS[name] || ICONS.explain;
    return svg;
  }

  function setIconLabel(button, name, label) {
    button.replaceChildren(icon(name), document.createTextNode(label));
    button.classList.add('pc-iconized-v45');
  }

  function fingerprint() {
    const script = String(scriptInput?.value || '');
    let hash = 2166136261;
    const step = Math.max(1, Math.floor(script.length / 160));
    for (let i = 0; i < script.length; i += step) {
      hash ^= script.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${script.length}:${hash >>> 0}`;
  }

  function cacheKey(item) {
    return `${Number(item?.id || 0)}:${fingerprint()}`;
  }

  function makeBlock(row) {
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

  function renderHead(block) {
    const head = document.createElement('div');
    head.className = 'creator-explanation-head-v45';
    head.append(icon('explain'), document.createTextNode('AI-пояснение'));
    block.append(head);
  }

  function renderMessage(block, message, tone = '') {
    block.replaceChildren();
    if (tone) block.dataset.tone = tone;
    else delete block.dataset.tone;
    renderHead(block);
    const p = document.createElement('p');
    p.textContent = message;
    block.append(p);
    block.hidden = false;
  }

  function renderExplanation(block, data) {
    block.replaceChildren();
    delete block.dataset.tone;
    renderHead(block);
    const lines = [
      ['Когда:', data.moment || 'В подходящем месте сценария.'],
      ['Как:', data.how || 'Примени совет как конкретное действие в кадре.']
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

  async function explain(item, button, block) {
    const script = String(scriptInput?.value || '').trim();
    if (!script) {
      renderMessage(block, 'Сначала добавь сценарий — тогда AI сможет привязать совет к конкретному моменту.', 'error');
      return;
    }
    if (!initData) {
      renderMessage(block, 'AI-пояснение доступно внутри Telegram Mini App.', 'error');
      return;
    }

    const key = cacheKey(item);
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
    renderMessage(block, 'Смотрю сценарий и привязываю совет к нужному моменту…');
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
        renderMessage(block, 'AI-токены закончились. Открой «Токены» в нижнем меню и пополни баланс.', 'error');
      } else if (error?.status === 429) {
        renderMessage(block, `Слишком много запросов подряд. Попробуй через ${Math.max(2, error.retryAfter || 8)} с.`, 'error');
      } else if (error?.status === 401) {
        renderMessage(block, 'Telegram-сессия устарела. Переоткрой PromptCam.', 'error');
      } else {
        renderMessage(block, 'Не получилось подготовить пояснение. Попробуй ещё раз.', 'error');
      }
    } finally {
      button.disabled = false;
    }
  }

  function polishWalletCopy() {
    const cost = document.querySelector('.ai-wallet-costs');
    if (!cost) return;
    const current = cost.textContent;
    const next = current.replace('Встроить с AI', 'AI-пояснение').replace('Встроить в сценарий', 'AI-пояснение');
    if (next !== current) cost.textContent = next;
  }

  function decorate() {
    timer = 0;
    const card = document.querySelector('.creator-library-card');
    const library = window.PromptCamCreatorLibrary;
    if (!card || !library) return;

    const libIcon = card.querySelector('.creator-library-icon');
    if (libIcon && !libIcon.querySelector('.pc-icon-v45')) libIcon.replaceChildren(icon('folder'));

    const save = card.querySelector('.creator-library-save');
    if (save && save.dataset.pcV45 !== 'true') {
      setIconLabel(save, 'save', 'Сохранить текущий');
      save.dataset.pcV45 = 'true';
    }

    const favoritesPane = card.querySelector('.creator-favorite-list')?.closest('.creator-library-pane');
    const hint = favoritesPane?.querySelector('.creator-library-toolbar-personal small');
    const hintText = 'Нажми «Пояснить» — AI покажет, к какому моменту текущего сценария относится совет и как его применить.';
    if (hint && hint.textContent !== hintText) hint.textContent = hintText;

    const oldPreview = card.querySelector('.creator-smart-preview');
    if (oldPreview && !oldPreview.hidden) oldPreview.hidden = true;

    const templates = library.getTemplates?.() || [];
    [...card.querySelectorAll('.creator-template-row-personal')].forEach((row, index) => {
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

    const favorites = library.getFavorites?.() || [];
    [...card.querySelectorAll('.creator-favorite-row-personal')].forEach((row, index) => {
      const item = favorites[index];
      if (!item?.id) return;
      row.dataset.pcItemId = String(item.id);
      const actions = row.querySelector('.creator-row-actions');
      if (!actions) return;
      actions.style.removeProperty('display');

      for (const button of [...actions.querySelectorAll('button')]) {
        if (String(button.textContent || '').toLowerCase().includes('встроить')) button.remove();
      }
      row.dataset.scriptInsert = 'false';
      actions.classList.remove('is-production-only');

      const block = makeBlock(row);
      let explainButton = actions.querySelector('.creator-explain-v45');
      if (!explainButton) {
        explainButton = document.createElement('button');
        explainButton.type = 'button';
        explainButton.className = 'creator-explain-v45';
        explainButton.append(icon('explain'), document.createTextNode('Пояснить'));
        explainButton.setAttribute('aria-label', 'AI-пояснение к подсказке');
        explainButton.addEventListener('click', () => explain(item, explainButton, block));
        actions.append(explainButton);
      }

      const cached = explanationCache.get(cacheKey(item));
      if (cached && block.hidden) renderExplanation(block, cached);
    });

    polishWalletCopy();
    bindObserver();
  }

  function schedule() {
    if (timer) return;
    timer = window.setTimeout(decorate, 0);
  }

  function bindObserver() {
    const card = document.querySelector('.creator-library-card');
    if (!card || card.dataset.pcExplainObserved === 'true') return;
    card.dataset.pcExplainObserved = 'true';
    observer?.disconnect();
    observer = new MutationObserver(schedule);
    observer.observe(card, { childList: true, subtree: true });
  }

  scriptInput?.addEventListener('input', () => {
    explanationCache.clear();
    document.querySelectorAll('.creator-explanation-v45').forEach((block) => {
      if (!block.hidden) block.hidden = true;
      if (block.childNodes.length) block.replaceChildren();
      delete block.dataset.cacheKey;
    });
  });

  window.addEventListener('promptcam:creator-library-ready', schedule);
  window.addEventListener('promptcam:creator-modules-ready', schedule);
  window.addEventListener('promptcam:ai-wallet', () => {
    polishWalletCopy();
    schedule();
  });
  window.addEventListener('pagehide', () => observer?.disconnect(), { once: true });

  schedule();
  window.setTimeout(schedule, 300);
  window.setTimeout(schedule, 1100);

  window.PromptCamLibraryExplainV45 = Object.freeze({ refresh: schedule });
})();

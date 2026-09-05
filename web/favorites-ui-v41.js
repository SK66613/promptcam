(() => {
  'use strict';

  const PRODUCTION_KINDS = [
    'оператор', 'свет', 'актёрский коуч', 'актерский коуч', 'acting coach',
    'критик', 'льстец', 'ai дубль', 'take director', 'шутка', 'joke'
  ];
  const PRODUCTION_HINTS = [
    'камера', 'камеру', 'кадр', 'кадре', 'объектив', 'свет', 'окно', 'экспозиц',
    'повернись', 'поверни голову', 'взгляд', 'смотри в объектив', 'плеч', 'поза',
    'жест', 'руки', 'наклони', 'отодвинься', 'приблизься', 'смести', 'подними', 'опусти'
  ];
  const watchedNodes = new WeakSet();
  let libraryObserver = null;
  let cameraObserver = null;
  let rowTimer = 0;
  let heartTimer = 0;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function ensureStyles() {
    if (document.querySelector('link[data-promptcam-ui-v41]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/ui-polish-v41.css?v=41';
    link.dataset.promptcamUiV41 = 'true';
    document.head.append(link);
  }

  function favoriteKey(item) {
    return [item?.source || '', item?.mode || '', item?.kind || '', item?.text || '', item?.detail || ''].join('\u241f');
  }

  function favorites() {
    try {
      return window.PromptCamCreatorLibrary?.getFavorites?.() || [];
    } catch (_) {
      return [];
    }
  }

  function isSaved(draft) {
    if (!draft?.text) return false;
    const key = favoriteKey(draft);
    return favorites().some((item) => favoriteKey(item) === key);
  }

  function liveDraft() {
    const card = document.getElementById('liveAiSuggestion');
    return {
      source: 'live',
      mode: window.PromptCamLiveAI?.getStatus?.().mode || '',
      kind: card?.querySelector('.live-ai-suggestion-type')?.textContent?.trim() || '✨ AI Live',
      text: card?.querySelector('.live-ai-suggestion-text')?.textContent?.trim() || '',
      detail: ''
    };
  }

  function takeDraft() {
    const card = document.querySelector('.take-director-card');
    return {
      source: 'take',
      mode: 'take',
      kind: card?.querySelector('.take-director-card-title')?.textContent?.trim() || '🎬 AI Дубль',
      text: card?.querySelector('.take-director-card-text')?.textContent?.trim() || '',
      detail: card?.querySelector('.take-director-card-anchor')?.textContent?.trim() || ''
    };
  }

  function setHeart(button, draft) {
    if (!button) return;
    const saved = isSaved(draft);
    const symbol = saved ? '♥' : '♡';
    const label = saved ? 'Убрать AI-подсказку из избранного' : 'Добавить AI-подсказку в избранное';
    if (button.textContent !== symbol) button.textContent = symbol;
    if (button.classList.contains('is-saved') !== saved) button.classList.toggle('is-saved', saved);
    if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
  }

  function syncRecommendationHearts() {
    setHeart(document.querySelector('#liveAiSuggestion .creator-favorite-heart'), liveDraft());
    setHeart(document.querySelector('.take-director-card .creator-favorite-heart'), takeDraft());
  }

  function scheduleHeartSync() {
    if (heartTimer) return;
    heartTimer = window.setTimeout(() => {
      heartTimer = 0;
      attachRecommendationWatchers();
      syncRecommendationHearts();
    }, 0);
  }

  function watchText(node) {
    if (!node || watchedNodes.has(node)) return;
    watchedNodes.add(node);
    const observer = new MutationObserver(scheduleHeartSync);
    observer.observe(node, { childList: true, characterData: true, subtree: true });
  }

  function attachRecommendationWatchers() {
    const liveCard = document.getElementById('liveAiSuggestion');
    watchText(liveCard?.querySelector('.live-ai-suggestion-type'));
    watchText(liveCard?.querySelector('.live-ai-suggestion-text'));
    const takeCard = document.querySelector('.take-director-card');
    watchText(takeCard?.querySelector('.take-director-card-title'));
    watchText(takeCard?.querySelector('.take-director-card-text'));
    watchText(takeCard?.querySelector('.take-director-card-anchor'));
  }

  function productionOnly(row) {
    const kind = normalize(row.querySelector('.creator-favorite-row-head strong')?.textContent);
    const text = normalize(row.querySelector('.creator-favorite-text')?.textContent);
    const detail = normalize(row.querySelector('.creator-favorite-detail')?.textContent);
    if (PRODUCTION_KINDS.some((term) => kind.includes(term))) return true;
    if (kind.includes('режисс')) {
      const combined = `${text} ${detail}`;
      return PRODUCTION_HINTS.some((term) => combined.includes(term));
    }
    return false;
  }

  function patchFavoriteRows() {
    const rows = document.querySelectorAll('.creator-favorite-row-personal');
    for (const row of rows) {
      const actions = row.querySelector('.creator-row-actions');
      if (!actions) continue;

      let integrate = [...actions.querySelectorAll('button')].find((button) => {
        const value = normalize(button.textContent);
        return value.includes('встроить с ai') || value.includes('встроить в сценарий');
      });
      const remove = [...actions.querySelectorAll('button')].find((button) => {
        const value = normalize(button.textContent);
        return button.classList.contains('creator-unlike-button') || value.includes('убрать');
      });

      if (integrate && productionOnly(row)) {
        integrate.remove();
        integrate = null;
      } else if (integrate && integrate.textContent !== '✨ Встроить в сценарий') {
        integrate.textContent = '✨ Встроить в сценарий';
        integrate.setAttribute('aria-label', 'Встроить подсказку в сценарий с помощью AI');
      }

      actions.style.removeProperty('grid-template-columns');
      actions.classList.toggle('is-production-only', !integrate);
      row.dataset.scriptInsert = integrate ? 'true' : 'false';

      if (remove) {
        remove.style.removeProperty('width');
        remove.classList.add('creator-unlike-button');
        remove.classList.remove('danger');
        if (remove.textContent !== '♥') remove.textContent = '♥';
        remove.setAttribute('aria-label', 'Убрать из избранного');
        remove.setAttribute('title', 'Убрать из избранного');
      }
    }
  }

  function patchLibraryCopy() {
    const favoriteList = document.querySelector('.creator-favorite-list');
    const pane = favoriteList?.closest('.creator-library-pane');
    const hint = pane?.querySelector('.creator-library-toolbar-personal small');
    if (hint && hint.textContent !== 'В сценарий можно встроить только реплики и идеи. Съёмочные заметки остаются просто в избранном.') {
      hint.textContent = 'В сценарий можно встроить только реплики и идеи. Съёмочные заметки остаются просто в избранном.';
    }
    const walletCost = document.querySelector('.ai-wallet-costs');
    if (walletCost?.textContent?.includes('Встроить с AI')) {
      walletCost.textContent = walletCost.textContent.replace('Встроить с AI', 'Встроить в сценарий');
    }
  }

  function scheduleRows() {
    if (rowTimer) return;
    rowTimer = window.setTimeout(() => {
      rowTimer = 0;
      patchFavoriteRows();
      patchLibraryCopy();
    }, 0);
  }

  function attachLibraryObserver() {
    const list = document.querySelector('.creator-favorite-list');
    if (!list || list.dataset.promptcamV41Observed === 'true') return;
    list.dataset.promptcamV41Observed = 'true';
    libraryObserver?.disconnect();
    libraryObserver = new MutationObserver(scheduleRows);
    libraryObserver.observe(list, { childList: true });
  }

  function ensureActiveDot() {
    const button = document.getElementById('liveAiButton');
    if (!button || button.querySelector('.live-ai-active-dot')) return;
    const dot = document.createElement('span');
    dot.className = 'live-ai-active-dot';
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot);
  }

  function boot() {
    ensureStyles();
    ensureActiveDot();
    attachLibraryObserver();
    attachRecommendationWatchers();
    patchFavoriteRows();
    patchLibraryCopy();
    syncRecommendationHearts();

    const camera = document.getElementById('cameraView');
    if (camera && !cameraObserver) {
      cameraObserver = new MutationObserver(scheduleHeartSync);
      cameraObserver.observe(camera, { childList: true });
    }
  }

  window.addEventListener('promptcam:creator-library-ready', () => {
    attachLibraryObserver();
    scheduleRows();
    scheduleHeartSync();
  });
  window.addEventListener('promptcam:live-ai-state', scheduleHeartSync);
  window.addEventListener('promptcam:ai-wallet', patchLibraryCopy);
  window.addEventListener('pagehide', () => {
    libraryObserver?.disconnect();
    cameraObserver?.disconnect();
  }, { once: true });

  boot();
  window.setTimeout(boot, 250);
  window.setTimeout(boot, 1200);
})();
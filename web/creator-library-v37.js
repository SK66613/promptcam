(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const scriptInput = document.getElementById('scriptInput');
  const editorCard = scriptInput?.closest('.editor-card');
  const cameraView = document.getElementById('cameraView');
  if (!scriptInput || !editorCard) return;

  const NL = String.fromCharCode(10);
  const state = { tab: 'templates', templates: [], favorites: [], loading: false };
  const favoriteButtons = new Set();
  let pendingIntegration = null;
  let integrationBusy = false;

  function makeButton(label, className = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    if (className) node.className = className;
    return node;
  }

  function compact(value, max = 130) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  const card = document.createElement('section');
  card.className = 'creator-library-card creator-library-personal';
  card.setAttribute('aria-label', 'Личная библиотека PromptCam');

  const head = document.createElement('div');
  head.className = 'creator-library-head';
  const title = document.createElement('div');
  title.className = 'creator-library-title';
  const icon = document.createElement('span');
  icon.className = 'creator-library-icon';
  icon.textContent = '📚';
  const titleCopy = document.createElement('span');
  const titleStrong = document.createElement('strong');
  titleStrong.textContent = 'Библиотека';
  const titleSmall = document.createElement('small');
  titleSmall.textContent = 'Только твои шаблоны и сохранённые AI-подсказки';
  titleCopy.append(titleStrong, titleSmall);
  title.append(icon, titleCopy);
  const count = document.createElement('span');
  count.className = 'creator-library-count';
  head.append(title, count);

  const tabs = document.createElement('div');
  tabs.className = 'creator-library-tabs';
  const templatesTab = makeButton('Мои шаблоны', 'creator-library-tab');
  const favoritesTab = makeButton('♥ Избранное', 'creator-library-tab');
  tabs.append(templatesTab, favoritesTab);

  const templatesPane = document.createElement('section');
  templatesPane.className = 'creator-library-pane';
  const toolbar = document.createElement('div');
  toolbar.className = 'creator-library-toolbar creator-library-toolbar-personal';
  const toolbarHint = document.createElement('small');
  toolbarHint.textContent = 'Сохраняй удачные сценарии и используй их снова.';
  const saveCurrent = makeButton('💾 Сохранить текущий', 'creator-library-save');
  toolbar.append(toolbarHint, saveCurrent);

  const saveForm = document.createElement('div');
  saveForm.className = 'creator-library-save-form';
  saveForm.hidden = true;
  const saveName = document.createElement('input');
  saveName.type = 'text';
  saveName.maxLength = 80;
  saveName.placeholder = 'Название шаблона';
  const saveConfirm = makeButton('Сохранить', 'primary');
  const saveCancel = makeButton('Отмена');
  saveForm.append(saveName, saveConfirm, saveCancel);

  const customLabel = document.createElement('small');
  customLabel.className = 'creator-library-section-label';
  customLabel.textContent = 'СОХРАНЁННЫЕ';
  const customList = document.createElement('div');
  customList.className = 'creator-template-list';
  templatesPane.append(toolbar, saveForm, customLabel, customList);

  const favoritesPane = document.createElement('section');
  favoritesPane.className = 'creator-library-pane';
  favoritesPane.hidden = true;
  const favoriteHint = document.createElement('div');
  favoriteHint.className = 'creator-library-toolbar creator-library-toolbar-personal';
  const favoriteHintText = document.createElement('small');
  favoriteHintText.textContent = 'AI сам выберет место в сценарии — или не вставит съёмочную заметку в произносимый текст.';
  favoriteHint.append(favoriteHintText);
  const favoriteList = document.createElement('div');
  favoriteList.className = 'creator-favorite-list';

  const smartPreview = document.createElement('section');
  smartPreview.className = 'creator-smart-preview';
  smartPreview.hidden = true;
  const smartPreviewHead = document.createElement('div');
  smartPreviewHead.className = 'creator-smart-preview-head';
  const smartPreviewTitle = document.createElement('strong');
  smartPreviewTitle.textContent = '✨ AI нашёл место';
  const smartPlacement = document.createElement('small');
  smartPreviewHead.append(smartPreviewTitle, smartPlacement);
  const smartSummary = document.createElement('p');
  smartSummary.className = 'creator-smart-summary';
  const smartText = document.createElement('textarea');
  smartText.className = 'creator-smart-text';
  smartText.spellcheck = true;
  smartText.setAttribute('aria-label', 'Предпросмотр сценария с избранной AI-подсказкой');
  const smartActions = document.createElement('div');
  smartActions.className = 'creator-smart-actions';
  const smartCancel = makeButton('Оставить как было');
  const smartApply = makeButton('Применить', 'primary');
  smartActions.append(smartCancel, smartApply);
  smartPreview.append(smartPreviewHead, smartSummary, smartText, smartActions);

  favoritesPane.append(favoriteHint, favoriteList, smartPreview);

  const status = document.createElement('p');
  status.className = 'creator-library-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  card.append(head, tabs, templatesPane, favoritesPane, status);
  const scriptAiCard = document.querySelector('.script-ai-card');
  (scriptAiCard || editorCard).insertAdjacentElement('afterend', card);

  function setStatus(message, tone = '') {
    setText(status, message);
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  async function api(action, payload = {}) {
    if (!initData) throw new Error('telegram_only');
    const response = await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action, ...payload }),
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.error || 'library_request_failed');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function friendlyError(error) {
    if (error?.message === 'telegram_only') return 'Синхронизация библиотеки работает внутри Telegram Mini App.';
    if (error?.message === 'template_limit_reached') return 'Достигнут лимит шаблонов. Удали ненужный и попробуй снова.';
    if (error?.message === 'favorite_limit_reached') return 'В избранном уже максимум подсказок. Удали несколько старых.';
    if (error?.status === 401) return 'Telegram-сессия устарела. Переоткрой PromptCam.';
    return 'Не удалось синхронизировать библиотеку. Попробуй ещё раз.';
  }

  function setTab(value) {
    state.tab = value === 'favorites' ? 'favorites' : 'templates';
    templatesPane.hidden = state.tab !== 'templates';
    favoritesPane.hidden = state.tab !== 'favorites';
    templatesTab.classList.toggle('is-selected', state.tab === 'templates');
    favoritesTab.classList.toggle('is-selected', state.tab === 'favorites');
    templatesTab.setAttribute('aria-pressed', String(state.tab === 'templates'));
    favoritesTab.setAttribute('aria-pressed', String(state.tab === 'favorites'));
    renderCount();
  }

  function renderCount() {
    setText(count, state.tab === 'favorites' ? `${state.favorites.length} ♥` : `${state.templates.length} мои`);
    setText(favoritesTab, state.favorites.length ? `♥ Избранное · ${state.favorites.length}` : '♥ Избранное');
  }

  function replaceScript(content, titleText) {
    const next = String(content || '').trim();
    if (!next) return;
    const current = scriptInput.value.trim();
    if (current && current !== next && !window.confirm(`Заменить текущий сценарий шаблоном «${titleText}»?`)) return;
    scriptInput.value = next;
    scriptInput.dispatchEvent(new Event('input', { bubbles: true }));
    scriptInput.focus();
    scriptInput.setSelectionRange(0, 0);
    setStatus(`Шаблон «${titleText}» вставлен.`, 'success');
    window.PromptCamEditorTabs?.setTab?.('script');
  }

  function renderCustomTemplates() {
    customList.replaceChildren();
    if (!state.templates.length) {
      const empty = document.createElement('div');
      empty.className = 'creator-library-empty creator-library-empty-personal';
      empty.textContent = initData
        ? 'Пока пусто. Открой сценарий, доведи его до нужной версии и нажми «Сохранить текущий».'
        : 'Свои шаблоны синхронизируются внутри Telegram Mini App.';
      customList.append(empty);
      return;
    }

    for (const item of state.templates) {
      const row = document.createElement('article');
      row.className = 'creator-template-row creator-template-row-personal';
      const rowHead = document.createElement('div');
      rowHead.className = 'creator-template-row-head';
      const strong = document.createElement('strong');
      strong.textContent = item.title;
      const date = document.createElement('small');
      date.textContent = item.updated_at ? new Date(Number(item.updated_at) * 1000).toLocaleDateString('ru-RU') : '';
      rowHead.append(strong, date);
      const preview = document.createElement('p');
      preview.className = 'creator-template-preview';
      preview.textContent = compact(item.content, 180);
      const actions = document.createElement('div');
      actions.className = 'creator-row-actions';
      const use = makeButton('Открыть', 'primary');
      use.addEventListener('click', () => replaceScript(item.content, item.title));
      const remove = makeButton('Удалить', 'danger');
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Удалить шаблон «${item.title}»?`)) return;
        try {
          await api('delete_template', { id: item.id });
          state.templates = state.templates.filter((entry) => Number(entry.id) !== Number(item.id));
          renderCustomTemplates();
          renderCount();
          setStatus('Шаблон удалён.', 'success');
        } catch (error) {
          setStatus(friendlyError(error), 'error');
        }
      });
      actions.append(use, remove);
      row.append(rowHead, preview, actions);
      customList.append(row);
    }
  }

  function favoriteKey(item) {
    return [item.source || '', item.mode || '', item.kind || '', item.text || '', item.detail || ''].join('\u241f');
  }

  function existingFavorite(draft) {
    const key = favoriteKey(draft);
    return state.favorites.find((item) => favoriteKey(item) === key) || null;
  }

  function placementLabel(value) {
    const labels = {
      hook: 'в начало / хук',
      after_hook: 'сразу после хука',
      middle: 'в середину',
      before_cta: 'перед CTA',
      cta: 'в финал / CTA',
      replace_related: 'вместо похожей мысли',
      none: ''
    };
    return labels[value] || '';
  }

  function closeSmartPreview() {
    pendingIntegration = null;
    smartPreview.hidden = true;
    smartText.value = '';
    smartSummary.textContent = '';
    smartPlacement.textContent = '';
  }

  async function smartInsertFavorite(item, triggerButton) {
    if (integrationBusy) return;
    if (!initData) {
      setStatus('AI-вставка доступна внутри Telegram Mini App.', 'error');
      return;
    }
    integrationBusy = true;
    if (triggerButton) triggerButton.disabled = true;
    closeSmartPreview();
    setStatus('✨ AI ищет правильное место в сценарии…');
    try {
      const response = await fetch('/api/ai/favorite-insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData,
          script: scriptInput.value,
          favorite: item.text,
          detail: item.detail || '',
          source: item.source || 'live',
          kind: item.kind || ''
        }),
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        const error = new Error(data?.error || 'favorite_insert_failed');
        error.status = response.status;
        error.retryAfter = data?.retryAfter || response.headers.get('Retry-After');
        throw error;
      }
      if (data.action === 'skip') {
        setStatus(data.summary || 'Это съёмочная заметка — в произносимый текст её вставлять не нужно.', 'success');
        return;
      }
      pendingIntegration = { item, script: data.script || '', summary: data.summary || '', placement: data.placement || 'none' };
      smartText.value = pendingIntegration.script;
      smartSummary.textContent = pendingIntegration.summary || 'Проверь, как подсказка встроилась в сценарий.';
      smartPlacement.textContent = placementLabel(pendingIntegration.placement);
      smartPreview.hidden = false;
      setStatus('Ничего не изменил — сначала проверь preview.');
      smartPreview.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error?.status === 429) {
        setStatus(`Слишком много AI-вставок подряд. Попробуй через ${Math.max(2, Number(error.retryAfter || 10))} с.`, 'error');
      } else if (error?.status === 401) {
        setStatus('Telegram-сессия устарела. Переоткрой PromptCam.', 'error');
      } else {
        setStatus('Не удалось аккуратно встроить подсказку. Попробуй ещё раз.', 'error');
      }
    } finally {
      integrationBusy = false;
      if (triggerButton) triggerButton.disabled = false;
    }
  }

  function renderFavorites() {
    favoriteList.replaceChildren();
    if (!state.favorites.length) {
      const empty = document.createElement('div');
      empty.className = 'creator-library-empty creator-library-empty-personal';
      empty.textContent = 'Пока пусто. Нажимай ♡ на действительно полезных подсказках во время съёмки.';
      favoriteList.append(empty);
      return;
    }

    for (const item of state.favorites) {
      const row = document.createElement('article');
      row.className = 'creator-favorite-row creator-favorite-row-personal';
      const rowHead = document.createElement('div');
      rowHead.className = 'creator-favorite-row-head';
      const strong = document.createElement('strong');
      strong.textContent = item.kind || (item.source === 'take' ? '🎬 AI Дубль' : '✨ AI Live');
      const date = document.createElement('small');
      date.textContent = item.updated_at ? new Date(Number(item.updated_at) * 1000).toLocaleDateString('ru-RU') : '';
      rowHead.append(strong, date);
      const text = document.createElement('p');
      text.className = 'creator-favorite-text';
      text.textContent = item.text;
      row.append(rowHead, text);
      if (item.detail) {
        const detail = document.createElement('p');
        detail.className = 'creator-favorite-detail';
        detail.textContent = item.detail;
        row.append(detail);
      }
      const actions = document.createElement('div');
      actions.className = 'creator-row-actions';
      const integrate = makeButton('✨ Встроить с AI', 'primary');
      integrate.addEventListener('click', () => smartInsertFavorite(item, integrate));
      const remove = makeButton('Убрать ♥', 'danger');
      remove.addEventListener('click', async () => {
        try {
          await api('delete_favorite', { id: item.id });
          state.favorites = state.favorites.filter((entry) => Number(entry.id) !== Number(item.id));
          if (pendingIntegration?.item?.id === item.id) closeSmartPreview();
          renderFavorites();
          renderCount();
          syncHearts();
          setStatus('Убрал подсказку из избранного.', 'success');
        } catch (error) {
          setStatus(friendlyError(error), 'error');
        }
      });
      actions.append(integrate, remove);
      row.append(actions);
      favoriteList.append(row);
    }
  }

  function defaultTemplateName() {
    const firstLine = scriptInput.value.split(NL).map((line) => line.trim()).find(Boolean) || '';
    return compact(firstLine, 46) || 'Мой шаблон';
  }

  async function saveTemplate() {
    const content = scriptInput.value.trim();
    const titleText = saveName.value.trim();
    if (!content) {
      setStatus('Сначала напиши сценарий, который хочешь сохранить.', 'error');
      return;
    }
    if (!titleText) {
      setStatus('Дай шаблону короткое название.', 'error');
      saveName.focus();
      return;
    }
    saveConfirm.disabled = true;
    try {
      const data = await api('save_template', { title: titleText, content });
      state.templates = [data.template, ...state.templates.filter((entry) => Number(entry.id) !== Number(data.template.id))];
      saveForm.hidden = true;
      renderCustomTemplates();
      renderCount();
      setStatus(`Шаблон «${data.template.title}» сохранён.`, 'success');
      tg?.HapticFeedback?.notificationOccurred?.('success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      saveConfirm.disabled = false;
    }
  }

  function liveDraft() {
    const node = document.getElementById('liveAiSuggestion');
    return {
      source: 'live',
      mode: window.PromptCamLiveAI?.getStatus?.().mode || '',
      kind: node?.querySelector('.live-ai-suggestion-type')?.textContent?.trim() || '✨ AI Live',
      text: node?.querySelector('.live-ai-suggestion-text')?.textContent?.trim() || '',
      detail: ''
    };
  }

  function takeDraft() {
    const node = document.querySelector('.take-director-card');
    return {
      source: 'take',
      mode: 'take',
      kind: node?.querySelector('.take-director-card-title')?.textContent?.trim() || '🎬 AI Дубль',
      text: node?.querySelector('.take-director-card-text')?.textContent?.trim() || '',
      detail: node?.querySelector('.take-director-card-anchor')?.textContent?.trim() || ''
    };
  }

  function createHeart(factory) {
    const node = makeButton('♡', 'creator-favorite-heart');
    node._promptcamFavoriteFactory = factory;
    node.setAttribute('aria-label', 'Добавить AI-подсказку в избранное');
    node.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const draft = factory();
      if (!draft.text || node.disabled) return;
      node.disabled = true;
      try {
        const existing = existingFavorite(draft);
        if (existing) {
          await api('delete_favorite', { id: existing.id });
          state.favorites = state.favorites.filter((entry) => Number(entry.id) !== Number(existing.id));
        } else {
          const data = await api('save_favorite', draft);
          state.favorites = [data.favorite, ...state.favorites.filter((entry) => Number(entry.id) !== Number(data.favorite.id))];
        }
        renderFavorites();
        renderCount();
        syncHearts();
      } catch (error) {
        setStatus(friendlyError(error), 'error');
      } finally {
        node.disabled = false;
        syncHeart(node);
      }
    });
    favoriteButtons.add(node);
    return node;
  }

  function syncHeart(node) {
    if (!node?.isConnected) {
      favoriteButtons.delete(node);
      return;
    }
    const draft = node._promptcamFavoriteFactory?.();
    const saved = Boolean(draft?.text && existingFavorite(draft));
    const nextText = saved ? '♥' : '♡';
    const nextLabel = saved ? 'Убрать AI-подсказку из избранного' : 'Добавить AI-подсказку в избранное';
    if (node.textContent !== nextText) node.textContent = nextText;
    if (node.classList.contains('is-saved') !== saved) node.classList.toggle('is-saved', saved);
    if (node.getAttribute('aria-label') !== nextLabel) node.setAttribute('aria-label', nextLabel);
  }

  function syncHearts() {
    for (const node of [...favoriteButtons]) syncHeart(node);
  }

  function decorateRecommendations() {
    const liveHead = document.querySelector('#liveAiSuggestion .live-ai-suggestion-head');
    if (liveHead && !liveHead.querySelector('.creator-favorite-heart')) {
      const close = liveHead.querySelector('.live-ai-suggestion-close');
      const heart = createHeart(liveDraft);
      if (close) liveHead.insertBefore(heart, close);
      else liveHead.append(heart);
    }
    const takeHead = document.querySelector('.take-director-card .take-director-card-head');
    if (takeHead && !takeHead.querySelector('.creator-favorite-heart')) {
      const close = takeHead.querySelector('.take-director-card-close');
      const heart = createHeart(takeDraft);
      if (close) takeHead.insertBefore(heart, close);
      else takeHead.append(heart);
    }
    syncHearts();
  }

  async function loadRemote() {
    if (!initData || state.loading) {
      if (!initData) setStatus('Свои шаблоны и избранное синхронизируются внутри Telegram Mini App.');
      return;
    }
    state.loading = true;
    setStatus('Синхронизирую библиотеку…');
    try {
      const data = await api('list');
      state.templates = Array.isArray(data.templates) ? data.templates : [];
      state.favorites = Array.isArray(data.favorites) ? data.favorites : [];
      renderCustomTemplates();
      renderFavorites();
      renderCount();
      syncHearts();
      setStatus('Библиотека синхронизирована.', 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      state.loading = false;
    }
  }

  templatesTab.addEventListener('click', () => setTab('templates'));
  favoritesTab.addEventListener('click', () => setTab('favorites'));
  saveCurrent.addEventListener('click', () => {
    if (!initData) {
      setStatus('Сохранение шаблонов доступно внутри Telegram Mini App.', 'error');
      return;
    }
    if (!scriptInput.value.trim()) {
      setStatus('Сначала напиши сценарий.', 'error');
      window.PromptCamEditorTabs?.setTab?.('script');
      scriptInput.focus();
      return;
    }
    saveName.value = defaultTemplateName();
    saveForm.hidden = false;
    saveName.focus();
    saveName.select();
  });
  saveConfirm.addEventListener('click', saveTemplate);
  saveCancel.addEventListener('click', () => { saveForm.hidden = true; });
  saveName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); saveTemplate(); }
    if (event.key === 'Escape') saveForm.hidden = true;
  });
  smartCancel.addEventListener('click', () => {
    closeSmartPreview();
    setStatus('Оставил сценарий без изменений.');
  });
  smartApply.addEventListener('click', () => {
    if (!pendingIntegration) return;
    const next = smartText.value.trim();
    if (!next) {
      setStatus('Preview пустой — ничего не меняю.', 'error');
      return;
    }
    scriptInput.value = next;
    scriptInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.PromptCamScriptAI?.clearBeats?.();
    closeSmartPreview();
    setStatus('AI-подсказка встроена в сценарий.', 'success');
    tg?.HapticFeedback?.notificationOccurred?.('success');
    window.PromptCamEditorTabs?.setTab?.('script');
    scriptInput.focus({ preventScroll: true });
  });

  let recommendationObserver = null;
  if (cameraView) {
    recommendationObserver = new MutationObserver(() => decorateRecommendations());
    recommendationObserver.observe(cameraView, { childList: true });
  }

  renderCustomTemplates();
  renderFavorites();
  setTab('templates');
  decorateRecommendations();
  loadRemote();
  window.dispatchEvent(new CustomEvent('promptcam:creator-library-ready'));

  window.addEventListener('pagehide', () => recommendationObserver?.disconnect(), { once: true });
  window.PromptCamCreatorLibrary = Object.freeze({
    getTemplates: () => state.templates.map((item) => ({ ...item })),
    getFavorites: () => state.favorites.map((item) => ({ ...item })),
    getBuiltIns: () => [],
    openFavorites: () => setTab('favorites'),
    refresh: loadRemote
  });
})();

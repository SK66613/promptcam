(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const scriptInput = document.getElementById('scriptInput');
  const editorCard = scriptInput?.closest('.editor-card');
  const cameraView = document.getElementById('cameraView');
  if (!scriptInput || !editorCard) return;

  const BUILT_INS = [
    ['expert-60', '🎓 Экспертный ролик 60 сек', 'Хук → проблема → 3 пункта → CTA', '[Хук: неожиданный факт или обещание результата]\n\nЕсли ты [аудитория], скорее всего сталкивался с [проблема].\n\nВот три вещи, которые помогут.\n\nПервое — [совет 1 + короткое объяснение].\n\nВторое — [совет 2 + пример].\n\nТретье — [совет 3 + результат].\n\n[CTA: что сделать зрителю после ролика].'],
    ['three-tips', '⚡ 3 быстрых совета', 'Короткий формат Reels / Shorts', 'Три быстрых совета про [тема], которые можно применить сегодня.\n\nПервый: [совет].\n\nВторой: [совет].\n\nТретий: [совет].\n\nСохрани, чтобы не потерять, и попробуй [следующий шаг].'],
    ['product-demo', '📦 Демо продукта', 'Проблема → показ → результат', 'Если тебе надоело [проблема], покажу, как я решаю это с помощью [продукт].\n\nВот как это выглядит: [действие / демонстрация].\n\nСамое полезное здесь — [ключевая функция].\n\nВ итоге получаем [конкретный результат].\n\n[CTA: попробовать / узнать подробнее / написать].'],
    ['story', '🎭 История', 'Ситуация → поворот → вывод', 'Недавно со мной произошло [ситуация].\n\nСначала я думал, что [ожидание].\n\nНо потом случилось [поворот].\n\nИ именно тогда я понял [главный вывод].\n\nЕсли ты сейчас в похожей ситуации, попробуй [совет / действие].'],
    ['sales', '🔥 Продающий ролик', 'Боль → решение → доказательство → CTA', 'Если у тебя [боль аудитории], не обязательно мириться с [последствие].\n\n[Продукт / услуга] помогает [основной результат] за счёт [как это работает].\n\nНапример: [короткое доказательство / кейс / демонстрация].\n\nЕсли хочешь [результат], [CTA: напиши / перейди / попробуй].'],
    ['update', '📰 Апдейт / новость', 'Что произошло → почему важно → что делать', 'Короткий апдейт про [тема].\n\nПроизошло вот что: [факт / изменение].\n\nПочему это важно: [значение для аудитории].\n\nЧто я бы сделал сейчас: [практический следующий шаг].\n\n[Финальная мысль / вопрос аудитории].']
  ].map(([id, title, hint, content]) => ({ id, title, hint, content }));

  const state = { tab: 'templates', templates: [], favorites: [], loading: false };
  const favoriteButtons = new Set();

  function button(text, className = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function sectionLabel(text) {
    const node = document.createElement('small');
    node.className = 'creator-library-section-label';
    node.textContent = text;
    return node;
  }

  const card = document.createElement('section');
  card.className = 'creator-library-card';
  card.setAttribute('aria-label', 'Библиотека PromptCam');

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
  titleSmall.textContent = 'Шаблоны сценариев и любимые AI-подсказки';
  titleCopy.append(titleStrong, titleSmall);
  title.append(icon, titleCopy);
  const count = document.createElement('span');
  count.className = 'creator-library-count';
  head.append(title, count);

  const tabs = document.createElement('div');
  tabs.className = 'creator-library-tabs';
  const templatesTab = button('Шаблоны', 'creator-library-tab');
  const favoritesTab = button('♥ Избранное', 'creator-library-tab');
  tabs.append(templatesTab, favoritesTab);

  const templatesPane = document.createElement('section');
  templatesPane.className = 'creator-library-pane';
  const toolbar = document.createElement('div');
  toolbar.className = 'creator-library-toolbar';
  const toolbarHint = document.createElement('small');
  toolbarHint.textContent = 'Готовый шаблон можно вставить и сразу дописать под себя.';
  const saveCurrent = button('💾 Сохранить текущий', 'creator-library-save');
  toolbar.append(toolbarHint, saveCurrent);

  const saveForm = document.createElement('div');
  saveForm.className = 'creator-library-save-form';
  saveForm.hidden = true;
  const saveName = document.createElement('input');
  saveName.type = 'text';
  saveName.maxLength = 80;
  saveName.placeholder = 'Название шаблона';
  const saveConfirm = button('Сохранить', 'primary');
  const saveCancel = button('Отмена');
  saveForm.append(saveName, saveConfirm, saveCancel);

  const builtGrid = document.createElement('div');
  builtGrid.className = 'creator-template-grid';
  const customList = document.createElement('div');
  customList.className = 'creator-template-list';
  templatesPane.append(toolbar, saveForm, sectionLabel('ГОТОВЫЕ ШАБЛОНЫ'), builtGrid, sectionLabel('МОИ ШАБЛОНЫ'), customList);

  const favoritesPane = document.createElement('section');
  favoritesPane.className = 'creator-library-pane';
  favoritesPane.hidden = true;
  const favoritesHint = document.createElement('div');
  favoritesHint.className = 'creator-library-toolbar';
  const favoritesHintText = document.createElement('small');
  favoritesHintText.textContent = 'Нажимай ♡ на советах AI Live и AI Дубля — они появятся здесь.';
  favoritesHint.append(favoritesHintText);
  const favoriteList = document.createElement('div');
  favoriteList.className = 'creator-favorite-list';
  favoritesPane.append(favoritesHint, favoriteList);

  const status = document.createElement('p');
  status.className = 'creator-library-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  card.append(head, tabs, templatesPane, favoritesPane, status);
  const scriptAiCard = document.querySelector('.script-ai-card');
  (scriptAiCard || editorCard).insertAdjacentElement('afterend', card);

  function setStatus(message, tone = '') {
    status.textContent = message;
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
    if (error?.message === 'telegram_only') return 'Свои шаблоны и избранное синхронизируются внутри Telegram Mini App.';
    if (error?.message === 'template_limit_reached') return 'Достигнут лимит шаблонов. Удали ненужный и попробуй снова.';
    if (error?.message === 'favorite_limit_reached') return 'В избранном уже максимум подсказок. Удали несколько старых.';
    if (error?.status === 401) return 'Telegram-сессия устарела. Переоткрой PromptCam.';
    return 'Не удалось синхронизировать библиотеку. Попробуй ещё раз.';
  }

  function compact(text, max = 130) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  function setTab(value) {
    state.tab = value === 'favorites' ? 'favorites' : 'templates';
    templatesPane.hidden = state.tab !== 'templates';
    favoritesPane.hidden = state.tab !== 'favorites';
    templatesTab.classList.toggle('is-selected', state.tab === 'templates');
    favoritesTab.classList.toggle('is-selected', state.tab === 'favorites');
    renderCount();
  }

  function renderCount() {
    count.textContent = state.tab === 'favorites' ? `${state.favorites.length} ♥` : `${BUILT_INS.length + state.templates.length} шт.`;
    favoritesTab.textContent = state.favorites.length ? `♥ Избранное · ${state.favorites.length}` : '♥ Избранное';
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
    try { tg?.HapticFeedback?.impactOccurred?.('light'); } catch (_) { /* optional */ }
  }

  function insertIntoScript(text) {
    const value = String(text || '').trim();
    if (!value) return;
    const start = Number.isFinite(scriptInput.selectionStart) ? scriptInput.selectionStart : scriptInput.value.length;
    const end = Number.isFinite(scriptInput.selectionEnd) ? scriptInput.selectionEnd : start;
    const before = scriptInput.value.slice(0, start);
    const after = scriptInput.value.slice(end);
    const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
    scriptInput.value = `${before}${prefix}${value}${suffix}${after}`;
    const cursor = before.length + prefix.length + value.length;
    scriptInput.dispatchEvent(new Event('input', { bubbles: true }));
    scriptInput.focus();
    scriptInput.setSelectionRange(cursor, cursor);
    setStatus('AI-подсказка вставлена в сценарий.', 'success');
  }

  function renderBuiltIns() {
    builtGrid.textContent = '';
    for (const item of BUILT_INS) {
      const row = document.createElement('article');
      row.className = 'creator-template-card';
      const strong = document.createElement('strong');
      strong.textContent = item.title;
      const hint = document.createElement('p');
      hint.textContent = item.hint;
      const use = button('Вставить шаблон', 'creator-template-use');
      use.addEventListener('click', () => replaceScript(item.content, item.title));
      row.append(strong, hint, use);
      builtGrid.append(row);
    }
  }

  function renderCustomTemplates() {
    customList.textContent = '';
    if (!state.templates.length) {
      const empty = document.createElement('div');
      empty.className = 'creator-library-empty';
      empty.textContent = initData ? 'Пока нет своих шаблонов.' : 'Свои шаблоны синхронизируются внутри Telegram Mini App.';
      customList.append(empty);
      return;
    }
    for (const item of state.templates) {
      const row = document.createElement('article');
      row.className = 'creator-template-row';
      const strong = document.createElement('strong');
      strong.textContent = item.title;
      const preview = document.createElement('p');
      preview.className = 'creator-template-preview';
      preview.textContent = compact(item.content);
      const actions = document.createElement('div');
      actions.className = 'creator-row-actions';
      const use = button('Вставить', 'primary');
      use.addEventListener('click', () => replaceScript(item.content, item.title));
      const remove = button('Удалить', 'danger');
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Удалить шаблон «${item.title}»?`)) return;
        try {
          await api('delete_template', { id: item.id });
          state.templates = state.templates.filter((entry) => Number(entry.id) !== Number(item.id));
          renderCustomTemplates();
          renderCount();
        } catch (error) { setStatus(friendlyError(error), 'error'); }
      });
      actions.append(use, remove);
      row.append(strong, preview, actions);
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

  function renderFavorites() {
    favoriteList.textContent = '';
    if (!state.favorites.length) {
      const empty = document.createElement('div');
      empty.className = 'creator-library-empty';
      empty.textContent = 'Пока пусто. Нажми ♡ на полезной AI-подсказке.';
      favoriteList.append(empty);
      return;
    }
    for (const item of state.favorites) {
      const row = document.createElement('article');
      row.className = 'creator-favorite-row';
      const strong = document.createElement('strong');
      strong.textContent = item.kind || (item.source === 'take' ? '🎬 AI Дубль' : '✨ AI Live');
      const text = document.createElement('p');
      text.className = 'creator-favorite-text';
      text.textContent = item.text;
      row.append(strong, text);
      if (item.detail) {
        const detail = document.createElement('p');
        detail.className = 'creator-favorite-detail';
        detail.textContent = item.detail;
        row.append(detail);
      }
      const actions = document.createElement('div');
      actions.className = 'creator-row-actions';
      const insert = button('Вставить в сценарий', 'primary');
      insert.addEventListener('click', () => insertIntoScript(item.text));
      const remove = button('Убрать ♥', 'danger');
      remove.addEventListener('click', async () => {
        try {
          await api('delete_favorite', { id: item.id });
          state.favorites = state.favorites.filter((entry) => Number(entry.id) !== Number(item.id));
          renderFavorites();
          renderCount();
          syncHearts();
        } catch (error) { setStatus(friendlyError(error), 'error'); }
      });
      actions.append(insert, remove);
      row.append(actions);
      favoriteList.append(row);
    }
  }

  function renderAll() {
    renderBuiltIns();
    renderCustomTemplates();
    renderFavorites();
    renderCount();
    syncHearts();
  }

  function defaultTemplateName() {
    const firstLine = scriptInput.value.split(String.fromCharCode(10)).map((line) => line.trim()).find(Boolean) || '';
    return compact(firstLine, 46) || 'Мой шаблон';
  }

  async function saveTemplate() {
    const content = scriptInput.value.trim();
    const titleText = saveName.value.trim();
    if (!content) { setStatus('Сначала напиши сценарий.', 'error'); return; }
    if (!titleText) { setStatus('Дай шаблону название.', 'error'); return; }
    saveConfirm.disabled = true;
    try {
      const data = await api('save_template', { title: titleText, content });
      state.templates = [data.template, ...state.templates.filter((entry) => Number(entry.id) !== Number(data.template.id))];
      saveForm.hidden = true;
      renderCustomTemplates();
      renderCount();
      setStatus(`Шаблон «${data.template.title}» сохранён.`, 'success');
    } catch (error) { setStatus(friendlyError(error), 'error'); }
    finally { saveConfirm.disabled = false; }
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
    const node = button('♡', 'creator-favorite-heart');
    node._promptcamFavoriteFactory = factory;
    node.setAttribute('aria-label', 'Добавить AI-подсказку в избранное');
    node.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const draft = factory();
      if (!draft.text) return;
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
      } catch (error) { setStatus(friendlyError(error), 'error'); }
      finally {
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
    node.classList.toggle('is-saved', saved);
    node.textContent = saved ? '♥' : '♡';
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
    if (!initData || state.loading) return;
    state.loading = true;
    setStatus('Синхронизирую библиотеку…');
    try {
      const data = await api('list');
      state.templates = Array.isArray(data.templates) ? data.templates : [];
      state.favorites = Array.isArray(data.favorites) ? data.favorites : [];
      renderAll();
      setStatus('Библиотека синхронизирована.', 'success');
    } catch (error) { setStatus(friendlyError(error), 'error'); }
    finally { state.loading = false; }
  }

  templatesTab.addEventListener('click', () => setTab('templates'));
  favoritesTab.addEventListener('click', () => setTab('favorites'));
  saveCurrent.addEventListener('click', () => {
    if (!initData) { setStatus('Сохранение доступно внутри Telegram Mini App.', 'error'); return; }
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

  let recommendationObserver = null;
  if (cameraView) {
    recommendationObserver = new MutationObserver(decorateRecommendations);
    recommendationObserver.observe(cameraView, { childList: true, subtree: true });
  }

  renderAll();
  setTab('templates');
  decorateRecommendations();
  loadRemote();
  window.dispatchEvent(new CustomEvent('promptcam:creator-library-ready'));

  window.addEventListener('pagehide', () => recommendationObserver?.disconnect(), { once: true });
  window.PromptCamCreatorLibrary = Object.freeze({
    getTemplates: () => state.templates.map((item) => ({ ...item })),
    getFavorites: () => state.favorites.map((item) => ({ ...item })),
    getBuiltIns: () => BUILT_INS.map((item) => ({ ...item })),
    openFavorites: () => setTab('favorites'),
    refresh: loadRemote
  });
})();

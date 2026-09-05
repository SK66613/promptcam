(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const scriptInput = document.getElementById('scriptInput');
  const editorCard = scriptInput?.closest('.editor-card');
  const cameraView = document.getElementById('cameraView');
  if (!scriptInput || !editorCard) return;

  const BUILT_INS = [
    {
      id: 'expert-60',
      title: '🎓 Экспертный ролик 60 сек',
      hint: 'Хук → проблема → 3 пункта → CTA',
      content: '[Хук: неожиданный факт или обещание результата]\n\nЕсли ты [аудитория], скорее всего сталкивался с [проблема].\n\nВот три вещи, которые помогут.\n\nПервое — [совет 1 + короткое объяснение].\n\nВторое — [совет 2 + пример].\n\nТретье — [совет 3 + результат].\n\n[CTA: что сделать зрителю после ролика].'
    },
    {
      id: 'three-tips',
      title: '⚡ 3 быстрых совета',
      hint: 'Короткий формат Reels / Shorts',
      content: 'Три быстрых совета про [тема], которые можно применить сегодня.\n\nПервый: [совет].\n\nВторой: [совет].\n\nТретий: [совет].\n\nСохрани, чтобы не потерять, и попробуй [следующий шаг].'
    },
    {
      id: 'product-demo',
      title: '📦 Демо продукта',
      hint: 'Проблема → показ → результат',
      content: 'Если тебе надоело [проблема], покажу, как я решаю это с помощью [продукт].\n\nВот как это выглядит: [действие / демонстрация].\n\nСамое полезное здесь — [ключевая функция].\n\nВ итоге получаем [конкретный результат].\n\n[CTA: попробовать / узнать подробнее / написать].'
    },
    {
      id: 'story',
      title: '🎭 История',
      hint: 'Ситуация → поворот → вывод',
      content: 'Недавно со мной произошло [ситуация].\n\nСначала я думал, что [ожидание].\n\nНо потом случилось [поворот].\n\nИ именно тогда я понял [главный вывод].\n\nЕсли ты сейчас в похожей ситуации, попробуй [совет / действие].'
    },
    {
      id: 'sales',
      title: '🔥 Продающий ролик',
      hint: 'Боль → решение → доказательство → CTA',
      content: 'Если у тебя [боль аудитории], не обязательно мириться с [последствие].\n\n[Продукт / услуга] помогает [основной результат] за счёт [как это работает].\n\nНапример: [короткое доказательство / кейс / демонстрация].\n\nЕсли хочешь [результат], [CTA: напиши / перейди / попробуй].'
    },
    {
      id: 'update',
      title: '📰 Апдейт / новость',
      hint: 'Что произошло → почему важно → что делать',
      content: 'Короткий апдейт про [тема].\n\nПроизошло вот что: [факт / изменение].\n\nПочему это важно: [значение для аудитории].\n\nЧто я бы сделал сейчас: [практический следующий шаг].\n\n[Финальная мысль / вопрос аудитории].'
    }
  ];

  const state = {
    tab: 'templates',
    templates: [],
    favorites: [],
    loading: false
  };
  const favoriteButtons = new Set();

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
  const templatesTab = document.createElement('button');
  templatesTab.type = 'button';
  templatesTab.className = 'creator-library-tab';
  templatesTab.textContent = 'Шаблоны';
  const favoritesTab = document.createElement('button');
  favoritesTab.type = 'button';
  favoritesTab.className = 'creator-library-tab';
  favoritesTab.textContent = '♥ Избранное';
  tabs.append(templatesTab, favoritesTab);

  const templatesPane = document.createElement('section');
  templatesPane.className = 'creator-library-pane';
  const toolbar = document.createElement('div');
  toolbar.className = 'creator-library-toolbar';
  const toolbarHint = document.createElement('small');
  toolbarHint.textContent = 'Готовый шаблон можно вставить и сразу дописать под себя.';
  const saveCurrent = document.createElement('button');
  saveCurrent.type = 'button';
  saveCurrent.className = 'creator-library-save';
  saveCurrent.textContent = '💾 Сохранить текущий';
  toolbar.append(toolbarHint, saveCurrent);

  const saveForm = document.createElement('div');
  saveForm.className = 'creator-library-save-form';
  saveForm.hidden = true;
  const saveName = document.createElement('input');
  saveName.type = 'text';
  saveName.maxLength = 80;
  saveName.placeholder = 'Название шаблона';
  const saveConfirm = document.createElement('button');
  saveConfirm.type = 'button';
  saveConfirm.className = 'primary';
  saveConfirm.textContent = 'Сохранить';
  const saveCancel = document.createElement('button');
  saveCancel.type = 'button';
  saveCancel.textContent = 'Отмена';
  saveForm.append(saveName, saveConfirm, saveCancel);

  const builtLabel = document.createElement('small');
  builtLabel.className = 'creator-library-section-label';
  builtLabel.textContent = 'ГОТОВЫЕ ШАБЛОНЫ';
  const builtGrid = document.createElement('div');
  builtGrid.className = 'creator-template-grid';
  const customLabel = document.createElement('small');
  customLabel.className = 'creator-library-section-label';
  customLabel.textContent = 'МОИ ШАБЛОНЫ';
  const customList = document.createElement('div');
  customList.className = 'creator-template-list';
  templatesPane.append(toolbar, saveForm, builtLabel, builtGrid, customLabel, customList);

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

  function api(action, payload = {}) {
    if (!initData) return Promise.reject(new Error('telegram_only'));
    return fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action, ...payload }),
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        const error = new Error(data?.error || 'library_request_failed');
        error.status = response.status;
        error.payload = data;
        throw error;
      }
      return data;
    });
  }

  function friendlyError(error) {
    if (error?.message === 'telegram_only') return 'Свои шаблоны и избранное синхронизируются внутри Telegram Mini App.';
    if (error?.message === 'template_limit_reached') return 'Достигнут лимит шаблонов. Удали ненужный и попробуй снова.';
    if (error?.message === 'favorite_limit_reached') return 'В избранном уже максимум подсказок. Удали несколько старых.';
    if (error?.status === 401) return 'Telegram-сессия устарела. Переоткрой PromptCam.';
    return 'Не удалось синхронизировать библиотеку. Попробуй ещё раз.';
  }

  function compactPreview(text, maxLength = 130) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
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
    count.textContent = state.tab === 'favorites'
      ? `${state.favorites.length} ♥`
      : `${BUILT_INS.length + state.templates.length} шт.`;
    favoritesTab.textContent = state.favorites.length ? `♥ Избранное · ${state.favorites.length}` : '♥ Избранное';
  }

  function replaceScript(content, titleText) {
    const next = String(content || '').trim();
    if (!next) return;
    const current = scriptInput.value.trim();
    if (current && current !== next) {
      const confirmed = window.confirm(`Заменить текущий сценарий шаблоном «${titleText}»?`);
      if (!confirmed) return;
    }
    scriptInput.value = next;
    scriptInput.dispatchEvent(new Event('input', { bubbles: true }));
    scriptInput.focus();
    scriptInput.setSelectionRange(0, 0);
    setStatus(`Шаблон «${titleText}» вставлен.`, 'success');
    tg?.HapticFeedback?.impactOccurred?.('light');
  }

  function insertIntoScript(text) {
    const value = String(text || '').trim();
    if (!value) return;
    const start = Number.isFinite(scriptInput.selectionStart) ? scriptInput.selectionStart : scriptInput.value.length;
    const end = Number.isFinite(scriptInput.selectionEnd) ? scriptInput.selectionEnd : start;
    const before = scriptInput.value.slice(0, start);
    const after = scriptInput.value.slice(end);
    const prefix = before && !/\n\s*$/.test(before) ? '\n\n' : '';
    const suffix = after && !/^\s*\n/.test(after) ? '\n\n' : '';
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
      const rowHead = document.createElement('div');
      rowHead.className = 'creator-template-card-head';
      const rowTitle = document.createElement('strong');
      rowTitle.textContent = item.title;
      rowHead.append(rowTitle);
      const rowHint = document.createElement('p');
      rowHint.textContent = item.hint;
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'creator-template-use';
      use.textContent = 'Вставить шаблон';
      use.addEventListener('click', () => replaceScript(item.content, item.title));
      row.append(rowHead, rowHint, use);
      builtGrid.append(row);
    }
  }

  function renderCustomTemplates() {
    customList.textContent = '';
    if (!state.templates.length) {
      const empty = document.createElement('div');
      empty.className = 'creator-library-empty';
      empty.textContent = initData
        ? 'Пока нет своих шаблонов. Сохрани текущий сценарий — он появится здесь на всех твоих устройствах.'
        : 'Свои шаблоны синхронизируются внутри Telegram Mini App.';
      customList.append(empty);
      return;
    }

    for (const item of state.templates) {
      const row = document.createElement('article');
      row.className = 'creator-template-row';
      const rowHead = document.createElement('div');
      rowHead.className = 'creator-template-row-head';
      const rowTitle = document.createElement('strong');
      rowTitle.textContent = item.title;
      const date = document.createElement('small');
      date.textContent = item.updated_at ? new Date(Number(item.updated_at) * 1000).toLocaleDateString('ru-RU') : '';
      rowHead.append(rowTitle, date);
      const preview = document.createElement('p');
      preview.className = 'creator-template-preview';
      preview.textContent = compactPreview(item.content);
      const actions = document.createElement('div');
      actions.className = 'creator-row-actions';
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'primary';
      use.textContent = 'Вставить';
      use.addEventListener('click', () => replaceScript(item.content, item.title));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', () => deleteTemplate(item));
      actions.append(use, remove);
      row.append(rowHead, preview, actions);
      customList.append(row);
    }
  }

  function favoriteLabel(item) {
    if (item.source === 'take') return item.kind || '🎬 AI Дубль';
    return item.kind || '✨ AI Live';
  }

  function renderFavorites() {
    favoriteList.textContent = '';
    if (!state.favorites.length) {
      const empty = document.createElement('div');
      empty.className = 'creator-library-empty';
      empty.textContent = 'Пока пусто. Когда AI даст полезный совет, нажми ♡ прямо на карточке.';
      favoriteList.append(empty);
      return;
    }

    for (const item of state.favorites) {
      const row = document.createElement('article');
      row.className = 'creator-favorite-row';
      const rowHead = document.createElement('div');
      rowHead.className = 'creator-favorite-row-head';
      const rowTitle = document.createElement('strong');
      rowTitle.textContent = favoriteLabel(item);
      const date = document.createElement('small');
      date.textContent = item.updated_at ? new Date(Number(item.updated_at) * 1000).toLocaleDateString('ru-RU') : '';
      rowHead.append(rowTitle, date);
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
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.className = 'primary';
      insert.textContent = 'Вставить в сценарий';
      insert.addEventListener('click', () => insertIntoScript(item.text));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Убрать ♥';
      remove.addEventListener('click', () => deleteFavorite(item));
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
    syncHeartButtons();
  }

  function defaultTemplateName() {
    const firstLine = scriptInput.value.split(/\n/u).map((line) => line.trim()).find(Boolean) || '';
    return compactPreview(firstLine, 46) || 'Мой шаблон';
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
      const saved = data.template;
      state.templates = [saved, ...state.templates.filter((item) => Number(item.id) !== Number(saved.id))];
      saveForm.hidden = true;
      renderCustomTemplates();
      renderCount();
      setStatus(`Шаблон «${saved.title}» сохранён в аккаунт.`, 'success');
      tg?.HapticFeedback?.notificationOccurred?.('success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      saveConfirm.disabled = false;
    }
  }

  async function deleteTemplate(item) {
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
  }

  function favoriteKey(item) {
    return [item.source || '', item.mode || '', item.kind || '', item.text || '', item.detail || ''].join('\u241f');
  }

  function existingFavorite(draft) {
    const key = favoriteKey(draft);
    return state.favorites.find((item) => favoriteKey(item) === key) || null;
  }

  async function saveFavorite(draft) {
    const data = await api('save_favorite', draft);
    const saved = data.favorite;
    state.favorites = [saved, ...state.favorites.filter((item) => Number(item.id) !== Number(saved.id))];
    renderFavorites();
    renderCount();
    syncHeartButtons();
    setStatus('Добавил AI-подсказку в избранное.', 'success');
    window.dispatchEvent(new CustomEvent('promptcam:library-favorite', { detail: { saved: true, favorite: saved } }));
    return saved;
  }

  async function deleteFavorite(item) {
    try {
      await api('delete_favorite', { id: item.id });
      state.favorites = state.favorites.filter((entry) => Number(entry.id) !== Number(item.id));
      renderFavorites();
      renderCount();
      syncHeartButtons();
      setStatus('Убрал подсказку из избранного.', 'success');
      window.dispatchEvent(new CustomEvent('promptcam:library-favorite', { detail: { saved: false, favorite: item } }));
    } catch (error) {
      setStatus(friendlyError(error), 'error');
      throw error;
    }
  }

  async function toggleFavorite(draft, button) {
    if (!draft?.text) return;
    button.disabled = true;
    try {
      const existing = existingFavorite(draft);
      if (existing) await deleteFavorite(existing);
      else await saveFavorite(draft);
      tg?.HapticFeedback?.impactOccurred?.('light');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      button.disabled = false;
      syncHeartButton(button);
    }
  }

  function liveDraft() {
    const suggestion = document.getElementById('liveAiSuggestion');
    const text = suggestion?.querySelector('.live-ai-suggestion-text')?.textContent?.trim() || '';
    const kind = suggestion?.querySelector('.live-ai-suggestion-type')?.textContent?.trim() || '✨ AI Live';
    const mode = window.PromptCamLiveAI?.getStatus?.().mode || '';
    return { source: 'live', mode, kind, text, detail: '' };
  }

  function takeDraft() {
    const take = document.querySelector('.take-director-card');
    const text = take?.querySelector('.take-director-card-text')?.textContent?.trim() || '';
    const kind = take?.querySelector('.take-director-card-title')?.textContent?.trim() || '🎬 AI Дубль';
    const detail = take?.querySelector('.take-director-card-anchor')?.textContent?.trim() || '';
    return { source: 'take', mode: 'take', kind, text, detail };
  }

  function createHeart(factory) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'creator-favorite-heart';
    button.textContent = '♡';
    button.setAttribute('aria-label', 'Добавить AI-подсказку в избранное');
    button._promptcamFavoriteFactory = factory;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(factory(), button);
    });
    favoriteButtons.add(button);
    return button;
  }

  function syncHeartButton(button) {
    if (!button?.isConnected) {
      favoriteButtons.delete(button);
      return;
    }
    const draft = button._promptcamFavoriteFactory?.();
    const saved = Boolean(draft?.text && existingFavorite(draft));
    button.classList.toggle('is-saved', saved);
    button.textContent = saved ? '♥' : '♡';
    button.setAttribute('aria-label', saved ? 'Убрать AI-подсказку из избранного' : 'Добавить AI-подсказку в избранное');
  }

  function syncHeartButtons() {
    for (const button of [...favoriteButtons]) syncHeartButton(button);
  }

  function decorateRecommendationCards() {
    const live = document.getElementById('liveAiSuggestion');
    const liveHead = live?.querySelector('.live-ai-suggestion-head');
    if (liveHead && !liveHead.querySelector('.creator-favorite-heart')) {
      const close = liveHead.querySelector('.live-ai-suggestion-close');
      const heart = createHeart(liveDraft);
      if (close) liveHead.insertBefore(heart, close);
      else liveHead.append(heart);
    }

    const take = document.querySelector('.take-director-card');
    const takeHead = take?.querySelector('.take-director-card-head');
    if (takeHead && !takeHead.querySelector('.creator-favorite-heart')) {
      const close = takeHead.querySelector('.take-director-card-close');
      const heart = createHeart(takeDraft);
      if (close) takeHead.insertBefore(heart, close);
      else takeHead.append(heart);
    }
    syncHeartButtons();
  }

  async function loadRemote() {
    if (!initData || state.loading) {
      if (!initData) setStatus('Готовые шаблоны работают здесь. Свои шаблоны и избранное синхронизируются внутри Telegram.');
      return;
    }
    state.loading = true;
    setStatus('Синхронизирую библиотеку…');
    try {
      const data = await api('list');
      state.templates = Array.isArray(data.templates) ? data.templates : [];
      state.favorites = Array.isArray(data.favorites) ? data.favorites : [];
      renderAll();
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
      setStatus('Сохранение своих шаблонов доступно внутри Telegram Mini App.', 'error');
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

  if (cameraView) {
    const observer = new MutationObserver(decorateRecommendationCards);
    observer.observe(cameraView, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }
  window.addEventListener('promptcam:creator-modules-ready', decorateRecommendationCards);
  window.addEventListener('promptcam:live-ai-state', decorateRecommendationCards);

  renderAll();
  setTab('templates');
  decorateRecommendationCards();
  loadRemote();

  window.PromptCamCreatorLibrary = Object.freeze({
    getTemplates: () => state.templates.map((item) => ({ ...item })),
    getFavorites: () => state.favorites.map((item) => ({ ...item })),
    getBuiltIns: () => BUILT_INS.map((item) => ({ ...item })),
    openFavorites: () => setTab('favorites'),
    refresh: loadRemote
  });
})();

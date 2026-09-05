(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const scriptInput = document.getElementById('scriptInput');
  const editorCard = scriptInput?.closest('.editor-card');
  if (!scriptInput || !editorCard) return;

  const BEATS_STORAGE_KEY = 'promptcam.script-beats.v1';
  const MAX_SCRIPT_CHARS = 12_000;
  const ACTIONS = [
    ['conversational', '🗣 Разговорнее', 'Чтобы текст легко звучал вслух'],
    ['shorter', '✂️ Короче', 'Убрать воду и повторы'],
    ['hook', '🎣 Усилить хук', 'Сильнее первые секунды'],
    ['prepare', '🎬 Подготовить к съёмке', 'Телесуфлёр + смысловые beats']
  ];

  let busy = false;
  let controller = null;
  let pending = null;
  let previousSnapshot = null;
  let suppressInput = false;

  const card = document.createElement('section');
  card.className = 'script-ai-card';
  card.setAttribute('aria-label', 'AI для сценария');

  const head = document.createElement('div');
  head.className = 'script-ai-head';
  const title = document.createElement('div');
  title.className = 'script-ai-title';
  const icon = document.createElement('span');
  icon.className = 'script-ai-icon';
  icon.textContent = '✨';
  const titleCopy = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = 'AI для сценария';
  const small = document.createElement('small');
  small.textContent = 'Подготовь текст именно к речи и съёмке';
  titleCopy.append(strong, small);
  title.append(icon, titleCopy);
  head.append(title);

  const actions = document.createElement('div');
  actions.className = 'script-ai-actions';
  const actionButtons = [];
  for (const [value, label, hint] of ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'script-ai-action';
    button.dataset.action = value;
    const labelNode = document.createElement('strong');
    labelNode.textContent = label;
    const hintNode = document.createElement('small');
    hintNode.textContent = hint;
    button.append(labelNode, hintNode);
    button.addEventListener('click', () => runAction(value));
    actions.append(button);
    actionButtons.push(button);
  }

  const status = document.createElement('p');
  status.className = 'script-ai-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = initData
    ? 'Выбери действие — сначала покажу preview, текст сам не заменяю.'
    : 'AI-редактор сейчас доступен внутри Telegram Mini App.';

  const preview = document.createElement('section');
  preview.className = 'script-ai-preview';
  preview.hidden = true;
  const previewHead = document.createElement('div');
  previewHead.className = 'script-ai-preview-head';
  const previewTitle = document.createElement('strong');
  previewTitle.textContent = 'Предпросмотр';
  const previewLatency = document.createElement('small');
  previewHead.append(previewTitle, previewLatency);
  const previewText = document.createElement('textarea');
  previewText.className = 'script-ai-preview-text';
  previewText.spellcheck = true;
  previewText.setAttribute('aria-label', 'AI версия сценария');
  const summary = document.createElement('p');
  summary.className = 'script-ai-summary';
  const previewBeats = document.createElement('div');
  previewBeats.className = 'script-ai-beats';
  previewBeats.hidden = true;
  const previewActions = document.createElement('div');
  previewActions.className = 'script-ai-preview-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'script-ai-cancel';
  cancel.textContent = 'Оставить как было';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'script-ai-apply';
  apply.textContent = 'Применить';
  cancel.addEventListener('click', closePreview);
  apply.addEventListener('click', applyPreview);
  previewActions.append(cancel, apply);
  preview.append(previewHead, previewText, summary, previewBeats, previewActions);

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'script-ai-undo';
  undo.textContent = '↩ Отменить последнее AI-изменение';
  undo.hidden = true;
  undo.addEventListener('click', undoLastApply);

  const savedBeats = document.createElement('section');
  savedBeats.className = 'script-ai-saved-beats';
  savedBeats.hidden = true;
  const savedLabel = document.createElement('small');
  savedLabel.textContent = 'Структура дубля';
  const savedBeatList = document.createElement('div');
  savedBeatList.className = 'script-ai-beats';
  savedBeats.append(savedLabel, savedBeatList);

  card.append(head, actions, status, preview, undo, savedBeats);
  editorCard.insertAdjacentElement('afterend', card);

  function setStatus(message, tone = '') {
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function setBusy(value) {
    busy = value;
    for (const button of actionButtons) button.disabled = value;
    apply.disabled = value;
    cancel.disabled = value;
  }

  function formatLatency(milliseconds) {
    const value = Number(milliseconds || 0);
    if (!value) return '';
    if (value < 1000) return `${Math.round(value)} мс`;
    return `${(value / 1000).toFixed(value < 2000 ? 1 : 0)} с`;
  }

  function actionLabel(action) {
    return ACTIONS.find(([value]) => value === action)?.[1] || 'AI';
  }

  function friendlyError(payload, response) {
    const error = payload?.error || '';
    if (response?.status === 429 || error === 'script_rate_limited') {
      const seconds = Math.max(2, Number(payload?.retryAfter || response?.headers?.get('Retry-After') || 10));
      return `Слишком много AI-правок подряд · попробуй через ${seconds} с.`;
    }
    if (response?.status === 401 || error === 'invalid_telegram_session') return 'Telegram-сессия устарела · переоткрой PromptCam.';
    if (error === 'script_too_long') return `Сценарий пока слишком длинный · максимум ${payload?.maxChars || MAX_SCRIPT_CHARS} символов.`;
    if (error === 'ai_not_configured') return 'AI временно не настроен на сервере.';
    if (error === 'script_invalid_response') return 'AI вернул неудачную версию · попробуй это действие ещё раз.';
    return 'Не удалось обработать сценарий · попробуй ещё раз.';
  }

  function fingerprint(text) {
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function readBeatPackage() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BEATS_STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.beats)) return null;
      if (parsed.scriptHash !== fingerprint(scriptInput.value)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function renderBeatList(target, beats) {
    target.textContent = '';
    const labels = {
      hook: '🎣',
      point: '•',
      demo: '👁',
      transition: '→',
      cta: '👉',
      other: '•'
    };
    for (const beat of beats || []) {
      const item = document.createElement('span');
      item.className = 'script-ai-beat';
      const beatTitle = document.createElement('b');
      beatTitle.textContent = `${labels[beat.kind] || '•'} ${beat.title || 'Beat'}`;
      const beatHint = document.createElement('span');
      beatHint.textContent = beat.required ? 'обязательно' : (beat.visualCue || beat.mustSay || 'опорная мысль');
      item.append(beatTitle, beatHint);
      target.append(item);
    }
  }

  function renderSavedBeats() {
    const pack = readBeatPackage();
    if (!pack?.beats?.length) {
      savedBeats.hidden = true;
      savedBeatList.textContent = '';
      return;
    }
    savedLabel.textContent = `Структура дубля · ${pack.beats.length} beats`;
    renderBeatList(savedBeatList, pack.beats);
    savedBeats.hidden = false;
  }

  function saveBeatPackage(beats, script, summaryText) {
    if (!Array.isArray(beats) || !beats.length) {
      try { localStorage.removeItem(BEATS_STORAGE_KEY); } catch (_) { /* Optional storage. */ }
      renderSavedBeats();
      return;
    }
    const pack = {
      version: 1,
      scriptHash: fingerprint(script),
      createdAt: Date.now(),
      summary: String(summaryText || '').slice(0, 180),
      beats: beats.slice(0, 14).map((beat) => ({
        kind: beat.kind,
        title: String(beat.title || '').slice(0, 80),
        anchor: String(beat.anchor || '').slice(0, 240),
        mustSay: String(beat.mustSay || '').slice(0, 260),
        visualCue: String(beat.visualCue || '').slice(0, 220),
        required: Boolean(beat.required)
      }))
    };
    try { localStorage.setItem(BEATS_STORAGE_KEY, JSON.stringify(pack)); } catch (_) { /* Optional storage. */ }
    renderSavedBeats();
  }

  async function runAction(action) {
    if (busy) return;
    const source = scriptInput.value.trim();
    if (!initData) {
      setStatus('AI-редактор сейчас доступен внутри Telegram Mini App.', 'error');
      return;
    }
    if (source.length < 8) {
      setStatus('Сначала напиши хотя бы одну нормальную фразу.', 'error');
      scriptInput.focus();
      return;
    }
    if (source.length > MAX_SCRIPT_CHARS) {
      setStatus(`Сценарий пока слишком длинный для AI · максимум ${MAX_SCRIPT_CHARS} символов.`, 'error');
      return;
    }

    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    closePreview(false);
    undo.hidden = true;
    setStatus(`${actionLabel(action)} · работаю…`);

    try {
      const response = await fetch('/api/ai/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, action, script: source }),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || typeof payload?.script !== 'string') {
        throw Object.assign(new Error('script_ai_failed'), { payload, response });
      }
      pending = {
        action,
        source,
        script: payload.script,
        summary: payload.summary || '',
        beats: Array.isArray(payload.beats) ? payload.beats : [],
        latencyMs: Number(payload?.latency?.totalMs || 0)
      };
      previewTitle.textContent = `${actionLabel(action)} · preview`;
      previewLatency.textContent = formatLatency(pending.latencyMs);
      previewText.value = pending.script;
      summary.textContent = pending.summary || 'Готово. Проверь версию перед применением.';
      if (pending.beats.length) {
        renderBeatList(previewBeats, pending.beats);
        previewBeats.hidden = false;
      } else {
        previewBeats.textContent = '';
        previewBeats.hidden = true;
      }
      preview.hidden = false;
      setStatus('Ничего не заменил · проверь preview и нажми «Применить».');
      previewText.focus({ preventScroll: true });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setStatus(friendlyError(error?.payload, error?.response), 'error');
    } finally {
      controller = null;
      setBusy(false);
    }
  }

  function closePreview(clearPending = true) {
    preview.hidden = true;
    previewBeats.hidden = true;
    previewBeats.textContent = '';
    if (clearPending) pending = null;
  }

  function applyPreview() {
    if (!pending || busy) return;
    const editedPreview = previewText.value.trim();
    if (!editedPreview) {
      setStatus('Preview пустой · оставляю исходный сценарий.', 'error');
      return;
    }

    let oldBeatsRaw = '';
    try { oldBeatsRaw = localStorage.getItem(BEATS_STORAGE_KEY) || ''; } catch (_) { /* Optional storage. */ }
    previousSnapshot = { script: scriptInput.value, beatsRaw: oldBeatsRaw };

    suppressInput = true;
    scriptInput.value = editedPreview;
    scriptInput.dispatchEvent(new Event('input', { bubbles: true }));
    suppressInput = false;

    const beatsStillMatchGeneratedText = editedPreview === pending.script;
    if (pending.action === 'prepare' && beatsStillMatchGeneratedText) {
      saveBeatPackage(pending.beats, editedPreview, pending.summary);
    } else {
      saveBeatPackage([], editedPreview, '');
    }

    const appliedAction = pending.action;
    const beatCount = pending.beats.length;
    closePreview();
    undo.hidden = false;
    setStatus(
      appliedAction === 'prepare' && beatCount
        ? `Применено · сохранил структуру дубля из ${beatCount} beats.`
        : 'Применено · сценарий уже сохранён редактором.',
      'success'
    );
    tg?.HapticFeedback?.notificationOccurred?.('success');
  }

  function undoLastApply() {
    if (!previousSnapshot) return;
    suppressInput = true;
    scriptInput.value = previousSnapshot.script;
    scriptInput.dispatchEvent(new Event('input', { bubbles: true }));
    suppressInput = false;
    try {
      if (previousSnapshot.beatsRaw) localStorage.setItem(BEATS_STORAGE_KEY, previousSnapshot.beatsRaw);
      else localStorage.removeItem(BEATS_STORAGE_KEY);
    } catch (_) { /* Optional storage. */ }
    previousSnapshot = null;
    undo.hidden = true;
    renderSavedBeats();
    setStatus('Вернул предыдущую версию сценария.', 'success');
  }

  scriptInput.addEventListener('input', () => {
    if (suppressInput) return;
    if (!preview.hidden) {
      closePreview();
      setStatus('Текст изменён вручную · старый AI preview сброшен.');
    }
    previousSnapshot = null;
    undo.hidden = true;
    const pack = readBeatPackage();
    if (!pack) {
      try { localStorage.removeItem(BEATS_STORAGE_KEY); } catch (_) { /* Optional storage. */ }
      renderSavedBeats();
    }
  });

  renderSavedBeats();

  window.PromptCamScriptAI = Object.freeze({
    getBeats: () => readBeatPackage()?.beats?.map((beat) => ({ ...beat })) || [],
    getBeatPackage: () => {
      const pack = readBeatPackage();
      return pack ? { ...pack, beats: pack.beats.map((beat) => ({ ...beat })) } : null;
    },
    clearBeats: () => saveBeatPackage([], scriptInput.value, ''),
    run: runAction,
    getStatus: () => ({
      busy,
      hasPreview: !preview.hidden,
      pendingAction: pending?.action || '',
      savedBeats: readBeatPackage()?.beats?.length || 0
    })
  });
})();

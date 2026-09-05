(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const panel = document.getElementById('liveAiPanel');
  const liveAiToggle = document.getElementById('liveAiToggle');
  const cameraView = document.getElementById('cameraView');
  const resultDialog = document.getElementById('resultDialog');
  const prompterText = document.getElementById('prompterText');
  const prompterScroller = document.getElementById('prompterScroller');
  const playPromptButton = document.getElementById('playPromptButton');
  const live = window.PromptCamLiveAI;
  if (!panel || !cameraView || !prompterText || !prompterScroller || !live) return;

  const SILENCE_HELP_MS = 5200;
  const SCRIPT_WINDOW_CHARS = 4000;
  const SCRIPT_BEFORE_CHARS = 1200;
  const SPEECH_MAX_CHARS = 1200;
  const CHECK_RETRY_MS = 320;
  const MAX_CHECK_RETRIES = 5;

  let enabled = false;
  let liveWasEnabled = false;
  let previousMode = 'crew';
  let previousRhythm = 'smart';
  let pendingReason = '';
  let lastHandledTranscriptAt = 0;
  let silenceTimer = 0;
  let retryTimer = 0;
  let checkRetries = 0;
  let block = null;
  let toggle = null;
  let toggleValue = null;
  let status = null;
  let card = null;
  let cardTitle = null;
  let cardText = null;
  let cardAnchor = null;
  let primaryAction = null;
  let secondaryAction = null;
  const upstreamFetch = window.fetch.bind(window);

  function injectStyles() {
    if (document.getElementById('promptcamTakeDirectorStyles')) return;
    const style = document.createElement('style');
    style.id = 'promptcamTakeDirectorStyles';
    style.textContent = `
      .take-director-block { margin-top: 9px; }
      .take-director-toggle {
        width: 100%; min-height: 52px; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 8px 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px;
        background: linear-gradient(145deg, rgba(255,255,255,.045), rgba(110,78,255,.055)); color: #fff; text-align: left;
      }
      .take-director-toggle > span { display: grid; gap: 3px; }
      .take-director-toggle strong { font-size: 11px; }
      .take-director-toggle small { color: #8f8a9d; font-size: 8.5px; line-height: 1.25; }
      .take-director-toggle > b { display: grid; min-width: 42px; height: 25px; place-items: center; border-radius: 999px; background: rgba(255,255,255,.08); color: #9791a5; font-size: 9px; letter-spacing: .08em; }
      .take-director-toggle[aria-pressed="true"] { border-color: rgba(139,101,255,.48); background: linear-gradient(145deg, rgba(103,70,255,.18), rgba(56,84,183,.11)); }
      .take-director-toggle[aria-pressed="true"] > b { background: linear-gradient(145deg, #7f59ff, #4a72ff); color: #fff; box-shadow: 0 0 16px rgba(108,77,255,.28); }
      .take-director-status { min-height: 17px; margin: 6px 2px 0; color: #9690a6; font-size: 8.5px; line-height: 1.35; }
      .take-director-status[data-tone="success"] { color: #91ddb0; }
      .take-director-status[data-tone="warning"] { color: #f5c87b; }
      .live-ai-panel[data-take-director="true"] #liveAiToggle,
      .live-ai-panel[data-take-director="true"] .live-ai-mode-label,
      .live-ai-panel[data-take-director="true"] .live-ai-modes,
      .live-ai-panel[data-take-director="true"] .live-ai-rhythm-label,
      .live-ai-panel[data-take-director="true"] .live-ai-rhythm,
      .live-ai-panel[data-take-director="true"] #liveAiStatus { display: none !important; }
      .take-director-card {
        position: absolute; z-index: 20; left: max(14px, var(--app-safe-left)); bottom: calc(128px + var(--app-safe-bottom));
        width: min(390px, calc(100vw - 104px - var(--app-safe-left) - var(--app-safe-right)));
        padding: 12px; border: 1px solid rgba(149,114,255,.4); border-radius: 18px;
        background: linear-gradient(145deg, rgba(24,19,40,.96), rgba(10,13,28,.94));
        box-shadow: 0 18px 48px rgba(0,0,0,.5), 0 0 30px rgba(103,68,255,.16); color: #fff;
        backdrop-filter: blur(18px) saturate(125%); -webkit-backdrop-filter: blur(18px) saturate(125%);
      }
      .take-director-card.hidden { display: none !important; }
      .take-director-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }
      .take-director-card-title { color:#c3b1ff; font-size:10px; font-weight:850; letter-spacing:.03em; }
      .take-director-card-close { width:25px; height:25px; border:0; border-radius:9px; background:rgba(255,255,255,.055); color:#aaa5b8; font-size:17px; }
      .take-director-card-text { margin:0 0 7px; color:#faf8ff; font-size:clamp(15px,4vw,18px); font-weight:720; line-height:1.28; }
      .take-director-card-anchor { margin:0 0 10px; padding:8px 9px; border-radius:11px; background:rgba(255,255,255,.055); color:#d9d3e7; font-size:11px; line-height:1.35; }
      .take-director-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
      .take-director-action { min-height:38px; border:1px solid rgba(255,255,255,.09); border-radius:11px; background:rgba(255,255,255,.05); color:#c8c2d4; font-size:10px; font-weight:760; }
      .take-director-action.primary { border-color:rgba(142,105,255,.45); background:linear-gradient(145deg, rgba(113,78,255,.28), rgba(63,83,180,.18)); color:#fff; }
    `;
    document.head.append(style);
  }

  function createUi() {
    if (block) return;
    injectStyles();
    block = document.createElement('div');
    block.className = 'take-director-block';

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'take-director-toggle';
    toggle.setAttribute('aria-pressed', 'false');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = '🎬 AI Дубль';
    const hint = document.createElement('small');
    hint.textContent = 'Слежу за сценарием и вмешиваюсь только если дубль страдает';
    copy.append(title, hint);
    toggleValue = document.createElement('b');
    toggleValue.textContent = 'OFF';
    toggle.append(copy, toggleValue);

    status = document.createElement('p');
    status.className = 'take-director-status';
    status.textContent = 'Включи перед записью — буду следить за дублем.';
    block.append(toggle, status);
    liveAiToggle?.after(block);
    toggle.addEventListener('click', () => setEnabled(!enabled));

    card = document.createElement('aside');
    card.className = 'take-director-card hidden';
    card.setAttribute('role', 'alert');
    card.setAttribute('aria-live', 'assertive');
    const head = document.createElement('div');
    head.className = 'take-director-card-head';
    cardTitle = document.createElement('span');
    cardTitle.className = 'take-director-card-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'take-director-card-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Скрыть подсказку режиссёра дубля');
    head.append(cardTitle, close);
    cardText = document.createElement('p');
    cardText.className = 'take-director-card-text';
    cardAnchor = document.createElement('p');
    cardAnchor.className = 'take-director-card-anchor';
    const actions = document.createElement('div');
    actions.className = 'take-director-actions';
    primaryAction = document.createElement('button');
    primaryAction.type = 'button';
    primaryAction.className = 'take-director-action primary';
    secondaryAction = document.createElement('button');
    secondaryAction.type = 'button';
    secondaryAction.className = 'take-director-action';
    secondaryAction.textContent = 'Оставить как есть';
    actions.append(primaryAction, secondaryAction);
    card.append(head, cardText, cardAnchor, actions);
    cameraView.append(card);
    close.addEventListener('click', hideCard);
    secondaryAction.addEventListener('click', hideCard);
  }

  function recording() {
    return cameraView.classList.contains('is-recording') && !resultDialog?.open;
  }

  function setTakeStatus(message, tone = '') {
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function render() {
    panel.dataset.takeDirector = String(enabled);
    toggle?.setAttribute('aria-pressed', String(enabled));
    if (toggleValue) toggleValue.textContent = enabled ? 'ON' : 'OFF';
    if (!enabled) delete panel.dataset.takeDirector;
  }

  async function setEnabled(value) {
    createUi();
    if (value === enabled) return true;
    if (value) {
      const current = live.getStatus?.() || {};
      liveWasEnabled = Boolean(current.enabled);
      previousMode = current.mode || 'crew';
      previousRhythm = current.rhythm || 'smart';
      enabled = true;
      render();
      if (!current.enabled) await live.setEnabled(true);
      live.setMode('crew');
      live.setRhythm('smart');
      setTakeStatus(recording() ? '🎬 Слежу за дублем · если всё хорошо, молчу.' : 'Готов. Нажми запись — начну следить за сценарием.', 'success');
      if (recording()) resetForNewTake();
      return true;
    }

    enabled = false;
    clearTimers();
    hideCard();
    render();
    live.setMode(previousMode);
    live.setRhythm(previousRhythm);
    if (!liveWasEnabled) await live.setEnabled(false);
    setTakeStatus('AI Дубль выключен.');
    return true;
  }

  function clearTimers() {
    window.clearTimeout(silenceTimer);
    window.clearTimeout(retryTimer);
    silenceTimer = 0;
    retryTimer = 0;
    pendingReason = '';
    checkRetries = 0;
  }

  function resetForNewTake() {
    clearTimers();
    hideCard();
    lastHandledTranscriptAt = 0;
    try { window.PromptCamSpeechContext?.reset?.(); } catch (_) { /* Optional. */ }
    window.setTimeout(() => {
      try { window.PromptCamSpeechContext?.start?.(); } catch (_) { /* Optional. */ }
    }, 100);
    setTakeStatus('🎬 Дубль идёт · слушаю текст и молчу, пока всё нормально.', 'success');
  }

  function recentSpeech() {
    try {
      const context = window.PromptCamSpeechContext?.getContext?.();
      const text = typeof context?.text === 'string'
        ? context.text.replace(/\s+/g, ' ').trim().slice(-SPEECH_MAX_CHARS)
        : '';
      const spanMs = Math.max(0, Math.min(35_000, Math.round(Number(context?.spanMs || 0))));
      return { text, spanMs };
    } catch (_) {
      return { text: '', spanMs: 0 };
    }
  }

  function scriptWindow() {
    const script = String(prompterText.textContent || '');
    const maxScroll = Math.max(1, prompterScroller.scrollHeight - prompterScroller.clientHeight);
    const progress = Math.max(0, Math.min(1, prompterScroller.scrollTop / maxScroll));
    const approximate = Math.round(progress * script.length);
    let start = Math.max(0, approximate - SCRIPT_BEFORE_CHARS);
    let end = Math.min(script.length, start + SCRIPT_WINDOW_CHARS);
    if (end - start < SCRIPT_WINDOW_CHARS) start = Math.max(0, end - SCRIPT_WINDOW_CHARS);
    return {
      text: script.slice(start, end),
      windowStart: start,
      scriptLength: script.length,
      progress: Number(progress.toFixed(3))
    };
  }

  function scheduleCheck(reason, delay = 80) {
    if (!enabled || !recording()) return;
    pendingReason = reason;
    checkRetries = 0;
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(runCheck, delay);
  }

  function runCheck() {
    retryTimer = 0;
    if (!enabled || !recording() || !pendingReason) return;
    const current = live.getStatus?.() || {};
    if (current.busy) {
      if (checkRetries < MAX_CHECK_RETRIES) {
        checkRetries += 1;
        retryTimer = window.setTimeout(runCheck, CHECK_RETRY_MS);
      }
      return;
    }
    live.requestNow?.();
  }

  function scheduleSilenceHelp(transcriptAt) {
    window.clearTimeout(silenceTimer);
    if (!enabled || !recording() || !transcriptAt) return;
    silenceTimer = window.setTimeout(() => {
      const speech = window.PromptCamSpeechContext?.getStatus?.() || {};
      if (!enabled || !recording() || speech.speaking || speech.transcribing) return;
      if (Number(speech.lastTranscriptAt || 0) !== transcriptAt) return;
      scheduleCheck('silence', 0);
    }, SILENCE_HELP_MS);
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

  function fakeNoneResponse(latency = 0) {
    return new Response(JSON.stringify({
      ok: true,
      action: 'none',
      type: 'none',
      text: '',
      scene: '',
      latency: { totalMs: latency, providerMs: 0 },
      rateLimit: { remaining: 99 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  async function takeFetch(input, init = {}) {
    if (!enabled || !recording() || !isLiveAiRequest(input) || typeof init?.body !== 'string') {
      return upstreamFetch(input, init);
    }
    if (!pendingReason) return fakeNoneResponse();

    let payload;
    try { payload = JSON.parse(init.body); }
    catch (_) { return upstreamFetch(input, init); }

    const speech = recentSpeech();
    if (!speech.text) {
      pendingReason = '';
      return fakeNoneResponse();
    }

    const reason = pendingReason;
    pendingReason = '';
    const script = scriptWindow();
    payload.mode = 'take';
    payload.takeDirector = {
      reason,
      speechText: speech.text,
      speechSpanMs: speech.spanMs,
      scriptWindow: script.text,
      windowStart: script.windowStart,
      scriptLength: script.scriptLength,
      progress: script.progress
    };
    delete payload.frame;
    delete payload.temporalFrames;
    delete payload.history;
    delete payload.scriptContext;
    delete payload.presentationStyle;
    delete payload.speechContext;

    const response = await upstreamFetch(input, { ...init, body: JSON.stringify(payload) });
    if (!response.ok) {
      setTakeStatus('Не смог проверить эту фразу · продолжаю слушать.', 'warning');
      return response;
    }

    const data = await response.clone().json().catch(() => null);
    const take = data?.takeDirector;
    if (take) handleTakeResult(take, data?.latency);

    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify({
      ok: true,
      action: 'none',
      type: 'none',
      text: '',
      scene: '',
      latency: data?.latency || { totalMs: 0, providerMs: 0 },
      rateLimit: data?.rateLimit || { remaining: 0 }
    }), { status: 200, headers });
  }

  function titleForStatus(value) {
    if (value === 'repeat') return '🎬 Ещё один дубль этой фразы';
    if (value === 'off_script') return '🎬 Вернись к сценарию';
    if (value === 'help') return '🎬 Подхватываю';
    if (value === 'continue') return '🎬 Продолжай отсюда';
    return '🎬 AI Дубль';
  }

  function actionForStatus(value) {
    if (value === 'repeat') return '↩ Повторить';
    if (value === 'off_script') return '↩ Вернуться';
    return '→ Продолжить';
  }

  function handleTakeResult(result, latency) {
    if (!enabled || !recording()) return;
    if (result.action !== 'assist') {
      const ms = Number(latency?.totalMs || 0);
      setTakeStatus(ms ? `✓ По плану · проверка ${(ms / 1000).toFixed(ms < 2000 ? 1 : 0)} с` : '✓ По плану', 'success');
      return;
    }

    const anchor = typeof result.anchor === 'string' ? result.anchor.trim() : '';
    cardTitle.textContent = titleForStatus(result.status);
    cardText.textContent = typeof result.text === 'string' && result.text.trim()
      ? result.text.trim()
      : 'Здесь лучше быстро поправить дубль.';
    cardAnchor.textContent = anchor ? `«${anchor}»` : 'Вернись к ближайшей опорной фразе сценария.';
    cardAnchor.hidden = !anchor;
    primaryAction.textContent = actionForStatus(result.status);
    primaryAction.onclick = () => {
      if (anchor) jumpToAnchor(anchor);
      hideCard();
      setTakeStatus('Суфлёр поставлен к нужной фразе.', 'success');
    };
    card.classList.remove('hidden');
    setTakeStatus('Нужна маленькая правка дубля.', 'warning');
    try {
      tg?.HapticFeedback?.impactOccurred(result.status === 'repeat' || result.status === 'off_script' ? 'medium' : 'light');
    } catch (_) { /* Telegram haptics are optional. */ }
  }

  function hideCard() {
    card?.classList.add('hidden');
  }

  function pausePrompterIfRunning() {
    if (playPromptButton?.getAttribute('aria-label') === 'Поставить суфлёр на паузу') {
      playPromptButton.click();
    }
  }

  function findAnchorOffset(script, anchor) {
    const direct = script.indexOf(anchor);
    if (direct >= 0) return direct;
    const lower = script.toLocaleLowerCase();
    const lowerAnchor = anchor.toLocaleLowerCase();
    const insensitive = lower.indexOf(lowerAnchor);
    if (insensitive >= 0) return insensitive;
    const words = anchor.replace(/[«»"“”.,!?;:—–-]/g, ' ').split(/\s+/u).filter(Boolean).slice(0, 7);
    if (words.length < 3) return -1;
    const needle = words.join(' ').toLocaleLowerCase();
    const normalizedScript = script.replace(/\s+/g, ' ').toLocaleLowerCase();
    const normalizedIndex = normalizedScript.indexOf(needle);
    if (normalizedIndex < 0) return -1;
    const prefix = normalizedScript.slice(0, normalizedIndex);
    const ratio = prefix.length / Math.max(1, normalizedScript.length);
    return Math.round(ratio * script.length);
  }

  function locateTextPosition(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let node = walker.nextNode();
    while (node) {
      if (remaining <= node.data.length) return { node, offset: remaining };
      remaining -= node.data.length;
      node = walker.nextNode();
    }
    return null;
  }

  function jumpToAnchor(anchor) {
    const script = String(prompterText.textContent || '');
    const offset = findAnchorOffset(script, anchor);
    if (offset < 0) return false;
    pausePrompterIfRunning();

    const position = locateTextPosition(prompterText, offset);
    if (position) {
      try {
        const range = document.createRange();
        const end = Math.min(position.node.data.length, position.offset + 1);
        range.setStart(position.node, position.offset);
        range.setEnd(position.node, end);
        const rect = range.getBoundingClientRect();
        const scrollerRect = prompterScroller.getBoundingClientRect();
        if (Number.isFinite(rect.top)) {
          const target = prompterScroller.scrollTop + rect.top - scrollerRect.top - prompterScroller.clientHeight * 0.42;
          const maximum = Math.max(0, prompterScroller.scrollHeight - prompterScroller.clientHeight);
          prompterScroller.scrollTo({ top: Math.max(0, Math.min(maximum, target)), behavior: 'smooth' });
          return true;
        }
      } catch (_) { /* Fall back to ratio positioning. */ }
    }

    const ratio = offset / Math.max(1, script.length);
    const maximum = Math.max(0, prompterScroller.scrollHeight - prompterScroller.clientHeight);
    prompterScroller.scrollTo({ top: maximum * ratio, behavior: 'smooth' });
    return true;
  }

  function onSpeechState(event) {
    if (!enabled || !recording()) return;
    const detail = event.detail || {};
    if (detail.speaking || detail.transcribing) window.clearTimeout(silenceTimer);
    const transcriptAt = Number(detail.lastTranscriptAt || 0);
    if (transcriptAt > lastHandledTranscriptAt && detail.lastText) {
      lastHandledTranscriptAt = transcriptAt;
      scheduleCheck('speech');
      scheduleSilenceHelp(transcriptAt);
    }
  }

  function onCameraClassChanged() {
    if (!enabled) return;
    if (recording()) resetForNewTake();
    else {
      clearTimers();
      hideCard();
      setTakeStatus('Дубль закончен. Следующий начну с чистой памятью.');
    }
  }

  window.fetch = takeFetch;
  window.addEventListener('promptcam:speech-context', onSpeechState);
  if (cameraView) {
    let wasRecording = recording();
    const observer = new MutationObserver(() => {
      const nowRecording = recording();
      if (nowRecording === wasRecording) return;
      wasRecording = nowRecording;
      onCameraClassChanged();
    });
    observer.observe(cameraView, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('pagehide', clearTimers);

  createUi();
  render();

  window.PromptCamTakeDirector = Object.freeze({
    isEnabled: () => enabled,
    setEnabled,
    jumpToAnchor,
    getStatus: () => ({
      enabled,
      recording: recording(),
      pendingReason,
      lastHandledTranscriptAt
    })
  });
})();

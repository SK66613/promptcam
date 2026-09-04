(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const cameraView = document.getElementById('cameraView');
  const cameraVideo = document.getElementById('cameraVideo');
  const liveAiButton = document.getElementById('liveAiButton');
  const liveAiPanel = document.getElementById('liveAiPanel');
  const liveAiPanelClose = document.getElementById('liveAiPanelClose');
  const liveAiToggle = document.getElementById('liveAiToggle');
  const liveAiToggleValue = document.getElementById('liveAiToggleValue');
  const liveAiStatus = document.getElementById('liveAiStatus');
  const modeButtons = [...document.querySelectorAll('[data-live-ai-mode]')];
  const cameraSettingsToggle = document.getElementById('cameraSettingsToggle');
  const cameraSettings = document.getElementById('cameraSettings');
  const switchCameraButton = document.getElementById('switchCameraButton');
  const backButton = document.getElementById('backButton');

  const MODE_STORAGE_KEY = 'promptcam.live-ai.mode.v1';
  const VALID_MODES = new Set(['jokes', 'director', 'ideas', 'hooks']);
  const CAPTURE_MAX_EDGE = 384;
  const CAPTURE_QUALITY = 0.62;
  const SAMPLE_WIDTH = 32;
  const SAMPLE_HEIGHT = 24;
  const SAMPLE_INTERVAL_MS = 220;
  const NETWORK_MIN_INTERVAL_MS = 1200;
  const SUGGESTION_MIN_INTERVAL_MS = 2200;
  const SUGGESTION_VISIBLE_MS = 5500;
  const PIXEL_CHANGE_THRESHOLD = 24;
  const MEAN_CHANGE_THRESHOLD = 10;
  const CHANGED_RATIO_THRESHOLD = 0.16;
  const MAJOR_CHANGE_THRESHOLD = 24;

  const state = {
    enabled: false,
    mode: readStoredMode(),
    busy: false,
    running: false,
    lastFrameAt: 0,
    lastRequestAt: 0,
    lastSuggestionAt: 0,
    lastSceneScore: 0,
    lastLatencyMs: 0,
    frameSequence: 0,
    sceneVersion: 0,
    pendingSceneChange: false,
    backoffUntil: 0
  };

  const captureCanvas = document.createElement('canvas');
  const captureContext = captureCanvas.getContext('2d', {
    alpha: false,
    desynchronized: true
  });
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = SAMPLE_WIDTH;
  sampleCanvas.height = SAMPLE_HEIGHT;
  const sampleContext = sampleCanvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true
  });

  let previousSample = null;
  let sampleTimer = 0;
  let suggestionTimer = 0;
  let activeController = null;
  let suggestionCard = null;
  let suggestionType = null;
  let suggestionText = null;

  function readStoredMode() {
    try {
      const value = localStorage.getItem(MODE_STORAGE_KEY) || '';
      return VALID_MODES.has(value) ? value : 'jokes';
    } catch (_) {
      return 'jokes';
    }
  }

  function storeMode(mode) {
    try { localStorage.setItem(MODE_STORAGE_KEY, mode); }
    catch (_) { /* Storage is optional in private browsing. */ }
  }

  function upgradeFoundationCopy() {
    const badge = liveAiPanel?.querySelector('.live-ai-badge');
    const copy = liveAiPanel?.querySelector('.live-ai-copy');
    const toggleHint = liveAiToggle?.querySelector('small');
    const modeLabel = liveAiPanel?.querySelector('.live-ai-mode-label');
    if (badge) badge.textContent = 'BETA';
    if (copy) copy.textContent = 'PromptCam сравнивает кадры локально и отправляет компактный кадр в AI только при заметном изменении сцены.';
    if (toggleHint) toggleHint.textContent = 'Быстрые адаптивные подсказки';
    if (modeLabel) modeLabel.textContent = 'РЕЖИМ';
  }

  function ensureSuggestionCard() {
    if (!cameraView || suggestionCard) return;
    const card = document.createElement('aside');
    card.id = 'liveAiSuggestion';
    card.className = 'live-ai-suggestion hidden';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'live-ai-suggestion-head';
    const type = document.createElement('span');
    type.className = 'live-ai-suggestion-type';
    type.textContent = '✨ AI Live';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'live-ai-suggestion-close';
    close.setAttribute('aria-label', 'Скрыть AI подсказку');
    close.textContent = '×';
    header.append(type, close);

    const text = document.createElement('p');
    text.className = 'live-ai-suggestion-text';
    card.append(header, text);
    cameraView.append(card);

    close.addEventListener('click', hideSuggestion);
    suggestionCard = card;
    suggestionType = type;
    suggestionText = text;
  }

  function setStatus(message, tone = '') {
    if (!liveAiStatus) return;
    liveAiStatus.textContent = message;
    if (tone) liveAiStatus.dataset.tone = tone;
    else delete liveAiStatus.dataset.tone;
  }

  function formatLatency(milliseconds) {
    const value = Number(milliseconds || 0);
    if (!value) return '';
    if (value < 1000) return `${Math.round(value)} мс`;
    return `${(value / 1000).toFixed(value < 2000 ? 1 : 0)} с`;
  }

  function render() {
    liveAiButton?.classList.toggle('is-active', state.enabled);
    liveAiButton?.setAttribute('data-active', String(state.enabled));
    liveAiToggle?.setAttribute('aria-pressed', String(state.enabled));
    if (liveAiToggleValue) liveAiToggleValue.textContent = state.enabled ? 'ON' : 'OFF';

    for (const button of modeButtons) {
      const selected = button.dataset.liveAiMode === state.mode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  function emitState() {
    window.dispatchEvent(new CustomEvent('promptcam:live-ai-state', {
      detail: getStatus()
    }));
  }

  function getStatus() {
    return {
      enabled: state.enabled,
      mode: state.mode,
      busy: state.busy,
      running: state.running,
      lastFrameAt: state.lastFrameAt,
      lastRequestAt: state.lastRequestAt,
      lastSuggestionAt: state.lastSuggestionAt,
      lastSceneScore: state.lastSceneScore,
      lastLatencyMs: state.lastLatencyMs,
      frameSequence: state.frameSequence,
      sceneVersion: state.sceneVersion,
      pendingSceneChange: state.pendingSceneChange,
      backoffUntil: state.backoffUntil
    };
  }

  function closeCameraSettings() {
    if (cameraSettingsToggle) cameraSettingsToggle.setAttribute('aria-expanded', 'false');
    if (cameraSettings) cameraSettings.hidden = true;
  }

  function openPanel() {
    if (!liveAiPanel) return;
    closeCameraSettings();
    liveAiPanel.hidden = false;
    liveAiButton?.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    if (!liveAiPanel) return;
    liveAiPanel.hidden = true;
    liveAiButton?.setAttribute('aria-expanded', 'false');
  }

  function frameDimensions(videoWidth, videoHeight, maxEdge = CAPTURE_MAX_EDGE) {
    const longestEdge = Math.max(videoWidth, videoHeight);
    const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;
    return {
      width: Math.max(1, Math.round(videoWidth * scale)),
      height: Math.max(1, Math.round(videoHeight * scale))
    };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('frame_encode_failed'));
      }, type, quality);
    });
  }

  async function captureFrame(options = {}) {
    if (!cameraVideo || !captureContext) throw new Error('camera_capture_unavailable');
    if (cameraVideo.readyState < 2) throw new Error('camera_not_ready');

    const sourceWidth = Number(cameraVideo.videoWidth || 0);
    const sourceHeight = Number(cameraVideo.videoHeight || 0);
    if (!sourceWidth || !sourceHeight) throw new Error('camera_dimensions_unavailable');

    const maxEdge = Math.min(960, Math.max(256, Number(options.maxEdge) || CAPTURE_MAX_EDGE));
    const quality = Math.min(0.9, Math.max(0.45, Number(options.quality) || CAPTURE_QUALITY));
    const type = options.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const dimensions = frameDimensions(sourceWidth, sourceHeight, maxEdge);

    captureCanvas.width = dimensions.width;
    captureCanvas.height = dimensions.height;
    captureContext.drawImage(cameraVideo, 0, 0, dimensions.width, dimensions.height);

    const blob = await canvasToBlob(captureCanvas, type, quality);
    state.frameSequence += 1;
    state.lastFrameAt = Date.now();

    return {
      blob,
      bytes: blob.size,
      mimeType: blob.type || type,
      width: dimensions.width,
      height: dimensions.height,
      sourceWidth,
      sourceHeight,
      capturedAt: state.lastFrameAt,
      sequence: state.frameSequence
    };
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true });
      reader.addEventListener('error', () => reject(new Error('frame_read_failed')), { once: true });
      reader.readAsDataURL(blob);
    });
  }

  function sampleScene() {
    if (!cameraVideo || !sampleContext || cameraVideo.readyState < 2) return null;
    if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) return null;
    sampleContext.drawImage(cameraVideo, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const pixels = sampleContext.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
    const sample = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
    for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
      sample[target] = Math.round((pixels[source] * 3 + pixels[source + 1] * 6 + pixels[source + 2]) / 10);
    }
    return sample;
  }

  function sceneDifference(previous, current) {
    if (!previous || !current || previous.length !== current.length) {
      return { mean: 255, changedRatio: 1, changed: true };
    }

    let total = 0;
    let changedPixels = 0;
    for (let index = 0; index < current.length; index += 1) {
      const difference = Math.abs(current[index] - previous[index]);
      total += difference;
      if (difference >= PIXEL_CHANGE_THRESHOLD) changedPixels += 1;
    }
    const mean = total / current.length;
    const changedRatio = changedPixels / current.length;
    const changed = mean >= MAJOR_CHANGE_THRESHOLD || (
      mean >= MEAN_CHANGE_THRESHOLD && changedRatio >= CHANGED_RATIO_THRESHOLD
    );
    return { mean, changedRatio, changed };
  }

  function modeLabel(type) {
    if (type === 'director') return '🎬 Режиссёр';
    if (type === 'idea') return '💡 Идея';
    if (type === 'hook') return '🎣 Хук';
    if (type === 'joke') return '😄 Шутка';
    return '✨ AI Live';
  }

  function hideSuggestion() {
    window.clearTimeout(suggestionTimer);
    suggestionTimer = 0;
    suggestionCard?.classList.add('hidden');
  }

  function showSuggestion(result) {
    ensureSuggestionCard();
    if (!suggestionCard || !suggestionText || !suggestionType) return;
    suggestionType.textContent = modeLabel(result.type);
    suggestionText.textContent = result.text;
    suggestionCard.classList.remove('hidden');
    window.clearTimeout(suggestionTimer);
    suggestionTimer = window.setTimeout(hideSuggestion, SUGGESTION_VISIBLE_MS);
    try { tg?.HapticFeedback?.impactOccurred('light'); }
    catch (_) { /* Telegram haptics are optional. */ }
  }

  async function postLiveAi(frameDataUrl, signal) {
    const response = await fetch('/api/ai/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, mode: state.mode, frame: frameDataUrl }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || 'ai_request_failed');
      error.status = response.status;
      error.retryAfter = Number(payload.retryAfter || response.headers.get('Retry-After') || 0);
      throw error;
    }
    return payload;
  }

  function stopAdaptiveLoop({ abort = true } = {}) {
    window.clearTimeout(sampleTimer);
    sampleTimer = 0;
    state.running = false;
    state.pendingSceneChange = false;
    previousSample = null;
    if (abort && activeController) activeController.abort();
    activeController = null;
  }

  function scheduleAdaptiveTick(delay = SAMPLE_INTERVAL_MS) {
    if (!state.enabled || sampleTimer) return;
    state.running = true;
    sampleTimer = window.setTimeout(adaptiveTick, Math.max(0, delay));
  }

  function disableWithStatus(message, tone = 'error') {
    state.enabled = false;
    state.busy = false;
    stopAdaptiveLoop();
    hideSuggestion();
    render();
    setStatus(message, tone);
    emitState();
  }

  function handleRequestError(error) {
    if (error?.name === 'AbortError') return;
    const now = Date.now();
    if (error?.status === 429) {
      const retrySeconds = Math.max(2, Number(error.retryAfter || 5));
      state.backoffUntil = now + retrySeconds * 1000;
      setStatus(`AI сделал короткую паузу · ${retrySeconds} с`, 'error');
      return;
    }
    if (error?.message === 'ai_not_configured') {
      disableWithStatus('AI Live ещё не подключён к серверному API key.');
      return;
    }
    if (error?.message === 'ai_database_not_initialized') {
      disableWithStatus('Для AI Live ещё не применена D1 migration.');
      return;
    }
    if (error?.status === 401 || error?.message?.includes('init_data')) {
      disableWithStatus('Telegram-сессия устарела. Закрой и снова открой PromptCam.');
      return;
    }
    state.backoffUntil = now + 2500;
    setStatus('AI временно не ответил. Продолжаю наблюдать локально…', 'error');
  }

  async function requestSuggestion({ force = false } = {}) {
    if (!state.enabled || state.busy || document.hidden) return false;
    if (!initData) {
      disableWithStatus('AI Live сейчас доступен внутри Telegram Mini App.');
      return false;
    }

    const now = Date.now();
    if (now < state.backoffUntil) return false;
    if (!force && now - state.lastRequestAt < NETWORK_MIN_INTERVAL_MS) return false;
    if (!force && state.lastSuggestionAt && now - state.lastSuggestionAt < SUGGESTION_MIN_INTERVAL_MS) return false;

    const requestSceneVersion = state.sceneVersion;
    const requestStartedAt = Date.now();
    state.busy = true;
    state.pendingSceneChange = false;
    state.lastRequestAt = now;
    activeController = new AbortController();
    render();
    emitState();

    try {
      const frame = await captureFrame();
      if (!state.enabled) return false;
      const frameDataUrl = await blobToDataUrl(frame.blob);
      if (!state.enabled) return false;
      const result = await postLiveAi(frameDataUrl, activeController.signal);
      if (!state.enabled) return false;

      state.lastLatencyMs = Number(result?.latency?.totalMs || (Date.now() - requestStartedAt));

      if (state.sceneVersion !== requestSceneVersion && state.pendingSceneChange) {
        setStatus(`Сцена уже изменилась · обновляю контекст · ${formatLatency(state.lastLatencyMs)}`);
        return false;
      }

      if (result.action === 'suggest' && typeof result.text === 'string' && result.text.trim()) {
        state.lastSuggestionAt = Date.now();
        showSuggestion(result);
        setStatus(`AI Live · ответ ${formatLatency(state.lastLatencyMs)}`, 'success');
      } else {
        setStatus(`AI Live наблюдает · ${formatLatency(state.lastLatencyMs)}`);
      }
      return true;
    } catch (error) {
      handleRequestError(error);
      return false;
    } finally {
      state.busy = false;
      activeController = null;
      render();
      emitState();
      if (state.enabled && state.pendingSceneChange) scheduleAdaptiveTick(40);
    }
  }

  function adaptiveTick() {
    sampleTimer = 0;
    if (!state.enabled) {
      state.running = false;
      return;
    }
    if (document.hidden || cameraView?.classList.contains('hidden')) {
      scheduleAdaptiveTick(700);
      return;
    }

    let currentSample = null;
    try { currentSample = sampleScene(); }
    catch (_) { /* A transient camera frame can fail during switching. */ }

    if (currentSample) {
      if (!previousSample) {
        previousSample = currentSample;
        state.lastSceneScore = 0;
      } else {
        const difference = sceneDifference(previousSample, currentSample);
        previousSample = currentSample;
        state.lastSceneScore = Number(difference.mean.toFixed(2));
        if (difference.changed) {
          state.sceneVersion += 1;
          state.pendingSceneChange = true;
        }
      }
    }

    if (state.pendingSceneChange && !state.busy) requestSuggestion();
    scheduleAdaptiveTick();
  }

  function startAdaptiveLoop() {
    stopAdaptiveLoop({ abort: false });
    state.pendingSceneChange = false;
    state.backoffUntil = 0;
    scheduleAdaptiveTick(60);
  }

  async function setEnabled(enabled) {
    if (!enabled) {
      state.enabled = false;
      state.busy = false;
      stopAdaptiveLoop();
      hideSuggestion();
      render();
      setStatus('AI Live выключен. Локальный анализ остановлен.');
      emitState();
      return;
    }

    if (!initData || !tg) {
      disableWithStatus('AI Live сейчас доступен внутри Telegram Mini App.');
      return;
    }

    state.enabled = true;
    previousSample = null;
    state.pendingSceneChange = false;
    render();
    setStatus('AI Live готов · измени сцену, чтобы получить реакцию');
    emitState();
    startAdaptiveLoop();
  }

  function setMode(mode) {
    if (!VALID_MODES.has(mode)) return false;
    state.mode = mode;
    storeMode(mode);
    previousSample = null;
    state.pendingSceneChange = false;
    hideSuggestion();
    render();
    if (state.enabled) setStatus('Режим изменён · жду следующего изменения сцены');
    emitState();
    if (state.enabled) scheduleAdaptiveTick(40);
    return true;
  }

  function requestNow() {
    if (!state.enabled) return false;
    state.sceneVersion += 1;
    state.pendingSceneChange = true;
    requestSuggestion({ force: true });
    return true;
  }

  function resetForCameraExit() {
    state.enabled = false;
    state.busy = false;
    stopAdaptiveLoop();
    closePanel();
    hideSuggestion();
    render();
    setStatus('AI Live выключен. Локальный анализ остановлен.');
    emitState();
  }

  liveAiButton?.addEventListener('click', () => {
    if (liveAiPanel?.hidden) openPanel();
    else closePanel();
  });

  liveAiPanelClose?.addEventListener('click', closePanel);
  liveAiToggle?.addEventListener('click', () => setEnabled(!state.enabled));

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.liveAiMode || ''));
  }

  cameraSettingsToggle?.addEventListener('click', closePanel, { capture: true });
  switchCameraButton?.addEventListener('click', () => {
    previousSample = null;
    state.pendingSceneChange = false;
  }, { capture: true });
  backButton?.addEventListener('click', resetForCameraExit, { capture: true });
  window.addEventListener('pagehide', resetForCameraExit);
  document.addEventListener('visibilitychange', () => {
    if (!state.enabled) return;
    if (document.hidden) {
      window.clearTimeout(sampleTimer);
      sampleTimer = 0;
      state.running = false;
    } else {
      previousSample = null;
      state.pendingSceneChange = false;
      scheduleAdaptiveTick(80);
    }
  });

  if (cameraView) {
    const observer = new MutationObserver(() => {
      if (cameraView.classList.contains('is-recording')) closePanel();
      if (!cameraView.classList.contains('hidden') && state.enabled) scheduleAdaptiveTick(70);
    });
    observer.observe(cameraView, { attributes: true, attributeFilter: ['class'] });
  }

  window.PromptCamLiveAI = Object.freeze({
    state,
    captureFrame,
    setEnabled,
    setMode,
    requestNow,
    openPanel,
    closePanel,
    resetForCameraExit,
    getStatus
  });

  upgradeFoundationCopy();
  ensureSuggestionCard();
  render();
})();

(() => {
  'use strict';

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
  const backButton = document.getElementById('backButton');

  const MODE_STORAGE_KEY = 'promptcam.live-ai.mode.v1';
  const VALID_MODES = new Set(['jokes', 'director', 'ideas', 'hooks']);
  const CAPTURE_MAX_EDGE = 512;
  const CAPTURE_QUALITY = 0.72;

  const state = {
    enabled: false,
    mode: readStoredMode(),
    busy: false,
    lastFrameAt: 0,
    lastSuggestionAt: 0,
    frameSequence: 0
  };

  const captureCanvas = document.createElement('canvas');
  const captureContext = captureCanvas.getContext('2d', {
    alpha: false,
    desynchronized: true
  });

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

  function setStatus(message, tone = '') {
    if (!liveAiStatus) return;
    liveAiStatus.textContent = message;
    if (tone) liveAiStatus.dataset.tone = tone;
    else delete liveAiStatus.dataset.tone;
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
      lastFrameAt: state.lastFrameAt,
      lastSuggestionAt: state.lastSuggestionAt,
      frameSequence: state.frameSequence
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
    if (cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error('camera_not_ready');

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

  async function localCaptureSmokeTest() {
    if (state.busy) return;
    state.busy = true;
    render();
    setStatus('Проверяем локальный кадр…');
    try {
      const frame = await captureFrame();
      const kilobytes = Math.max(1, Math.round(frame.bytes / 1024));
      setStatus(`Локальный кадр готов · ${frame.width}×${frame.height} · ~${kilobytes} КБ`, 'success');
    } catch (_) {
      setStatus('Камера ещё не готова к кадру. Открой её и попробуй включить AI Live снова.', 'error');
    } finally {
      state.busy = false;
      render();
      emitState();
    }
  }

  async function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    render();
    emitState();

    if (!state.enabled) {
      setStatus('AI Live выключен. Кадры никуда не отправляются.');
      return;
    }

    setStatus('Foundation активен. Кадры остаются на устройстве — сети пока нет.');
    await localCaptureSmokeTest();
  }

  function setMode(mode) {
    if (!VALID_MODES.has(mode)) return false;
    state.mode = mode;
    storeMode(mode);
    render();
    emitState();
    return true;
  }

  function resetForCameraExit() {
    state.enabled = false;
    state.busy = false;
    closePanel();
    render();
    setStatus('AI Live выключен. Кадры никуда не отправляются.');
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
  backButton?.addEventListener('click', resetForCameraExit, { capture: true });
  window.addEventListener('pagehide', resetForCameraExit);

  if (cameraView) {
    const observer = new MutationObserver(() => {
      if (cameraView.classList.contains('is-recording')) closePanel();
    });
    observer.observe(cameraView, { attributes: true, attributeFilter: ['class'] });
  }

  window.PromptCamLiveAI = Object.freeze({
    state,
    captureFrame,
    setEnabled,
    setMode,
    openPanel,
    closePanel,
    resetForCameraExit,
    getStatus
  });

  render();
})();

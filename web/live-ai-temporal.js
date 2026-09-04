(() => {
  'use strict';

  const cameraVideo = document.getElementById('cameraVideo');
  const TEMPORAL_MODES = new Set(['crew', 'acting']);
  const SAMPLE_INTERVAL_MS = 5000;
  const WINDOW_MS = 16000;
  const MAX_FRAMES = 3;
  const MIN_FRAME_AGE_MS = 1500;
  const MAX_EDGE = 256;
  const JPEG_QUALITY = 0.5;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const frames = [];
  const originalFetch = window.fetch.bind(window);

  let timer = 0;
  let enabled = false;
  let suspended = false;
  let mode = '';

  function active() {
    return enabled && !suspended && TEMPORAL_MODES.has(mode) && !document.hidden;
  }

  function trim(now = Date.now()) {
    while (frames.length && now - frames[0].capturedAt > WINDOW_MS) frames.shift();
    while (frames.length > MAX_FRAMES) frames.shift();
  }

  function clearFrames() {
    frames.length = 0;
  }

  function dimensions(width, height) {
    const longest = Math.max(width, height);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function capture() {
    if (!active() || !cameraVideo || !context || cameraVideo.readyState < 2) return false;
    const sourceWidth = Number(cameraVideo.videoWidth || 0);
    const sourceHeight = Number(cameraVideo.videoHeight || 0);
    if (!sourceWidth || !sourceHeight) return false;

    const size = dimensions(sourceWidth, sourceHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    context.drawImage(cameraVideo, 0, 0, size.width, size.height);

    let frame = '';
    try { frame = canvas.toDataURL('image/jpeg', JPEG_QUALITY); }
    catch (_) { return false; }
    if (!frame.startsWith('data:image/jpeg;base64,')) return false;

    const now = Date.now();
    frames.push({ capturedAt: now, frame });
    trim(now);
    return true;
  }

  function schedule(delay = SAMPLE_INTERVAL_MS) {
    window.clearTimeout(timer);
    timer = 0;
    if (!active()) return;
    timer = window.setTimeout(() => {
      timer = 0;
      capture();
      schedule();
    }, Math.max(0, delay));
  }

  function temporalPayload(now = Date.now()) {
    trim(now);
    return frames
      .map((item) => ({ ageMs: Math.max(0, now - item.capturedAt), frame: item.frame }))
      .filter((item) => item.ageMs >= MIN_FRAME_AGE_MS && item.ageMs <= WINDOW_MS)
      .slice(-MAX_FRAMES);
  }

  function applyState(next = {}) {
    const wasActive = active();
    const previousMode = mode;
    enabled = Boolean(next.enabled);
    suspended = Boolean(next.suspended);
    mode = typeof next.mode === 'string' ? next.mode : '';
    const isActive = active();

    if (!isActive) {
      window.clearTimeout(timer);
      timer = 0;
      clearFrames();
      return;
    }

    if (!wasActive || previousMode !== mode) {
      clearFrames();
      capture();
      schedule();
    }
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

  window.fetch = function promptCamTemporalFetch(input, init = {}) {
    if (!isLiveAiRequest(input) || typeof init?.body !== 'string') {
      return originalFetch(input, init);
    }

    try {
      const payload = JSON.parse(init.body);
      if (TEMPORAL_MODES.has(payload?.mode)) {
        payload.temporalFrames = temporalPayload();
        return originalFetch(input, { ...init, body: JSON.stringify(payload) });
      }
    } catch (_) {
      // Leave malformed or unrelated requests untouched.
    }

    return originalFetch(input, init);
  };

  window.addEventListener('promptcam:live-ai-state', (event) => applyState(event.detail || {}));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.clearTimeout(timer);
      timer = 0;
    } else if (active()) {
      clearFrames();
      capture();
      schedule();
    }
  });
  window.addEventListener('pagehide', () => {
    window.clearTimeout(timer);
    timer = 0;
    clearFrames();
  });

  const initial = window.PromptCamLiveAI?.getStatus?.();
  if (initial) applyState(initial);

  window.PromptCamTemporalAI = Object.freeze({
    getStatus() {
      const now = Date.now();
      trim(now);
      return {
        active: active(),
        mode,
        frames: frames.length,
        agesMs: frames.map((item) => Math.max(0, now - item.capturedAt))
      };
    },
    clear: clearFrames
  });
})();

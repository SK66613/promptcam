(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const cameraView = document.getElementById('cameraView');
  const cameraVideo = document.getElementById('cameraVideo');
  const prompterText = document.getElementById('prompterText');
  const resultDialog = document.getElementById('resultDialog');
  const liveAiStatus = document.getElementById('liveAiStatus');

  const SPEECH_MODES = new Set(['crew', 'acting']);
  const VAD_INTERVAL_MS = 100;
  const VAD_SILENCE_STOP_MS = 700;
  const MIN_CHUNK_MS = 850;
  const MAX_CHUNK_MS = 4200;
  const CONTEXT_WINDOW_MS = 30_000;
  const MAX_QUEUE_ITEMS = 2;
  const SCRIPT_CONTEXT_MAX_CHARS = 700;
  const PREVIOUS_TEXT_MAX_CHARS = 320;
  const BASE_VOICE_THRESHOLD = 0.012;
  const NOISE_MULTIPLIER = 2.7;

  const state = {
    active: false,
    supported: true,
    speaking: false,
    transcribing: false,
    lastRms: 0,
    noiseFloor: 0.006,
    threshold: BASE_VOICE_THRESHOLD,
    chunkStartedAt: 0,
    lastVoiceAt: 0,
    lastTranscriptAt: 0,
    lastLatencyMs: 0,
    lastText: '',
    backoffUntil: 0,
    segments: []
  };

  let speechTrack = null;
  let speechStream = null;
  let audioContext = null;
  let audioSource = null;
  let analyser = null;
  let silentGain = null;
  let analyserBuffer = null;
  let vadTimer = 0;
  let voiceHits = 0;
  let recorder = null;
  let recorderChunks = [];
  let discardRecorder = false;
  let restartRecorder = false;
  let uploadController = null;
  const uploadQueue = [];
  let speechStatus = null;

  function liveState() {
    try { return window.PromptCamLiveAI?.getStatus?.() || null; }
    catch (_) { return null; }
  }

  function shouldListen() {
    const live = liveState();
    return Boolean(
      initData &&
      live?.enabled &&
      !live?.suspended &&
      SPEECH_MODES.has(live.mode) &&
      !document.hidden &&
      !resultDialog?.open &&
      cameraView &&
      !cameraView.classList.contains('hidden')
    );
  }

  function ensureStatus() {
    if (speechStatus || !liveAiStatus) return;
    const element = document.createElement('p');
    element.id = 'liveAiSpeechStatus';
    element.className = 'live-ai-speech-status';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    liveAiStatus.insertAdjacentElement('afterend', element);
    speechStatus = element;
  }

  function setStatus(message, tone = '') {
    ensureStatus();
    if (!speechStatus) return;
    speechStatus.textContent = message;
    speechStatus.hidden = false;
    if (tone) speechStatus.dataset.tone = tone;
    else delete speechStatus.dataset.tone;
  }

  function compactText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function currentScriptContext() {
    return compactText(prompterText?.textContent || '', SCRIPT_CONTEXT_MAX_CHARS);
  }

  function pruneSegments(now = Date.now()) {
    state.segments = state.segments.filter((item) => now - item.at <= CONTEXT_WINDOW_MS);
  }

  function contextText() {
    pruneSegments();
    return state.segments.map((item) => item.text).filter(Boolean).join(' ').trim();
  }

  function contextSpanMs() {
    pruneSegments();
    if (!state.segments.length) return 0;
    return Math.max(0, Date.now() - state.segments[0].at);
  }

  function getStatus() {
    pruneSegments();
    return {
      active: state.active,
      supported: state.supported,
      speaking: state.speaking,
      transcribing: state.transcribing,
      lastRms: Number(state.lastRms.toFixed(4)),
      noiseFloor: Number(state.noiseFloor.toFixed(4)),
      threshold: Number(state.threshold.toFixed(4)),
      lastTranscriptAt: state.lastTranscriptAt,
      lastLatencyMs: state.lastLatencyMs,
      lastText: state.lastText,
      backoffUntil: state.backoffUntil,
      contextText: contextText(),
      contextSpanMs: contextSpanMs(),
      segments: state.segments.map((item) => ({ ...item })),
      queuedChunks: uploadQueue.length
    };
  }

  function emitState() {
    window.dispatchEvent(new CustomEvent('promptcam:speech-context', { detail: getStatus() }));
  }

  function preferredMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/webm'
    ];
    for (const type of candidates) {
      try {
        if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) return type;
      } catch (_) { /* Try the next supported type. */ }
    }
    return '';
  }

  function extensionForType(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('mp4')) return 'm4a';
    if (normalized.includes('mpeg')) return 'mp3';
    if (normalized.includes('wav')) return 'wav';
    return 'm4a';
  }

  function appendTranscript(text, durationMs, latencyMs) {
    const clean = compactText(text, 1000);
    if (!clean) return;
    const now = Date.now();
    const last = state.segments[state.segments.length - 1];
    if (last && last.text.toLocaleLowerCase() === clean.toLocaleLowerCase()) {
      last.at = now;
      last.durationMs = durationMs;
      last.latencyMs = latencyMs;
    } else {
      state.segments.push({ text: clean, at: now, durationMs, latencyMs });
    }
    pruneSegments(now);
    state.lastTranscriptAt = now;
    state.lastLatencyMs = latencyMs;
    state.lastText = clean;
    const snippet = clean.length > 76 ? `${clean.slice(0, 75)}…` : clean;
    setStatus(`🎙 «${snippet}» · ${(latencyMs / 1000).toFixed(latencyMs < 2000 ? 1 : 0)} с`, 'success');
    emitState();
  }

  async function transcribeChunk(item) {
    if (!initData || Date.now() < state.backoffUntil) return;
    const form = new FormData();
    form.append('initData', initData);
    form.append('durationMs', String(Math.round(item.durationMs || 0)));
    form.append('scriptContext', currentScriptContext());
    form.append('previousText', compactText(contextText().slice(-PREVIOUS_TEXT_MAX_CHARS), PREVIOUS_TEXT_MAX_CHARS));
    const extension = extensionForType(item.blob.type || item.mimeType);
    form.append('audio', item.blob, `promptcam-speech.${extension}`);

    uploadController = new AbortController();
    state.transcribing = true;
    setStatus('🎙 Распознаю короткую реплику…');
    emitState();

    try {
      const response = await fetch('/api/ai/speech', {
        method: 'POST',
        body: form,
        cache: 'no-store',
        credentials: 'same-origin',
        signal: uploadController.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          const retrySeconds = Math.max(2, Number(payload.retryAfter || response.headers.get('Retry-After') || 5));
          state.backoffUntil = Date.now() + retrySeconds * 1000;
          setStatus(`🎙 Пауза распознавания · ${retrySeconds} с`, 'error');
          return;
        }
        if (response.status === 401) {
          setStatus('🎙 Telegram-сессия устарела. Переоткрой PromptCam.', 'error');
          return;
        }
        throw new Error(payload.error || 'speech_request_failed');
      }
      const latencyMs = Number(payload?.latency?.totalMs || 0);
      const text = compactText(payload?.text || '', 1000);
      if (text) appendTranscript(text, item.durationMs, latencyMs);
      else setStatus('🎙 Речь не разобрана · продолжаю слушать');
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus('🎙 Не удалось распознать фразу · продолжаю слушать', 'error');
    } finally {
      state.transcribing = false;
      uploadController = null;
      emitState();
    }
  }

  async function processUploadQueue() {
    if (state.transcribing || !uploadQueue.length) return;
    while (uploadQueue.length && !state.transcribing) {
      const item = uploadQueue.shift();
      if (!item || Date.now() < state.backoffUntil) continue;
      await transcribeChunk(item);
    }
  }

  function enqueueChunk(blob, durationMs, mimeType) {
    if (!blob?.size || durationMs < MIN_CHUNK_MS || !shouldListen()) return;
    uploadQueue.push({ blob, durationMs, mimeType });
    if (uploadQueue.length > MAX_QUEUE_ITEMS) uploadQueue.splice(0, uploadQueue.length - MAX_QUEUE_ITEMS);
    processUploadQueue();
  }

  function startRecorder() {
    if (!state.active || recorder || !speechStream || !state.speaking) return;
    const mimeType = preferredMimeType();
    if (!mimeType) {
      state.supported = false;
      setStatus('🎙 Этот браузер не даёт подходящий формат аудио для Speech Context.', 'error');
      stopListening();
      return;
    }

    recorderChunks = [];
    discardRecorder = false;
    restartRecorder = false;
    state.chunkStartedAt = Date.now();
    try {
      recorder = new MediaRecorder(speechStream, { mimeType });
    } catch (_) {
      state.supported = false;
      setStatus('🎙 Не удалось запустить захват речи в этом браузере.', 'error');
      stopListening();
      return;
    }

    const localRecorder = recorder;
    localRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) recorderChunks.push(event.data);
    });
    localRecorder.addEventListener('stop', () => {
      const durationMs = Math.max(0, Date.now() - state.chunkStartedAt);
      const shouldSend = !discardRecorder && durationMs >= MIN_CHUNK_MS;
      const blob = recorderChunks.length ? new Blob(recorderChunks, { type: localRecorder.mimeType || mimeType }) : null;
      const shouldRestart = restartRecorder && state.active && state.speaking;
      recorder = null;
      recorderChunks = [];
      state.chunkStartedAt = 0;
      discardRecorder = false;
      restartRecorder = false;
      if (shouldSend && blob?.size) enqueueChunk(blob, durationMs, localRecorder.mimeType || mimeType);
      if (shouldRestart) startRecorder();
    }, { once: true });
    localRecorder.addEventListener('error', () => {
      if (recorder === localRecorder) {
        recorder = null;
        recorderChunks = [];
        state.chunkStartedAt = 0;
      }
      setStatus('🎙 Сбой аудиочанка · продолжаю слушать', 'error');
    }, { once: true });
    localRecorder.start();
  }

  function stopRecorder({ discard = false, restart = false } = {}) {
    if (!recorder || recorder.state === 'inactive') return;
    discardRecorder = discard;
    restartRecorder = restart;
    try { recorder.stop(); }
    catch (_) {
      recorder = null;
      recorderChunks = [];
      state.chunkStartedAt = 0;
    }
  }

  function sampleVoice() {
    if (!state.active || !analyser || !analyserBuffer) return;
    analyser.getFloatTimeDomainData(analyserBuffer);
    let sum = 0;
    for (let index = 0; index < analyserBuffer.length; index += 1) {
      const sample = analyserBuffer[index];
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / analyserBuffer.length);
    state.lastRms = rms;

    if (!state.speaking) {
      state.noiseFloor = Math.min(0.08, state.noiseFloor * 0.97 + rms * 0.03);
    }
    state.threshold = Math.max(BASE_VOICE_THRESHOLD, state.noiseFloor * NOISE_MULTIPLIER);
    const voice = rms >= state.threshold;
    const now = Date.now();

    if (voice) {
      state.lastVoiceAt = now;
      voiceHits += 1;
      if (!state.speaking && voiceHits >= 2) {
        state.speaking = true;
        setStatus('🎙 Слышу речь…');
        startRecorder();
        emitState();
      }
    } else {
      voiceHits = 0;
      if (state.speaking && now - state.lastVoiceAt >= VAD_SILENCE_STOP_MS) {
        state.speaking = false;
        stopRecorder({ discard: false, restart: false });
        setStatus(state.transcribing ? '🎙 Распознаю короткую реплику…' : '🎙 Слушаю речь локально…');
        emitState();
      }
    }

    if (recorder && state.chunkStartedAt && now - state.chunkStartedAt >= MAX_CHUNK_MS) {
      stopRecorder({ discard: false, restart: state.speaking });
    }
  }

  async function startListening() {
    if (state.active || !shouldListen()) return;
    if (typeof MediaRecorder === 'undefined') {
      state.supported = false;
      setStatus('🎙 Speech Context не поддерживается этим браузером.', 'error');
      emitState();
      return;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      state.supported = false;
      setStatus('🎙 Web Audio недоступен — VAD не запустился.', 'error');
      emitState();
      return;
    }

    const sourceTrack = cameraVideo?.srcObject?.getAudioTracks?.()[0];
    if (!sourceTrack || sourceTrack.readyState !== 'live') {
      setStatus('🎙 Жду live-аудиотрек камеры…');
      window.setTimeout(syncListening, 250);
      return;
    }

    try {
      speechTrack = sourceTrack.clone();
      speechStream = new MediaStream([speechTrack]);
      audioContext = new AudioContextCtor();
      audioSource = audioContext.createMediaStreamSource(speechStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.15;
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      audioSource.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioContext.destination);
      await audioContext.resume().catch(() => {});
      speechTrack.addEventListener('ended', stopListening, { once: true });
      state.active = true;
      state.supported = true;
      state.speaking = false;
      state.noiseFloor = 0.006;
      state.threshold = BASE_VOICE_THRESHOLD;
      voiceHits = 0;
      window.clearInterval(vadTimer);
      vadTimer = window.setInterval(sampleVoice, VAD_INTERVAL_MS);
      setStatus('🎙 Слушаю речь локально · отправляю только речевые чанки');
      emitState();
    } catch (_) {
      setStatus('🎙 Не удалось подключить Speech Context к микрофону.', 'error');
      stopListening();
    }
  }

  function stopListening({ clearContext = false } = {}) {
    window.clearInterval(vadTimer);
    vadTimer = 0;
    state.active = false;
    state.speaking = false;
    voiceHits = 0;
    stopRecorder({ discard: true, restart: false });
    uploadQueue.length = 0;
    if (uploadController) uploadController.abort();
    uploadController = null;
    try { audioSource?.disconnect(); } catch (_) { /* Optional cleanup. */ }
    try { analyser?.disconnect(); } catch (_) { /* Optional cleanup. */ }
    try { silentGain?.disconnect(); } catch (_) { /* Optional cleanup. */ }
    audioSource = null;
    analyser = null;
    silentGain = null;
    analyserBuffer = null;
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
    speechTrack?.stop();
    speechTrack = null;
    speechStream = null;
    state.transcribing = false;
    if (clearContext) {
      state.segments = [];
      state.lastTranscriptAt = 0;
      state.lastLatencyMs = 0;
      state.lastText = '';
    }
    emitState();
  }

  function syncListening() {
    if (shouldListen()) {
      startListening();
      return;
    }
    const live = liveState();
    const clearContext = Boolean(
      !live?.enabled ||
      live?.suspended ||
      resultDialog?.open ||
      cameraView?.classList.contains('hidden')
    );
    if (state.active || recorder || uploadController || (clearContext && state.segments.length)) {
      stopListening({ clearContext });
    }
    if (!live?.enabled) setStatus('🎙 Speech Context включится вместе с AI Live.');
    else if (!SPEECH_MODES.has(live.mode)) setStatus('🎙 Речь слушаю только в Съёмочной группе и Актёрском коуче.');
    else if (live.suspended || resultDialog?.open) setStatus('🎙 Speech Context на паузе · память дубля очищена.');
  }

  function reset() {
    stopListening({ clearContext: true });
    state.backoffUntil = 0;
    setStatus('🎙 Speech Context очищен.');
  }

  window.addEventListener('promptcam:live-ai-state', syncListening);
  window.addEventListener('pagehide', () => stopListening({ clearContext: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopListening({ clearContext: false });
    else syncListening();
  });

  if (resultDialog) {
    const resultObserver = new MutationObserver(syncListening);
    resultObserver.observe(resultDialog, { attributes: true, attributeFilter: ['open'] });
  }

  if (cameraView) {
    const observer = new MutationObserver(() => {
      if (cameraView.classList.contains('hidden')) stopListening({ clearContext: true });
      else syncListening();
    });
    observer.observe(cameraView, { attributes: true, attributeFilter: ['class'] });
  }

  window.PromptCamSpeechContext = Object.freeze({
    state,
    start: startListening,
    stop: stopListening,
    reset,
    getStatus,
    getContext: () => ({
      text: contextText(),
      spanMs: contextSpanMs(),
      segments: state.segments.map((item) => ({ ...item }))
    })
  });

  ensureStatus();
  setStatus('🎙 Speech Context включится вместе с AI Live.');
})();

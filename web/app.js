(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const editor = $('editorView');
  const camera = $('cameraView');
  const scriptInput = $('scriptInput');
  const wordCount = $('wordCount');
  const charCount = $('charCount');
  const clearScript = $('clearScriptButton');
  const openCamera = $('openCameraButton');
  const cameraVideo = $('cameraVideo');
  const prompterPanel = $('prompterPanel');
  const prompterText = $('prompterText');
  const scroller = $('prompterScroller');
  const back = $('backButton');
  const flip = $('switchCameraButton');
  const play = $('playPromptButton');
  const reset = $('resetPromptButton');
  const record = $('recordButton');
  const recordingPill = $('recordingPill');
  const recordingTime = $('recordingTime');
  const countdown = $('countdown');
  const countdownNumber = countdown.querySelector('span');
  const toast = $('toast');
  const settingsToggle = $('cameraSettingsToggle');
  const cameraSettings = $('cameraSettings');
  const dialog = $('resultDialog');
  const resultVideo = $('resultVideo');
  const share = $('shareButton');
  const download = $('downloadButton');
  const retry = $('retryButton');
  const returnToText = $('returnToTextButton');
  const shareFallback = $('shareFallback');

  const controls = {
    speed: { editor: $('speedInput'), camera: $('cameraSpeedInput'), output: $('speedValue') },
    font: { editor: $('fontInput'), camera: $('cameraFontInput'), output: $('fontValue') },
    opacity: { editor: $('opacityInput'), camera: $('cameraOpacityInput'), output: $('opacityValue') },
    position: { editor: $('positionInput'), camera: $('cameraPositionInput'), output: $('positionValue') }
  };
  const defaults = {
    script: 'Всем привет!\n\nСегодня я покажу PromptCam — простой телесуфлёр поверх камеры.\n\nТекст плавно движется по экрану, помогая говорить уверенно и не сбиваться.\n\nГотовы? Поехали!',
    speed: 42,
    font: 32,
    opacity: 55,
    position: 0
  };
  const storageKey = 'promptcam.settings.v2';
  let state = { ...defaults };
  let mediaStream = null;
  let facingMode = 'user';
  let isScrolling = false;
  let scrollFrame = 0;
  let previousFrame = 0;
  let recorder = null;
  let chunks = [];
  let recordingClock = 0;
  let resultBlob = null;
  let resultUrl = '';
  let toastTimer = 0;
  let countdownActive = false;

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const setIcon = (button, icon) => button.querySelector('use').setAttribute('href', `#i-${icon}`);

  function readState() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
      state = { ...defaults, ...stored };
    } catch (_) {
      state = { ...defaults };
    }
    for (const key of ['speed', 'font', 'opacity', 'position']) {
      const input = controls[key].editor;
      state[key] = Math.min(Number(input.max), Math.max(Number(input.min), Number(state[key]) || defaults[key]));
    }
  }

  function saveState() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) { /* Private browsing may disable storage. */ }
  }

  function plural(number, forms) {
    const mod100 = number % 100;
    const mod10 = number % 10;
    return number + ' ' + (mod100 >= 11 && mod100 <= 14 ? forms[2] : mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2]);
  }

  function updateTextMeta() {
    const value = scriptInput.value;
    const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
    wordCount.textContent = plural(words, ['слово', 'слова', 'слов']);
    charCount.textContent = plural(value.length, ['символ', 'символа', 'символов']);
    state.script = value;
    saveState();
  }

  function syncSettings() {
    for (const key of Object.keys(controls)) {
      controls[key].editor.value = state[key];
      controls[key].camera.value = state[key];
    }
    controls.speed.output.textContent = `${state.speed} px/с`;
    controls.font.output.textContent = `${state.font} px`;
    controls.opacity.output.textContent = `${state.opacity}%`;
    controls.position.output.textContent = state.position < 0 ? 'Выше' : state.position > 0 ? 'Ниже' : 'По центру';
    prompterText.style.fontSize = `${state.font}px`;
    camera.style.setProperty('--panel-alpha', state.opacity / 100);
    camera.style.setProperty('--prompter-shift', `${state.position * 12}dvh`);
  }

  function setSetting(key, value) {
    state[key] = Number(value);
    syncSettings();
    saveState();
  }

  function showMessage(message, duration = 4500) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove('hidden');
    toastTimer = window.setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function showEditorMessage(message) {
    window.alert(message);
  }

  function stopTracks() {
    if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    cameraVideo.srcObject = null;
  }

  function friendlyMediaError(error, source = 'camera') {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return source === 'microphone'
        ? 'Доступ к микрофону запрещён. Разреши микрофон для PromptCam в настройках браузера и попробуй снова.'
        : 'Доступ к камере запрещён. Разреши камеру для PromptCam в настройках браузера и попробуй снова.';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return source === 'microphone' ? 'Микрофон не найден или недоступен.' : 'Камера не найдена или недоступна.';
    }
    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError' || error?.name === 'AbortError') {
      return source === 'microphone' ? 'Микрофон занят другим приложением.' : 'Камера сейчас недоступна. Закрой другие приложения с камерой и попробуй снова.';
    }
    return source === 'microphone' ? 'Не удалось включить микрофон. Проверь разрешение и попробуй снова.' : 'Не удалось открыть камеру. Проверь разрешение и попробуй снова.';
  }

  async function requestVideo(mode) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (firstError) {
      try { return await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false }); }
      catch (_) { throw firstError; }
    }
  }

  async function startCamera(mode = facingMode, includeAudio = true) {
    if (!navigator.mediaDevices?.getUserMedia) throw { promptcamMessage: 'Этот браузер не поддерживает доступ к камере. Открой PromptCam в Safari или Chrome.' };
    const oldStream = mediaStream;
    let videoStream;
    let audioStream;
    try { videoStream = await requestVideo(mode); }
    catch (error) { throw { promptcamMessage: friendlyMediaError(error, 'camera') }; }
    try {
      const existingAudio = oldStream?.getAudioTracks()[0];
      if (includeAudio && existingAudio?.readyState === 'live') audioStream = new MediaStream([existingAudio]);
      else if (includeAudio) audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      const tracks = [...videoStream.getVideoTracks(), ...(audioStream?.getAudioTracks() || [])];
      mediaStream = new MediaStream(tracks);
      oldStream?.getVideoTracks().forEach((track) => track.stop());
      if (!existingAudio) oldStream?.getAudioTracks().forEach((track) => track.stop());
      facingMode = mode;
      cameraVideo.srcObject = mediaStream;
      cameraVideo.classList.toggle('mirrored', mode === 'user');
      await cameraVideo.play().catch(() => {});
    } catch (error) {
      videoStream.getTracks().forEach((track) => track.stop());
      throw { promptcamMessage: friendlyMediaError(error, 'microphone') };
    }
  }

  function setScrolling(value) {
    isScrolling = value;
    play.setAttribute('aria-label', value ? 'Поставить суфлёр на паузу' : 'Запустить суфлёр');
    play.querySelector('small').textContent = value ? 'Пауза' : 'Старт';
    setIcon(play, value ? 'pause' : 'play');
    previousFrame = 0;
    if (value && !scrollFrame) scrollFrame = requestAnimationFrame(scrollPrompter);
    if (!value && scrollFrame) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    }
  }

  function scrollPrompter(timestamp) {
    if (!isScrolling) { scrollFrame = 0; return; }
    if (!previousFrame) previousFrame = timestamp;
    const elapsed = Math.min((timestamp - previousFrame) / 1000, 0.1);
    previousFrame = timestamp;
    const maximum = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.min(maximum, scroller.scrollTop + state.speed * elapsed);
    if (scroller.scrollTop >= maximum - 1) { setScrolling(false); return; }
    scrollFrame = requestAnimationFrame(scrollPrompter);
  }

  function resetPrompter() {
    setScrolling(false);
    scroller.scrollTop = 0;
  }

  function formatTime(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function supportedMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    return ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((type) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) || '';
  }

  async function runCountdown() {
    countdownActive = true;
    countdown.classList.remove('hidden');
    for (let number = 3; number >= 1; number -= 1) {
      countdownNumber.textContent = number;
      countdownNumber.style.animation = 'none';
      void countdownNumber.offsetWidth;
      countdownNumber.style.animation = '';
      await wait(850);
    }
    countdown.classList.add('hidden');
    countdownActive = false;
  }

  async function startRecording() {
    if (!mediaStream || countdownActive) return;
    if (typeof MediaRecorder === 'undefined') {
      showMessage('Этот браузер не поддерживает запись видео. Открой PromptCam в актуальной версии Safari или Chrome.', 6000);
      return;
    }
    record.disabled = true;
    flip.disabled = true;
    resetPrompter();
    await runCountdown();
    chunks = [];
    try {
      const mimeType = supportedMimeType();
      recorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
      recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener('stop', finishRecording, { once: true });
      recorder.addEventListener('error', () => {
        showMessage('Во время записи произошла ошибка. Попробуй записать видео ещё раз.', 6000);
        stopRecording();
      }, { once: true });
      recorder.start(500);
    } catch (_) {
      record.disabled = false;
      flip.disabled = false;
      showMessage('Не удалось начать запись. Перезапусти камеру и попробуй снова.', 6000);
      return;
    }
    record.classList.add('recording');
    camera.classList.add('is-recording');
    record.setAttribute('aria-label', 'Остановить запись');
    recordingPill.classList.remove('hidden');
    recordingTime.textContent = '00:00';
    record.disabled = false;
    const startedAt = Date.now();
    recordingClock = window.setInterval(() => { recordingTime.textContent = formatTime(Math.floor((Date.now() - startedAt) / 1000)); }, 250);
    setScrolling(true);
  }

  function stopRecording() {
    if (!recorder || recorder.state === 'inactive') return;
    record.disabled = true;
    setScrolling(false);
    try { recorder.stop(); }
    catch (_) {
      restoreRecordingControls();
      showMessage('Не удалось завершить запись. Попробуй ещё раз.', 6000);
    }
  }

  function restoreRecordingControls() {
    window.clearInterval(recordingClock);
    recordingPill.classList.add('hidden');
    record.classList.remove('recording');
    camera.classList.remove('is-recording');
    record.setAttribute('aria-label', 'Начать запись');
    record.disabled = false;
    flip.disabled = false;
  }

  function finishRecording() {
    restoreRecordingControls();
    const type = recorder?.mimeType || chunks[0]?.type || 'video/mp4';
    resultBlob = new Blob(chunks, { type });
    chunks = [];
    if (!resultBlob.size) {
      resultBlob = null;
      showMessage('Запись получилась пустой. Проверь камеру и попробуй ещё раз.', 6000);
      return;
    }
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(resultBlob);
    resultVideo.src = resultUrl;
    download.href = resultUrl;
    download.download = type.includes('webm') ? 'promptcam-video.webm' : 'promptcam-video.mp4';
    shareFallback.classList.add('hidden');
    dialog.showModal();
  }

  async function shareRecording() {
    if (!resultBlob) return;
    const extension = resultBlob.type.includes('webm') ? 'webm' : 'mp4';
    const file = new File([resultBlob], `promptcam-video.${extension}`, { type: resultBlob.type || `video/${extension}` });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Видео из PromptCam' }); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    shareFallback.classList.remove('hidden');
    showMessage('Используй кнопку «Скачать файл» ниже.', 5000);
  }

  function closeResult() {
    resultVideo.pause();
    dialog.close();
  }

  function leaveCamera() {
    if (recorder && recorder.state !== 'inactive') { showMessage('Сначала останови запись.'); return; }
    resetPrompter();
    stopTracks();
    camera.classList.add('hidden');
    camera.setAttribute('aria-hidden', 'true');
    editor.classList.remove('hidden');
    editor.removeAttribute('aria-hidden');
  }

  readState();
  scriptInput.value = state.script;
  syncSettings();
  updateTextMeta();

  scriptInput.addEventListener('input', updateTextMeta);
  clearScript.addEventListener('click', () => { scriptInput.value = ''; updateTextMeta(); scriptInput.focus(); });
  for (const [key, group] of Object.entries(controls)) {
    group.editor.addEventListener('input', (event) => setSetting(key, event.target.value));
    group.camera.addEventListener('input', (event) => setSetting(key, event.target.value));
  }

  openCamera.addEventListener('click', async () => {
    const value = scriptInput.value.trim();
    if (!value) { showEditorMessage('Добавь текст сценария, чтобы открыть суфлёр.'); scriptInput.focus(); return; }
    openCamera.disabled = true;
    openCamera.firstChild.textContent = 'Открываем камеру… ';
    prompterText.textContent = value;
    try {
      await startCamera('user', true);
      editor.classList.add('hidden');
      editor.setAttribute('aria-hidden', 'true');
      camera.classList.remove('hidden');
      camera.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => { scroller.scrollTop = 0; });
    } catch (error) {
      stopTracks();
      showEditorMessage(error.promptcamMessage || 'Не удалось открыть камеру. Проверь разрешения и попробуй снова.');
    } finally {
      openCamera.disabled = false;
      openCamera.firstChild.textContent = 'Открыть камеру ';
    }
  });

  back.addEventListener('click', leaveCamera);
  flip.addEventListener('click', async () => {
    if (recorder && recorder.state !== 'inactive') return;
    flip.disabled = true;
    try { await startCamera(facingMode === 'user' ? 'environment' : 'user', true); }
    catch (error) { showMessage(error.promptcamMessage || 'Не удалось сменить камеру.', 6000); }
    finally { flip.disabled = false; }
  });
  play.addEventListener('click', () => setScrolling(!isScrolling));
  reset.addEventListener('click', resetPrompter);
  record.addEventListener('click', () => recorder && recorder.state !== 'inactive' ? stopRecording() : startRecording());
  settingsToggle.addEventListener('click', () => {
    const open = settingsToggle.getAttribute('aria-expanded') === 'true';
    settingsToggle.setAttribute('aria-expanded', String(!open));
    cameraSettings.hidden = open;
  });
  share.addEventListener('click', shareRecording);
  retry.addEventListener('click', () => { closeResult(); resetPrompter(); });
  returnToText.addEventListener('click', () => { closeResult(); leaveCamera(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeResult(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (!recorder || recorder.state === 'inactive')) setScrolling(false); });
  window.addEventListener('pagehide', () => { stopTracks(); if (resultUrl) URL.revokeObjectURL(resultUrl); });
})();

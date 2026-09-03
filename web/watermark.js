(() => {
  'use strict';

  const state = {
    enabled: true,
    text: 'PromptCam',
    opacity: 0.64,
    targetFps: 30,
    lastMode: 'idle',
    lastReason: '',
    width: 0,
    height: 0,
    captureStreamSupported: false,
    videoReadyState: 0,
    activeCleanups: new Set()
  };

  const api = {
    get enabled() { return state.enabled; },
    set enabled(value) { state.enabled = Boolean(value); },
    get text() { return state.text; },
    set text(value) { state.text = String(value || 'PromptCam').slice(0, 64); },
    get lastMode() { return state.lastMode; },
    get lastReason() { return state.lastReason; },
    setEnabled(value) { state.enabled = Boolean(value); },
    markFallback(reason) { mark('fallback', reason); },
    prepareRecordingStream(sourceStream, cameraVideo) {
      return prepareWatermarkedStream(sourceStream, cameraVideo);
    },
    getStatus() {
      return {
        enabled: state.enabled,
        text: state.text,
        mode: state.lastMode,
        reason: state.lastReason,
        width: state.width,
        height: state.height,
        targetFps: state.targetFps,
        captureStreamSupported: state.captureStreamSupported,
        videoReadyState: state.videoReadyState
      };
    }
  };

  window.PromptCamWatermark = api;

  function mark(mode, reason = '') {
    state.lastMode = mode;
    state.lastReason = reason;
    document.documentElement.dataset.watermarkMode = mode;
    window.dispatchEvent(new CustomEvent('promptcam:watermark-mode', {
      detail: api.getStatus()
    }));
  }

  function fallback(sourceStream, reason) {
    mark('fallback', reason);
    return { stream: sourceStream, cleanup() {} };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function drawWatermark(context, width, height) {
    const fontSize = clamp(Math.round(Math.min(width, height) * 0.035), 22, 54);
    const padding = clamp(Math.round(Math.min(width, height) * 0.035), 20, 64);

    context.save();
    context.globalAlpha = state.opacity;
    context.fillStyle = '#ffffff';
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textAlign = 'right';
    context.textBaseline = 'bottom';
    context.shadowColor = 'rgba(0, 0, 0, 0.78)';
    context.shadowBlur = Math.max(8, Math.round(fontSize * 0.32));
    context.shadowOffsetY = Math.max(2, Math.round(fontSize * 0.08));
    context.fillText(state.text, width - padding, height - padding);
    context.restore();
  }

  function prepareWatermarkedStream(sourceStream, cameraVideo) {
    state.width = 0;
    state.height = 0;
    state.videoReadyState = Number(cameraVideo?.readyState || 0);

    if (!state.enabled) {
      mark('disabled');
      return { stream: sourceStream, cleanup() {} };
    }

    if (!cameraVideo) return fallback(sourceStream, 'camera_video_missing');
    if (!sourceStream?.getVideoTracks?.().length) return fallback(sourceStream, 'video_track_missing');

    const canvas = document.createElement('canvas');
    const captureStream = canvas.captureStream || canvas.mozCaptureStream;
    state.captureStreamSupported = typeof captureStream === 'function';
    if (!state.captureStreamSupported) return fallback(sourceStream, 'canvas_capture_stream_unsupported');

    const sourceTrack = sourceStream.getVideoTracks()[0];
    const settings = sourceTrack.getSettings?.() || {};
    const width = Math.round(cameraVideo.videoWidth || settings.width || 0);
    const height = Math.round(cameraVideo.videoHeight || settings.height || 0);
    state.width = width;
    state.height = height;

    if (!width || !height) return fallback(sourceStream, 'video_dimensions_missing');
    if (cameraVideo.readyState < 2) return fallback(sourceStream, 'camera_video_not_ready');

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) return fallback(sourceStream, 'canvas_context_unavailable');

    let stopped = false;
    let animationFrame = 0;
    let videoFrameCallback = 0;

    const renderFrame = () => {
      if (stopped) return;
      try {
        context.drawImage(cameraVideo, 0, 0, width, height);
        drawWatermark(context, width, height);
      } catch (_) {
        // A transient draw failure should not stop the recording loop.
      }
    };

    const schedule = () => {
      if (stopped) return;
      if (typeof cameraVideo.requestVideoFrameCallback === 'function') {
        videoFrameCallback = cameraVideo.requestVideoFrameCallback(() => {
          renderFrame();
          schedule();
        });
      } else {
        animationFrame = requestAnimationFrame(() => {
          renderFrame();
          schedule();
        });
      }
    };

    renderFrame();

    let canvasStream;
    try {
      canvasStream = captureStream.call(canvas, state.targetFps);
    } catch (_) {
      return fallback(sourceStream, 'canvas_capture_stream_failed');
    }

    const canvasVideoTrack = canvasStream.getVideoTracks()[0];
    if (!canvasVideoTrack) {
      canvasStream.getTracks().forEach((track) => track.stop());
      return fallback(sourceStream, 'canvas_video_track_missing');
    }

    const outputStream = new MediaStream([
      canvasVideoTrack,
      ...sourceStream.getAudioTracks()
    ]);

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (videoFrameCallback && typeof cameraVideo.cancelVideoFrameCallback === 'function') {
        cameraVideo.cancelVideoFrameCallback(videoFrameCallback);
      }
      canvasStream.getVideoTracks().forEach((track) => track.stop());
      state.activeCleanups.delete(cleanup);
    };

    state.activeCleanups.add(cleanup);
    schedule();
    mark('watermarked');
    return { stream: outputStream, cleanup };
  }

  window.addEventListener('pagehide', () => {
    [...state.activeCleanups].forEach((cleanup) => cleanup());
  });
})();
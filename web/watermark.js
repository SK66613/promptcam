(() => {
  'use strict';

  const NativeMediaRecorder = window.MediaRecorder;
  if (typeof NativeMediaRecorder === 'undefined') return;

  const state = {
    enabled: true,
    text: 'PromptCam',
    opacity: 0.64,
    targetFps: 30,
    lastMode: 'idle',
    lastReason: '',
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
    getStatus() {
      return {
        enabled: state.enabled,
        text: state.text,
        mode: state.lastMode,
        reason: state.lastReason
      };
    }
  };
  window.PromptCamWatermark = api;

  function mark(mode, reason = '') {
    state.lastMode = mode;
    state.lastReason = reason;
    document.documentElement.dataset.watermarkMode = mode;
    window.dispatchEvent(new CustomEvent('promptcam:watermark-mode', {
      detail: { mode, reason }
    }));
  }

  function fallback(stream, reason) {
    mark('fallback', reason);
    return { stream, cleanup() {} };
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

  function prepareWatermarkedStream(sourceStream) {
    if (!state.enabled) {
      mark('disabled');
      return { stream: sourceStream, cleanup() {} };
    }

    const cameraVideo = document.getElementById('cameraVideo');
    const captureStream = HTMLCanvasElement.prototype.captureStream || HTMLCanvasElement.prototype.mozCaptureStream;
    if (!cameraVideo) return fallback(sourceStream, 'camera_video_missing');
    if (typeof captureStream !== 'function') return fallback(sourceStream, 'canvas_capture_stream_unsupported');
    if (!sourceStream?.getVideoTracks?.().length) return fallback(sourceStream, 'video_track_missing');

    const sourceTrack = sourceStream.getVideoTracks()[0];
    const settings = sourceTrack.getSettings?.() || {};
    const width = Math.round(cameraVideo.videoWidth || settings.width || 0);
    const height = Math.round(cameraVideo.videoHeight || settings.height || 0);
    if (!width || !height || cameraVideo.readyState < 2) {
      return fallback(sourceStream, 'camera_video_not_ready');
    }

    const canvas = document.createElement('canvas');
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
        // A transient draw failure should not terminate the recording loop.
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

  const MediaRecorderProxy = new Proxy(NativeMediaRecorder, {
    construct(Target, args) {
      const sourceStream = args[0];
      const prepared = prepareWatermarkedStream(sourceStream);
      const nextArgs = args.length > 1 ? [prepared.stream, args[1]] : [prepared.stream];
      let recorder;

      try {
        recorder = Reflect.construct(Target, nextArgs, Target);
      } catch (error) {
        prepared.cleanup();
        if (prepared.stream !== sourceStream) {
          mark('fallback', 'watermarked_recorder_creation_failed');
          recorder = args.length > 1
            ? Reflect.construct(Target, [sourceStream, args[1]], Target)
            : Reflect.construct(Target, [sourceStream], Target);
        } else {
          throw error;
        }
      }

      const cleanup = () => prepared.cleanup();
      recorder.addEventListener('stop', cleanup, { once: true });
      recorder.addEventListener('error', cleanup, { once: true });
      return recorder;
    }
  });

  try {
    window.MediaRecorder = MediaRecorderProxy;
  } catch (_) {
    mark('fallback', 'media_recorder_proxy_unavailable');
  }

  window.addEventListener('pagehide', () => {
    [...state.activeCleanups].forEach((cleanup) => cleanup());
  });
})();
# PromptCam text watermark pipeline

## Current scope

This stage adds only a simple text watermark:

`PromptCam`

No logo image, billing, Stars, D1 entitlement or paywall is part of this change.

For now watermarking is enabled by default for every recording so the video pipeline can be tested independently before subscription logic is introduced.

## How it works

`web/watermark.js` loads before `web/app.js` and wraps the browser `MediaRecorder` constructor.

When the app starts a recording:

1. The live `#cameraVideo` frame is drawn into an off-screen canvas.
2. The text `PromptCam` is drawn in the bottom-right corner of that canvas.
3. `canvas.captureStream(30)` creates the video track used for recording.
4. The original microphone audio tracks are attached to the generated video stream.
5. The existing PromptCam `MediaRecorder` flow records that stream without changing the camera UI logic.

The teleprompter text and controls are **not** burned into the video. Only the `PromptCam` watermark is added.

## Watermark appearance

- text only: `PromptCam`;
- white;
- about 64% opacity;
- subtle dark shadow for readability;
- bottom-right position;
- size and padding scale with the captured video dimensions.

The visual treatment is intentionally simple. A logo can replace or accompany the text after the pipeline is stable.

## Future FREE / PRO switch

The watermark module exposes:

```js
window.PromptCamWatermark.setEnabled(false);
```

Later the authenticated D1 entitlement flow can use:

- FREE -> `setEnabled(true)`
- PRO -> `setEnabled(false)`

This module is not an authorization boundary. The future backend/D1 entitlement remains the source of truth; this switch only controls the local recording pipeline after entitlement is resolved.

## Runtime fallback

Some browser/WebView combinations may not support `canvas.captureStream()` or may reject a canvas stream in `MediaRecorder`.

During this testing stage PromptCam falls back to the existing raw camera stream instead of breaking recording.

Runtime state can be inspected with:

```js
window.PromptCamWatermark.getStatus();
```

Expected successful result after recording starts:

```js
{
  enabled: true,
  text: 'PromptCam',
  mode: 'watermarked',
  reason: ''
}
```

If `mode` is `fallback`, the `reason` field identifies why the browser could not use the watermarked stream.

For the future paid FREE/PRO release, a FREE user should not silently receive an unwatermarked fallback. After device testing is complete, unsupported FREE recording can instead be blocked or handled by another watermark implementation.

## Manual device checklist

### Telegram iPhone

- record a 10-20 second video;
- confirm video has audio;
- confirm `PromptCam` is visible in the bottom-right of the saved video;
- confirm teleprompter UI itself is not burned into the video;
- confirm orientation is correct;
- confirm front camera recording orientation/mirroring remains acceptable;
- confirm recording does not stutter noticeably;
- inspect `PromptCamWatermark.getStatus()` if possible and confirm `mode: 'watermarked'`.

### Telegram Android

Repeat the same checks.

### Safari / Chrome standalone

Repeat the same checks outside Telegram.

## Important

Do not add subscription decisions directly into `watermark.js`.

The planned flow is:

Telegram verified user -> Worker -> D1 entitlement -> frontend access state -> enable/disable watermark.

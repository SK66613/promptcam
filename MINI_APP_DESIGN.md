# PromptCam Mini App — design direction

## Visual direction

PromptCam uses a dark creator-focused interface inspired by a compact camera tool rather than a generic settings page.

Core traits:

- graphite / near-black background;
- purple-to-blue primary accent;
- compact cards with subtle borders;
- minimal glass effects on the camera screen;
- bright focus line inside the teleprompter;
- large red recording control;
- most screen space belongs to the script or camera, not decoration.

## Editor screen

The editor is intentionally compact:

1. PromptCam brand.
2. Script status (`Черновик`, local save state).
3. Script textarea and word/character counters.
4. Teleprompter settings:
   - speed;
   - text size;
   - background opacity;
   - position.
5. Gradient `Открыть камеру` CTA.

All existing settings continue to be stored locally by the current app logic.

## Camera screen

The camera should feel like a creator tool:

- camera preview fills the available Mini App viewport;
- teleprompter is a translucent dark glass panel;
- purple/blue focus line marks the reading zone;
- REC pill is centered at the top while recording;
- camera switch stays at the top-right;
- teleprompter settings are available through one compact floating control;
- bottom controls are `Сначала`, record/stop, `Старт/Пауза`.

## Back navigation rule

This is important and should be preserved in future PRs.

### Inside Telegram

Do **not** show PromptCam's own back arrow on the camera screen.

Telegram's native Mini App `BackButton` is the single visible back-navigation control. The existing JS bridge handles its click and returns the user from:

- result -> camera;
- camera -> editor;
- editor -> closes the Mini App when appropriate.

The hidden HTML `#backButton` remains in the DOM because the existing Telegram bridge uses its click handler internally to reuse the same camera cleanup logic. It is only visually hidden in Telegram.

### Outside Telegram

In Safari / Chrome, Telegram BackButton does not exist, so PromptCam's own `#backButton` remains visible and functional.

## Fullscreen rule

The fullscreen policy is defined separately in `TELEGRAM_DISPLAY_BEHAVIOR.md`:

- Telegram mobile -> fullscreen;
- Telegram desktop -> normal Mini App window.

The camera fills the PromptCam viewport in both modes; it must not force Telegram Desktop itself into fullscreen.

## Future changes

Before changing camera navigation or fullscreen behavior, verify both documents:

- `MINI_APP_DESIGN.md`
- `TELEGRAM_DISPLAY_BEHAVIOR.md`

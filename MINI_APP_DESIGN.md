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

Do not add a PromptCam header that imitates Telegram, a second close control, or a logo squeezed between Telegram's Back and menu controls.

## Safe-area contract

Telegram chrome is part of the layout contract, not decoration. Shared UI consumes `--app-safe-top`, `--app-safe-bottom`, `--app-safe-left`, and `--app-safe-right`. In standalone browsers these map to CSS environment insets. Telegram overrides them with the largest reported safe/content-safe inset.

On mobile Telegram, `--app-safe-top` also includes an adaptive 72–96 px visual reserve. This keeps branding, the recording HUD, and the teleprompter below the native Close/Back, collapse, and menu controls on iPhones (including Dynamic Island models) and Android without imposing that space on standalone web or Telegram Desktop.

## Camera hierarchy

The visual order is deliberately strict:

1. full-viewport camera preview;
2. readable glass teleprompter and its single glowing focus line;
3. central record/stop control;
4. secondary reset, play/pause, camera switch, and collapsed settings controls.

Camera settings close automatically when recording begins. Secondary controls disappear during recording so they cannot compete with the subject, script, and stop action.

## Fullscreen rule

The fullscreen policy is defined separately in `TELEGRAM_DISPLAY_BEHAVIOR.md`:

- Telegram mobile -> fullscreen;
- Telegram desktop -> normal Mini App window.

The camera fills the PromptCam viewport in both modes; it must not force Telegram Desktop itself into fullscreen.

## Future changes

Before changing camera navigation or fullscreen behavior, verify both documents:

- `MINI_APP_DESIGN.md`
- `TELEGRAM_DISPLAY_BEHAVIOR.md`

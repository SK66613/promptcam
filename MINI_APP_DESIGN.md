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

The product should feel like a creator tool for Reels / Shorts / TikTok, while remaining simple enough to understand immediately.

## Editor screen

The editor is intentionally compact:

1. Centered PromptCam brand and logo.
2. Localized product subtitle (`Телесуфлёр для видео` for the current Russian UI).
3. Script status (`Черновик`, local save state).
4. Script textarea and word/character counters.
5. Teleprompter settings:
   - speed;
   - text size;
   - background opacity;
   - position.
6. Gradient `Открыть камеру` CTA.

There should not be a second Telegram-like header inside the content area. Telegram already owns the native top chrome.

All existing settings continue to be stored locally by the current app logic.

## Telegram safe-area contract

PromptCam layout uses four application-level safe-area variables:

- `--app-safe-top`;
- `--app-safe-bottom`;
- `--app-safe-left`;
- `--app-safe-right`.

Outside Telegram they resolve to the browser / device safe areas.

Inside Telegram they also include Telegram Mini App safe-area and content-safe-area values.

On Telegram mobile the top safe zone additionally reserves an adaptive `72–96px` band. This is intentional: Telegram may draw Close/Back, collapse and menu controls above the WebView, and PromptCam content must begin below them.

Do not place PromptCam branding, REC controls or camera actions underneath Telegram's native top controls.

## Camera screen

The camera should feel like a creator tool:

- camera preview fills the available Mini App viewport;
- teleprompter is a large translucent dark glass panel;
- one purple/blue focus line marks the reading zone;
- REC pill is centered at the top while recording;
- camera switch and settings live in a compact vertical tool rail rather than the Telegram top-chrome zone;
- bottom controls are `Сначала`, record/stop, `Старт/Пауза`.

### Camera hierarchy

The visual priority is always:

1. Camera image.
2. Teleprompter text.
3. Record control.
4. Secondary camera tools.

Do not turn the camera view into a settings dashboard.

## Back navigation rule

This is important and should be preserved in future PRs.

### Inside Telegram

Do **not** show PromptCam's own back arrow on the camera screen.

Telegram's native Mini App `BackButton` is the single visible back-navigation control. The existing JS bridge handles its click and returns the user from:

- result -> camera;
- camera -> editor;
- editor -> closes the Mini App when appropriate.

The hidden HTML `#backButton` remains in the DOM because the existing Telegram bridge uses its click handler internally to reuse the same camera cleanup logic. It is only visually hidden in Telegram.

Never add a second PromptCam `Закрыть`, `Назад` or fake Telegram navigation bar in Telegram mode.

### Outside Telegram

In Safari / Chrome, Telegram BackButton does not exist, so PromptCam's own `#backButton` remains visible and functional.

## Fullscreen rule

The fullscreen policy is defined separately in `TELEGRAM_DISPLAY_BEHAVIOR.md`:

- Telegram mobile -> fullscreen;
- Telegram desktop -> normal Mini App window.

The camera fills the PromptCam viewport in both modes; it must not force Telegram Desktop itself into fullscreen.

## CSS ownership

- `web/style.css` owns the base PromptCam design and camera system.
- `web/telegram.css` owns Telegram-specific safe areas and Telegram-only visibility/layout rules.
- `web/theme-cinematic.css` contains only small creator-theme refinements. Do not use it to create a second competing layout system.

Future cleanup may fold the remaining theme refinements into `style.css`, but there must never be multiple contradictory implementations of the same component.

## Future changes

Before changing camera navigation, safe areas or fullscreen behavior, verify both documents:

- `MINI_APP_DESIGN.md`
- `TELEGRAM_DISPLAY_BEHAVIOR.md`

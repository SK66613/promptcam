# PromptCam: Telegram display behavior

Этот документ фиксирует политику отображения PromptCam внутри Telegram Mini App.

## Главное правило

- **Telegram на мобильном устройстве:** PromptCam всегда старается работать в Telegram fullscreen.
- **Telegram Desktop / macOS / Telegram Web:** PromptCam работает в обычном окне Mini App и не запрашивает fullscreen.
- **Обычный Safari / Chrome вне Telegram:** эта политика не применяется вообще.

## Почему так

На телефоне дополнительное место полезно для камеры и суфлёра: меньше интерфейса Telegram, больше пространства под текст и видео.

На desktop настоящий Telegram fullscreen растягивает Mini App на весь монитор и ухудшает UX. Поэтому на desktop камера заполняет только окно самого Mini App, а Telegram остаётся в обычном оконном режиме.

Важно различать два уровня:

1. **Telegram fullscreen** — Mini App занимает весь экран устройства/монитора.
2. **PromptCam camera view** — `.camera-screen` занимает весь viewport самого Mini App.

На desktop используется только второй уровень: камера остаётся полноразмерной внутри окна PromptCam, но Telegram не разворачивает Mini App на весь монитор.

## Текущая логика

Источник поведения: `web/telegram.js`.

### Mobile

Известные мобильные Telegram platform values в текущей реализации:

- `ios`
- `android`
- `android_x`

Для них PromptCam:

1. вызывает `Telegram.WebApp.ready()`;
2. вызывает `expand()`;
3. вызывает `requestFullscreen()`, если клиент поддерживает этот метод и приложение ещё не fullscreen;
4. повторно применяет fullscreen-политику при открытии камеры;
5. повторно применяет её после события `activated`;
6. если приходит `fullscreenChanged` и fullscreen был потерян, снова запрашивает fullscreen.

Таким образом fullscreen является политикой всего Mini App на мобильном, а не только экрана камеры.

### Desktop

Известные desktop/web platform values в текущей реализации:

- `tdesktop`
- `macos`
- `web`
- `weba`
- `webk`

Для них PromptCam:

- не вызывает `requestFullscreen()`;
- не вызывает `expand()` как часть fullscreen-политики;
- если Mini App уже оказался в Telegram fullscreen и клиент поддерживает `exitFullscreen()`, вызывает `exitFullscreen()`;
- при открытии камеры остаётся в обычном Telegram-окне.

### Неизвестная будущая platform value

Чтобы новый мобильный Telegram-клиент случайно не был принят за desktop, есть fallback:

- pointer должен быть `coarse`;
- меньшая сторона viewport должна быть не больше 1024 px.

Если оба условия выполнены, неизвестная platform value рассматривается как mobile. Иначе — как desktop.

## Диагностика

После загрузки Mini App состояние можно посмотреть через:

```js
window.PromptCamTelegram
```

Полезные поля:

```js
{
  platform,
  isMobile,
  isDesktop,
  fullscreenPolicy
}
```

`fullscreenPolicy` имеет значения:

- `always` — mobile Telegram;
- `never` — desktop Telegram;
- `none` — обычная web-версия вне Telegram.

Также на `<html>` выставляется:

```text
data-telegram="true|false"
data-telegram-device="mobile|desktop|web"
```

## Что проверять после изменений Telegram UI

### iPhone / Android

- Mini App после открытия переходит в fullscreen.
- Редактор, камера и экран результата остаются в fullscreen.
- Кнопка «Открыть камеру» не меняет desktop/mobile policy, а лишь повторно её применяет.
- После возврата в Mini App из background fullscreen восстанавливается.
- Safe areas не перекрывают Dynamic Island / системные панели.

### Telegram Desktop / macOS

- Mini App открывается обычным окном Telegram.
- При нажатии «Открыть камеру» Telegram не переходит в fullscreen.
- Камера занимает всё доступное окно Mini App, но не весь монитор.
- Если Mini App был открыт внешней ссылкой в fullscreen-режиме, PromptCam пытается выйти из Telegram fullscreen.

### Обычный браузер

- Safari и Chrome работают как раньше.
- Telegram fullscreen API не вызывается.

## Совместимость

`requestFullscreen()` и `exitFullscreen()` относятся к Telegram Mini Apps Bot API 8.0+. На старом клиенте PromptCam не должен ломаться: вызовы защищены проверкой наличия метода, а mobile-клиент всё равно получает обычный `expand()` там, где он доступен.

Официальная документация Telegram Mini Apps:

https://core.telegram.org/bots/webapps

## Правило для будущих PR

Не добавлять прямые вызовы `requestFullscreen()` или `exitFullscreen()` в другие файлы. Вся политика fullscreen должна оставаться централизованной в `web/telegram.js`, чтобы mobile и desktop не начали вести себя по-разному в разных экранах PromptCam.

# PromptCam — Telegram Mini App setup

Этот PR не включает оплату Stars. Он только подключает текущую web-версию PromptCam к Telegram Mini Apps и добавляет безопасную серверную проверку `initData`.

## Что уже работает после deploy

- обычный сайт продолжает работать в Safari/Chrome;
- внутри Telegram определяется Mini App окружение;
- вызываются `ready()` и `expand()`;
- при открытии камеры запрашивается fullscreen, если клиент Telegram это поддерживает;
- учитываются Telegram safe areas;
- Telegram Back Button возвращает из результата к камере и из камеры к редактору;
- во время камеры отключаются вертикальные свайпы Telegram, чтобы они не конфликтовали с суфлёром;
- добавлен лёгкий haptic feedback;
- `/api/health` показывает состояние backend;
- `/api/telegram/session` проверяет подпись `Telegram.WebApp.initData` на сервере.

## 1. Создай бота

Создай или выбери бота через @BotFather и настрой для него Mini App / Main Mini App.

URL приложения:

`https://promptcam.cyberian13.workers.dev`

## 2. Добавь bot token в Cloudflare

Токен нельзя коммитить в GitHub.

В Cloudflare открой Worker `promptcam` → Settings → Variables and Secrets и добавь secret:

`TELEGRAM_BOT_TOKEN`

Значение — токен бота из BotFather.

Альтернативно через Wrangler:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

После добавления секрета сделай новый deploy/redeploy.

## 3. Проверка

Открой:

`https://promptcam.cyberian13.workers.dev/api/health`

После настройки секрета ожидается:

```json
{
  "ok": true,
  "service": "promptcam",
  "telegramConfigured": true
}
```

Потом открой PromptCam именно через кнопку Mini App внутри Telegram. В шапке появится Telegram-метка, а после успешной серверной проверки — имя пользователя.

## Безопасность

Frontend не использует `initDataUnsafe` для выдачи доступа или будущей подписки. Все решения о пользователе/тарифе в следующих PR должны опираться только на данные, прошедшие `/api/telegram/session` или эквивалентную серверную проверку.

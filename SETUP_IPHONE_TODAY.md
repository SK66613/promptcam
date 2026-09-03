# Как поставить PromptCam на iPhone сегодня без App Store

## Самый простой путь: Xcode + бесплатный Apple ID

Тебе нужен Mac. С Windows/Linux нельзя локально собрать и подписать iOS-приложение Xcode.

### 1. Установи Xcode

Из Mac App Store. После установки один раз открой Xcode и согласись с лицензией.

### 2. Установи Flutter

Следуй официальной инструкции Flutter для macOS. После установки проверь:

```bash
flutter doctor
```

Исправь пункты Xcode/iOS, которые он покажет.

### 3. Подключи iPhone

Кабелем к Mac, разблокируй iPhone и нажми `Trust This Computer`.

На iOS 16+ включи:

`Settings -> Privacy & Security -> Developer Mode`

Телефон попросит перезагрузку.

### 4. Подготовь этот проект

В Terminal:

```bash
cd /путь/к/promptcam_mvp
./bootstrap_macos.sh
```

Скрипт создаст нативные `ios/` и `android/` папки и добавит privacy-разрешения для камеры, микрофона и сохранения видео.

### 5. Подпиши приложение

```bash
open ios/Runner.xcworkspace
```

В Xcode:

- выбери проект `Runner`;
- Target `Runner`;
- `Signing & Capabilities`;
- включи `Automatically manage signing`;
- `Team` -> твой Apple ID (`Personal Team`);
- Bundle Identifier должен быть уникальным.

### 6. Установи на телефон

В верхней панели Xcode выбери свой iPhone и нажми ▶ Run.

Xcode соберёт и подпишет приложение именно под твой телефон. После этого PromptCam появится на домашнем экране iPhone.

### Почему я не прислал просто IPA

Обычный произвольный `.ipa` iPhone не установит: iOS проверяет code signing и provisioning. Для теста на своём iPhone бесплатный Apple ID можно использовать через Xcode Personal Team. Его provisioning-профили действуют ограниченное время и требуют периодической переустановки.

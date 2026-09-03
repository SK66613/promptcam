# PromptCam MVP

Первая версия мобильного суфлёра на Flutter.

## Что уже есть

- передняя камера по умолчанию;
- переключение передняя/задняя камера;
- запись видео со звуком;
- суфлёр поверх превью камеры;
- автоматическая прокрутка;
- скорость прокрутки;
- изменение размера текста;
- старт/пауза/сброс суфлёра;
- обратный отсчёт 3-2-1 перед записью;
- таймер записи;
- сохранение готового видео в iPhone Photos / Android Gallery;
- текст суфлёра **не записывается** внутрь видео.

## Важно про этот архив

В архиве лежит наш код приложения. Папки `ios/` и `android/` специально создаются на твоём Mac официальной командой текущей установленной версии Flutter. Это надёжнее, чем класть в архив устаревшие Xcode/Gradle-шаблоны.

## Быстрый запуск на iPhone

Нужен Mac, iPhone, Apple ID, Xcode и Flutter.

1. Распакуй проект.
2. В Terminal зайди в папку проекта.
3. Выполни:

```bash
./bootstrap_macos.sh
```

4. Затем:

```bash
open ios/Runner.xcworkspace
```

5. В Xcode выбери `Runner` -> `Signing & Capabilities`.
6. Включи `Automatically manage signing`.
7. В `Team` выбери свой Apple ID / `Personal Team`.
8. Если Xcode ругается на Bundle Identifier, замени его на уникальный, например `com.твоёимя.promptcam` латиницей.
9. Подключи iPhone кабелем, нажми `Trust` на телефоне.
10. На iPhone включи `Settings -> Privacy & Security -> Developer Mode` и перезагрузи телефон, если iOS попросит.
11. В верхней панели Xcode выбери свой iPhone и нажми Run (▶).

После первой успешной подписи можно также запускать из Terminal:

```bash
flutter run
```

## GitHub

Можно загрузить эту папку в новый GitHub repository. После первого запуска `bootstrap_macos.sh` появятся стандартные папки `ios/` и `android/`; их тоже можно закоммитить.

Пример команд:

```bash
git init
git add .
git commit -m "PromptCam MVP"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## Зависимости

- `camera` — камера и запись видео;
- `gal` — сохранение видео в системную галерею/Фото.

## Ограничение бесплатного Apple ID

При использовании бесплатного Xcode Personal Team приложение устанавливается для тестирования на собственное устройство, но development provisioning истекает, поэтому приложение нужно периодически пересобирать/переустанавливать. Платная Apple Developer Program снимает это ограничение для нормального распространения через TestFlight/App Store и других поддерживаемых методов.

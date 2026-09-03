#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Этот скрипт предназначен для macOS, потому что iPhone-сборка требует Xcode."
  exit 1
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter не найден. Сначала установи Flutter и выполни: flutter doctor"
  echo "Официальная инструкция: https://docs.flutter.dev/install/quick"
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode command line tools не найдены. Установи Xcode из App Store и запусти:"
  echo "  xcode-select --install"
  exit 1
fi

if [[ ! -d ios || ! -d android ]]; then
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  echo "Создаю стандартные iOS/Android оболочки Flutter..."
  flutter create \
    --platforms=ios,android \
    --org=com.promptcam \
    --project-name=promptcam \
    "$TMP_DIR/promptcam"

  rm -rf ios android .metadata
  cp -R "$TMP_DIR/promptcam/ios" ./ios
  cp -R "$TMP_DIR/promptcam/android" ./android
  cp "$TMP_DIR/promptcam/.metadata" ./.metadata
fi

PLIST="ios/Runner/Info.plist"
PLIST_BUDDY="/usr/libexec/PlistBuddy"

set_plist_string() {
  local key="$1"
  local value="$2"
  if "$PLIST_BUDDY" -c "Print :$key" "$PLIST" >/dev/null 2>&1; then
    "$PLIST_BUDDY" -c "Set :$key $value" "$PLIST"
  else
    "$PLIST_BUDDY" -c "Add :$key string $value" "$PLIST"
  fi
}

set_plist_string "NSCameraUsageDescription" "PromptCam использует камеру для записи видео."
set_plist_string "NSMicrophoneUsageDescription" "PromptCam использует микрофон для записи звука."
set_plist_string "NSPhotoLibraryAddUsageDescription" "PromptCam сохраняет записанные видео в Фото."
set_plist_string "NSPhotoLibraryUsageDescription" "PromptCam использует доступ к Фото для сохранения видео."

flutter pub get

echo
echo "Готово. Следующий шаг:"
echo "  open ios/Runner.xcworkspace"
echo
echo "В Xcode: Runner -> Signing & Capabilities -> Automatically manage signing -> Team = твой Apple ID (Personal Team)."
echo "Потом подключи iPhone и нажми Run."

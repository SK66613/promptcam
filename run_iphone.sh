#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d ios ]]; then
  echo "Сначала выполни ./bootstrap_macos.sh"
  exit 1
fi

flutter devices

echo
echo "Если iPhone виден выше и Signing уже настроен в Xcode, запусти:"
echo "  flutter run"

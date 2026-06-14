#!/usr/bin/env bash
# Boot iPad simulator, ensure universal CREA build is installed, connect to Metro.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IPAD_ID="${CREA_IPAD_SIMULATOR_ID:-C6A1422B-EC84-49F0-8B73-392EEC35D330}"
DEV_URL='exp+crea-app://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'

metro_ready() {
  curl -sf 'http://127.0.0.1:8081/status' >/dev/null 2>&1
}

device_family() {
  local app
  app=$(xcrun simctl get_app_container "$IPAD_ID" de.creaservices.app 2>/dev/null) || return 1
  plutil -p "$app/Info.plist" 2>/dev/null | rg -q '2\s*$|=> 2' && echo universal || echo iphone-only
}

if ! metro_ready; then
  echo '[crea-app] Starting Metro in Terminal.app…'
  osascript <<EOF
tell application "Terminal"
  activate
  do script "cd '$ROOT' && npm run dev:attach"
end tell
EOF
  for _ in $(seq 1 45); do
    metro_ready && break
    sleep 1
  done
fi

open -a Simulator 2>/dev/null || true
xcrun simctl boot "$IPAD_ID" 2>/dev/null || true

if [ "$(device_family 2>/dev/null || echo missing)" != "universal" ]; then
  echo '[crea-app] Installing universal iPad build (supportsTablet)…'
  cd "$ROOT"
  bash scripts/expo-with-nvm.sh run:ios --scheme CREA --device "$IPAD_ID" --no-bundler
  sleep 2
  xcrun simctl openurl "$IPAD_ID" "$DEV_URL"
else
  xcrun simctl launch "$IPAD_ID" de.creaservices.app 2>/dev/null || true
  xcrun simctl openurl "$IPAD_ID" "$DEV_URL"
fi

echo '[crea-app] iPad dev client ready. Use iPad Simulator window (not iPhone). Reload: ⌘R'

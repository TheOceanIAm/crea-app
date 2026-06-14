#!/usr/bin/env bash
# Start Metro in a real Terminal window (survives Cursor agent sessions) and open the iOS dev client.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IPHONE_ID="${CREA_IPHONE_SIMULATOR_ID:-75A3E9CE-C105-4FE1-8A93-99329FDEED99}"
DEV_URL='exp+crea-app://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'

metro_ready() {
  curl -sf 'http://127.0.0.1:8081/status' >/dev/null 2>&1
}

app_installed() {
  xcrun simctl get_app_container "$IPHONE_ID" de.creaservices.app >/dev/null 2>&1
}

if ! metro_ready; then
  echo '[crea-app] Starting Metro in Terminal.app (keep that window open for reloads)…'
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
  if ! metro_ready; then
    echo '[crea-app] Metro did not become ready on http://127.0.0.1:8081' >&2
    exit 1
  fi
else
  echo '[crea-app] Metro already running on http://127.0.0.1:8081'
fi

open -a Simulator 2>/dev/null || true
xcrun simctl boot "$IPHONE_ID" 2>/dev/null || true

if ! app_installed; then
  echo '[crea-app] CREA not on iPhone simulator — installing dev build…'
  cd "$ROOT"
  bash scripts/expo-with-nvm.sh run:ios --scheme CREA --device "$IPHONE_ID" --no-bundler
  sleep 2
  xcrun simctl openurl "$IPHONE_ID" "$DEV_URL"
else
  xcrun simctl launch "$IPHONE_ID" de.creaservices.app 2>/dev/null || true
  xcrun simctl openurl "$IPHONE_ID" "$DEV_URL"
fi

echo '[crea-app] iPhone dev client ready. Reload in Simulator: ⌘R'

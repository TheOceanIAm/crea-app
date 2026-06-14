#!/usr/bin/env bash
# Start Metro in a real Terminal window (survives Cursor agent sessions) and open the iOS dev client.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_URL='exp+crea-app://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'

metro_ready() {
  curl -sf 'http://127.0.0.1:8081/status' >/dev/null 2>&1
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
xcrun simctl boot 'iPhone 17 Pro Max' 2>/dev/null || true
xcrun simctl openurl booted "$DEV_URL"
echo '[crea-app] Dev client opened. Reload in Simulator: ⌘R'

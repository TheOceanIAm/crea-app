#!/usr/bin/env bash
# Reconnect iPad dev client to localhost Metro (fixes black screen after ⌘R when URL was stale).
set -euo pipefail
IPAD_ID="${CREA_IPAD_SIMULATOR_ID:-C6A1422B-EC84-49F0-8B73-392EEC35D330}"
DEV_URL='exp+crea-app://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'

if ! curl -sf 'http://127.0.0.1:8081/status' >/dev/null 2>&1; then
  echo '[crea-app] Metro is not running on http://127.0.0.1:8081 — start it with: npm run dev:attach' >&2
  exit 1
fi

xcrun simctl terminate "$IPAD_ID" de.creaservices.app 2>/dev/null || true
sleep 0.5
xcrun simctl launch "$IPAD_ID" de.creaservices.app
sleep 1
xcrun simctl openurl "$IPAD_ID" "$DEV_URL"
echo '[crea-app] iPad reconnected to localhost Metro. Reload: ⌘R'

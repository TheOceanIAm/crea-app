#!/usr/bin/env bash
# Stop Metro / Expo dev servers and clear common RN caches (safe for this machine only).
set -u
PORTS=(8081 8082 8083 19000 19001)
for p in "${PORTS[@]}"; do
  lsof -ti tcp:"$p" 2>/dev/null | xargs kill -9 2>/dev/null || true
done
TMP="${TMPDIR:-/tmp}"
# Metro / RN temp caches (names vary by version)
for pat in metro-* haste-map-* react-*; do
  rm -rf "$TMP/$pat" 2>/dev/null || true
done
if command -v watchman >/dev/null 2>&1; then
  watchman watch-del-all 2>/dev/null || true
fi
echo "[crea-app] Ports ${PORTS[*]} cleared; Metro/RN temp caches and watchman watches reset (if present)."

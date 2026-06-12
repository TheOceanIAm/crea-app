#!/usr/bin/env bash
# Capture iOS Simulator screenshots for App Store Connect (native status bar @ 9:41).
#
# Terminal 1: npm run app-store-screenshots:dev   (wait until app is on screen)
# Terminal 2: npm run app-store-screenshots:capture
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/assets/app-store-screenshots/raw}"
DEVICE="${APP_STORE_SCREENSHOT_DEVICE:-iPhone 17 Pro Max}"
WAIT_SEC="${APP_STORE_SCREENSHOT_WAIT:-6}"
FIRST_WAIT_SEC="${APP_STORE_SCREENSHOT_FIRST_WAIT:-12}"
BUNDLE_ID="de.creaservices.app"
MAX_RETRIES="${APP_STORE_SCREENSHOT_RETRIES:-3}"

mkdir -p "$OUT_DIR"

screens=(
  "profile:01-profile"
  "invoices:02-invoices"
  "post-project:03-post-project"
  "project-overview:04-project-overview"
  "production:05-production"
  "availability:06-availability"
  "talent-pool:07-talent-pool"
  "jobs:08-jobs"
  "messages:09-messages"
  "booking:10-booking"
)

echo "[app-store-screenshots] Device: $DEVICE"
echo "[app-store-screenshots] Output: $OUT_DIR"

if ! xcrun simctl list devices available | grep -F "$DEVICE" >/dev/null 2>&1; then
  echo "ERROR: Simulator device not found: $DEVICE"
  exit 1
fi

xcrun simctl boot "$DEVICE" 2>/dev/null || true
open -a Simulator
sleep 2

if ! xcrun simctl list devices booted | grep -q Booted; then
  echo "ERROR: No booted simulator."
  exit 1
fi

if ! xcrun simctl get_app_container booted "$BUNDLE_ID" data >/dev/null 2>&1; then
  echo "ERROR: CREA ($BUNDLE_ID) is not installed on the booted simulator."
  echo "       Run: npm run app-store-screenshots:dev"
  exit 1
fi

echo "[app-store-screenshots] Status bar → 9:41"
xcrun simctl status_bar booted override \
  --time "9:41" \
  --dataNetwork lte \
  --wifiMode active \
  --wifiBars 3 \
  --cellularMode active \
  --cellularBars 4 \
  --batteryState charged \
  --batteryLevel 100

deep_link_urls() {
  local route="$1"
  # Query param on a single route — avoids expo-router Redirect loops.
  printf '%s\n' \
    "exp+crea-app://--/app-store-screenshots?screen=${route}" \
    "exp+crea-app:///app-store-screenshots?screen=${route}" \
    "crea:///app-store-screenshots?screen=${route}" \
    "crea://app-store-screenshots?screen=${route}"
}

open_screenshot_route() {
  local route="$1"
  local cold="${2:-0}"
  if [[ "$cold" == "1" ]]; then
    xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
    sleep 1
    xcrun simctl launch booted "$BUNDLE_ID" >/dev/null
    sleep 3
  fi
  local url
  while IFS= read -r url; do
    if xcrun simctl openurl booted "$url" 2>/dev/null; then
      echo "    opened: $url"
      return 0
    fi
  done < <(deep_link_urls "$route")
  echo "ERROR: Could not open deep link for /app-store-screenshots?screen=${route}"
  return 1
}

# Exit 0 = blank/black frame (retry). Dark CREA UI still has enough accent/text pixels.
is_mostly_black_png() {
  local file="$1"
  node - "$file" <<'NODE'
const fs = require('fs');
const { PNG } = require('pngjs');
const file = process.argv[1];
const buf = fs.readFileSync(file);
const png = PNG.sync.read(buf);
let ui = 0;
const step = 12;
for (let y = 0; y < png.height; y += step) {
  for (let x = 0; x < png.width; x += step) {
    const i = (png.width * y + x) << 2;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const sum = r + g + b;
    const isYellow = r > 170 && g > 170 && b < 120;
    const isUi = isYellow || sum > 72;
    if (isUi) ui++;
  }
}
const samples = Math.ceil(png.width / step) * Math.ceil(png.height / step);
const ratio = ui / samples;
process.exit(ratio < 0.004 ? 0 : 1);
NODE
}

capture_one() {
  local route="$1"
  local out="$2"
  local wait="$3"
  local cold="${4:-0}"
  local attempt=1
  while [[ "$attempt" -le "$MAX_RETRIES" ]]; do
    echo "[app-store-screenshots] → ${route} (attempt ${attempt}/${MAX_RETRIES}, wait ${wait}s)"
    local use_cold="$cold"
    [[ "$attempt" -gt 1 ]] && use_cold=1
    open_screenshot_route "$route" "$use_cold"
    sleep "$wait"
    xcrun simctl io booted screenshot "$out"
    if is_mostly_black_png "$out"; then
      echo "    WARN: screenshot looks blank/black — retrying…"
      attempt=$((attempt + 1))
      wait=$((wait + 3))
      continue
    fi
    echo "    saved ${out}"
    return 0
  done
  echo "ERROR: ${out} still black after ${MAX_RETRIES} tries."
  echo "       Open manually: exp+crea-app://--/app-store-screenshots?screen=${route}"
  return 1
}

cleanup() {
  xcrun simctl status_bar booted clear 2>/dev/null || true
}
trap cleanup EXIT

for entry in "${screens[@]}"; do
  route="${entry%%:*}"
  file="${entry##*:}"
  out="${OUT_DIR}/${file}.png"
  wait="$WAIT_SEC"
  [[ "$file" == "01-profile" ]] && wait="$FIRST_WAIT_SEC"
  capture_one "$route" "$out" "$wait" 0
done

echo ""
echo "Done — ${#screens[@]} screenshots in $OUT_DIR"

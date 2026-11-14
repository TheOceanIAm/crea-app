#!/usr/bin/env bash
# Open the simulator GUI: Device Hub on Xcode 27+, Simulator.app on older Xcode.
set -euo pipefail
UDID="${1:-}"
XCODE_DEV="$(xcode-select -p 2>/dev/null || echo /Applications/Xcode.app/Contents/Developer)"
DEVICE_HUB="${XCODE_DEV}/../Applications/DeviceHub.app"
if [[ -d "$DEVICE_HUB" ]]; then
  open -a "$DEVICE_HUB" 2>/dev/null || open -a "Device Hub" 2>/dev/null || true
  if [[ -n "$UDID" ]]; then
    open "devices://device/open?id=${UDID}" 2>/dev/null || true
  fi
else
  open -a Simulator 2>/dev/null || true
fi

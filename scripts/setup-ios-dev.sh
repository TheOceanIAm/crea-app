#!/usr/bin/env bash
# One-time / post-clone iOS dev setup: Node for Xcode + StoreKit test config in scheme.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/sync-xcode-node.sh"

# RN New Architecture: these files are generated at pod install / build, not shipped in npm.
FABRIC_PROVIDER="$ROOT/node_modules/react-native/React/Fabric/RCTThirdPartyFabricComponentsProvider.mm"
if [[ ! -f "$FABRIC_PROVIDER" ]]; then
  echo "[crea-app] Generating RCTThirdPartyFabricComponentsProvider (missing after npm install)..."
  node "$ROOT/node_modules/react-native/scripts/generate-codegen-artifacts.js" -p "$ROOT" -t ios -o "$ROOT/ios"
fi

bash "$ROOT/scripts/apply-storekit-config.sh"

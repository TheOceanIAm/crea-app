#!/usr/bin/env bash
# One-time / post-clone iOS dev setup: Node for Xcode + StoreKit test config in scheme.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/sync-xcode-node.sh"
bash "$ROOT/scripts/apply-storekit-config.sh"

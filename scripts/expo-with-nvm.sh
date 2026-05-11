#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# npm (and some GUI installs) set this; nvm refuses to run until it is unset.
unset npm_config_prefix NPM_CONFIG_PREFIX 2>/dev/null || true
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  if [[ -f "$ROOT/.nvmrc" ]]; then
    nvm install
  fi
fi
node "$ROOT/scripts/ensure-supported-node.mjs"
exec npx expo "$@"

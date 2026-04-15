#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$REF" && -f "$ROOT/.env.local" ]]; then
  REF="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$ROOT/.env.local" | sed -n 's|^EXPO_PUBLIC_SUPABASE_URL=https://\([^.]*\)\.supabase\.co.*|\1|p' | head -1)"
fi
if [[ -z "$REF" ]]; then
  echo "Set SUPABASE_PROJECT_REF or add EXPO_PUBLIC_SUPABASE_URL to .env.local"
  exit 1
fi
exec npx supabase functions deploy notify-message-push --project-ref "$REF"

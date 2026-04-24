#!/usr/bin/env bash
# Deploy all SQL under supabase/sql/ to the linked Supabase project, then deploy Edge Functions.
# Prerequisites:
#   1) npx supabase login   (or export SUPABASE_ACCESS_TOKEN)
#   2) Optional: SUPABASE_PROJECT_REF=xxxx — otherwise ref is read from .env.local EXPO_PUBLIC_SUPABASE_URL

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Either a Dashboard access token (sbp_…) or an interactive `npx supabase login` session works.
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  if ! npx supabase projects list >/dev/null 2>&1; then
    echo "Error: Supabase CLI is not authenticated."
    echo "  Run:  npx supabase login"
    echo "  Or:   export SUPABASE_ACCESS_TOKEN=\"sbp_…\"  (Dashboard → Account → Access Tokens)"
    exit 1
  fi
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$PROJECT_REF" && -f "$ROOT/.env.local" ]]; then
  PROJECT_REF="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$ROOT/.env.local" | sed -n 's|^EXPO_PUBLIC_SUPABASE_URL=https://\([^.]*\)\.supabase\.co.*|\1|p' | head -1)"
fi
if [[ -z "$PROJECT_REF" ]]; then
  echo "Error: Could not determine project ref. Set SUPABASE_PROJECT_REF or EXPO_PUBLIC_SUPABASE_URL in .env.local"
  exit 1
fi

echo "Project ref: $PROJECT_REF"
npx supabase link --project-ref "$PROJECT_REF" --yes

# Order: platform + schema extensions → features → CEO/RPCs → public share.
# Omit extend_profile_share_public_rates_availability.sql (same as public_share_rpcs profile_share_public).
SQL_FILES=(
  platform_settings.sql
  crea_app_features.sql
  extend_profile_identity.sql
  extend_profile_role_ceo.sql
  extend_profile_settings_pages.sql
  extend_profile_rates.sql
  add_profile_availability.sql
  add_profile_onboarding.sql
  add_profile_terms_accepted.sql
  extend_profile_public_widgets.sql
  extend_invoices_currency.sql
  extend_invoices_timestamps.sql
  company_jobs_write.sql
  messaging_block_inbound_to_ceo.sql
  messaging_messages_delete_policy.sql
  storage_avatars_policies.sql
  subscription_revenue.sql
  project_workspace_native.sql
  ceo_platform_settings_install.sql
  ceo_dashboard_rpc.sql
  ceo_admin_rpcs.sql
  ceo_list_rpc_hide_login_emails.sql
  extend_profile_public_features.sql
  projects_scheduling_calendar.sql
  public_share_rpcs.sql
)

for f in "${SQL_FILES[@]}"; do
  path="$ROOT/supabase/sql/$f"
  if [[ ! -f "$path" ]]; then
    echo "Warning: missing $path — skip"
    continue
  fi
  echo ""
  echo ">>> Applying $f ..."
  npx supabase db query --linked -f "$path" -o table
done

echo ""
echo ">>> Deploying Edge Function brief-ai ..."
npx supabase functions deploy brief-ai --project-ref "$PROJECT_REF"

echo ""
echo ">>> Deploying Edge Function notify-message-push (Expo push for new DMs) ..."
npx supabase functions deploy notify-message-push --project-ref "$PROJECT_REF"

echo ""
echo "Done. If brief-ai needs OpenAI:"
echo "  npx supabase secrets set --project-ref $PROJECT_REF OPENAI_API_KEY=sk-..."
echo "Push: optional — npx supabase secrets set --project-ref $PROJECT_REF EXPO_ACCESS_TOKEN=expo_..."
echo "      (only if you enabled enhanced push security on expo.dev; otherwise Expo accepts sends without it.)"
echo "Storage: create private bucket project-files in Dashboard if not exists (see project_workspace_native.sql)."

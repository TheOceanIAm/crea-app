/**
 * Local demo workspace (`/project/demo`). No Supabase project rows.
 *
 * - Development: always on (`__DEV__`).
 * - TestFlight / release: set `EXPO_PUBLIC_ENABLE_DEMO_WORKSPACE=true` at build time (e.g. in eas.json).
 *   Remove or set to `false` for a public App Store build if you don't want the entry.
 *
 * Optional: `EXPO_PUBLIC_DEMO_PROJECT_ID=<uuid>` — then `/project/demo` redirects to `/project/[id]`
 * so Production, and DB behave like production.
 * CEO accounts: run `supabase/sql/ceo_project_workspace_access.sql` (or full deploy) so RLS allows opening any project.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isDevDemoWorkspaceRouteEnabled(): boolean {
  if (__DEV__) return true
  const v = process.env.EXPO_PUBLIC_ENABLE_DEMO_WORKSPACE
  return v === '1' || v === 'true'
}

/** If set to a valid project UUID, `app/project/demo.tsx` opens that real workspace instead of the mock UI. */
export function getDevDemoLinkedProjectId(): string | null {
  const raw = (process.env.EXPO_PUBLIC_DEMO_PROJECT_ID ?? '').trim()
  if (!raw || !UUID_RE.test(raw)) return null
  return raw
}

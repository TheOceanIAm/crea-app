/**
 * Local demo workspace (`/project/demo`). No Supabase project rows.
 *
 * - Development: always on (`__DEV__`).
 * - TestFlight / release: set `EXPO_PUBLIC_ENABLE_DEMO_WORKSPACE=true` at build time (e.g. in eas.json).
 *   Remove or set to `false` for a public App Store build if you don't want the entry.
 */
export function isDevDemoWorkspaceRouteEnabled(): boolean {
  if (__DEV__) return true
  const v = process.env.EXPO_PUBLIC_ENABLE_DEMO_WORKSPACE
  return v === '1' || v === 'true'
}

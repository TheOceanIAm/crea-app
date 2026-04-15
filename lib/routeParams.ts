/**
 * Expo Router / React Navigation can pass dynamic segments as `string | string[]`.
 * Using the param without normalizing breaks `typeof x === 'string'` checks and loads the wrong profile.
 */
export function firstRouteParam(v: string | string[] | undefined): string | null {
  if (v == null) return null
  const raw = Array.isArray(v) ? v[0] : v
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  try {
    return decodeURIComponent(t)
  } catch {
    return t
  }
}

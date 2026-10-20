/** Minimum length for a profile display name (matches onboarding validation). */
export const PROFILE_DISPLAY_NAME_MIN = 2

/** Labels we show when no real name exists. Never treat these as a saved name. */
const PLACEHOLDER_PROFILE_NAMES = new Set([
  'unnamed',
  'unknown',
  'user',
  'freelancer',
  'company',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  '-',
])

export function isPlaceholderProfileName(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  return PLACEHOLDER_PROFILE_NAMES.has(value.trim().toLowerCase())
}

export function isMeaningfulProfileName(value: string | null | undefined): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length >= PROFILE_DISPLAY_NAME_MIN &&
    !isPlaceholderProfileName(value)
  )
}

function meaningfulString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isMeaningfulProfileName(trimmed) ? trimmed : null
}

function namePart(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || isPlaceholderProfileName(trimmed)) return ''
  return trimmed
}

/** Apple / some OAuth providers send the name as an object, not a string. */
function nameFromPersonObject(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  const given = namePart(o.given_name) || namePart(o.givenName) || namePart(o.first_name) || namePart(o.firstName)
  const family = namePart(o.family_name) || namePart(o.familyName) || namePart(o.last_name) || namePart(o.lastName)
  const joined = [given, family].filter(Boolean).join(' ').trim()
  return isMeaningfulProfileName(joined) ? joined : null
}

/** Auth signup / OAuth often stores the display name under different keys. */
export function nameFromAuthMetadata(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null
  for (const key of ['name', 'full_name', 'display_name']) {
    const direct = meaningfulString(meta[key])
    if (direct) return direct
    const fromObject = nameFromPersonObject(meta[key])
    if (fromObject) return fromObject
  }
  const given = namePart(meta.given_name) || namePart(meta.givenName) || namePart(meta.first_name) || namePart(meta.firstName)
  const family = namePart(meta.family_name) || namePart(meta.familyName) || namePart(meta.last_name) || namePart(meta.lastName)
  const joined = [given, family].filter(Boolean).join(' ').trim()
  return isMeaningfulProfileName(joined) ? joined : null
}

/** Last-resort label when profiles.name was never synced (better than generic "Freelancer"). */
export function nameFromEmailAddress(email: string | null | undefined): string | null {
  const raw = email?.trim()
  if (!raw || !raw.includes('@')) return null
  const local = raw.split('@')[0]?.replace(/[._+-]+/g, ' ').trim()
  if (!local || local.length < PROFILE_DISPLAY_NAME_MIN || /^\d+$/.test(local)) return null
  if (isPlaceholderProfileName(local)) return null
  return local.replace(/\b\w/g, (c) => c.toUpperCase())
}

export type ResolveProfileDisplayNameOptions = {
  authMetadata?: Record<string, unknown> | null
  /** Second stored name, e.g. company_profiles.company_name. */
  altName?: string | null
  email?: string | null
  /** Shown when no better source exists — default "Freelancer". */
  fallback?: string
}

/**
 * Single source of truth for how we show a person's name in the app.
 * Order: profiles.name → alt name → auth metadata → email local-part → fallback.
 * Placeholder values such as "Unnamed" are skipped so a real signup name can surface.
 */
export function resolveProfileDisplayName(
  profileName: string | null | undefined,
  opts?: ResolveProfileDisplayNameOptions
): string {
  const stored = meaningfulString(profileName)
  if (stored) return stored

  const alt = meaningfulString(opts?.altName)
  if (alt) return alt

  const fromAuth = nameFromAuthMetadata(opts?.authMetadata ?? null)
  if (fromAuth) return fromAuth

  const fromEmail = nameFromEmailAddress(opts?.email)
  if (fromEmail) return fromEmail

  return opts?.fallback ?? 'Freelancer'
}

/** Minimum length for a profile display name (matches onboarding validation). */
export const PROFILE_DISPLAY_NAME_MIN = 2

export function isMeaningfulProfileName(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length >= PROFILE_DISPLAY_NAME_MIN
}

export function nameFromAuthMetadata(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null
  for (const key of ['name', 'full_name', 'display_name']) {
    const v = meta[key]
    if (typeof v === 'string' && isMeaningfulProfileName(v)) return v.trim()
  }
  return null
}

export function nameFromEmailAddress(email: string | null | undefined): string | null {
  const raw = email?.trim()
  if (!raw || !raw.includes('@')) return null
  const local = raw.split('@')[0]?.replace(/[._+-]+/g, ' ').trim()
  if (!local || local.length < PROFILE_DISPLAY_NAME_MIN || /^\d+$/.test(local)) return null
  return local.replace(/\b\w/g, (c) => c.toUpperCase())
}

export type ResolveProfileDisplayNameOptions = {
  authMetadata?: Record<string, unknown> | null
  email?: string | null
  fallback?: string
}

export function resolveProfileDisplayName(
  profileName: string | null | undefined,
  opts?: ResolveProfileDisplayNameOptions
): string {
  const pn = profileName != null ? String(profileName).trim() : ''
  if (isMeaningfulProfileName(pn)) return pn

  const fromAuth = nameFromAuthMetadata(opts?.authMetadata ?? null)
  if (fromAuth) return fromAuth

  const fromEmail = nameFromEmailAddress(opts?.email)
  if (fromEmail) return fromEmail

  return opts?.fallback ?? 'Freelancer'
}

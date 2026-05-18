/**
 * Platform exploration window (matches crea-services `lib/platform-trial.ts`).
 * Source of truth for the end date is `profiles.trial_ends_at`; fallback aligns with web when missing.
 */

const DISPLAY_FALLBACK_TRIAL_DAYS = 90

function trimIso(s: string | null | undefined): string {
  return typeof s === 'string' ? s.trim() : ''
}

export function effectivePlatformTrialEndMs(trialEndsAt: string | null | undefined): number | null {
  const s = trimIso(trialEndsAt)
  if (!s) return null
  const end = new Date(s).getTime()
  if (Number.isNaN(end)) return null
  return end
}

/** End timestamp: profile column if set; otherwise signup + 90d (same default as live web). */
export function resolvePlatformTrialEndMs(
  trialEndsAt: string | null | undefined,
  accountCreatedAtIso: string | null | undefined
): number | null {
  const fromProfile = effectivePlatformTrialEndMs(trialEndsAt)
  if (fromProfile !== null) return fromProfile
  const c = trimIso(accountCreatedAtIso)
  if (!c) return null
  const created = new Date(c).getTime()
  if (Number.isNaN(created)) return null
  return created + DISPLAY_FALLBACK_TRIAL_DAYS * 86_400_000
}

export function isWithinPlatformTrialPeriod(
  trialEndsAt: string | null | undefined,
  accountCreatedAtIso: string | null | undefined
): boolean {
  const end = resolvePlatformTrialEndMs(trialEndsAt, accountCreatedAtIso)
  if (end === null) return false
  return Date.now() < end
}

export function formatPlatformTrialEndDate(
  trialEndsAt: string | null | undefined,
  accountCreatedAtIso: string | null | undefined
): string {
  const end = resolvePlatformTrialEndMs(trialEndsAt, accountCreatedAtIso)
  if (end === null) return 'the end of your trial'
  return new Date(end).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Platform exploration window (matches crea-services `lib/platform-trial.ts`).
 * Source of truth for the end date is `profiles.trial_ends_at`; fallback aligns with web when missing.
 */

export const PLATFORM_TRIAL_DAYS = 30

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

/** End timestamp: profile column if set; otherwise signup + {@link PLATFORM_TRIAL_DAYS}d. */
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
  return created + PLATFORM_TRIAL_DAYS * 86_400_000
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

/** Whole days remaining in the platform trial (0 when expired). */
export function platformTrialDaysLeft(
  trialEndsAt: string | null | undefined,
  accountCreatedAtIso: string | null | undefined
): number | null {
  const end = resolvePlatformTrialEndMs(trialEndsAt, accountCreatedAtIso)
  if (end === null) return null
  const msLeft = end - Date.now()
  if (msLeft <= 0) return 0
  return Math.ceil(msLeft / 86_400_000)
}

/** Elapsed trial progress for the banner bar (0–100). */
export function platformTrialProgressPercent(daysLeft: number): number {
  const clamped = Math.max(0, Math.min(PLATFORM_TRIAL_DAYS, daysLeft))
  return Math.round(((PLATFORM_TRIAL_DAYS - clamped) / PLATFORM_TRIAL_DAYS) * 100)
}

export function platformTrialDaysFreeLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Pro trial ended'
  return daysLeft === 1 ? '1 day of Pro left' : `${daysLeft} days of Pro left`
}

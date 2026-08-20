import { isMeaningfulProfileName } from '@/lib/resolveProfileDisplayName'

export type ProfileOnboardingFields = {
  onboarding_completed?: boolean | null
  name?: string | null
} | null

/**
 * Incomplete until the user has a real display name AND onboarding is marked done.
 * Historical backfill set onboarding_completed=true for everyone — name is the hard gate.
 */
export function profileNeedsOnboarding(profile: ProfileOnboardingFields): boolean {
  if (!profile) return true
  if (!isMeaningfulProfileName(profile.name)) return true
  return profile.onboarding_completed !== true
}

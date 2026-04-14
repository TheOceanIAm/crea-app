export type ProfileOnboardingFields = {
  onboarding_completed?: boolean | null
} | null

/** No profile row, or onboarding not marked complete (anything other than true). */
export function profileNeedsOnboarding(profile: ProfileOnboardingFields): boolean {
  if (!profile) return true
  return profile.onboarding_completed !== true
}

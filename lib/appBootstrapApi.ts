import type { User } from '@supabase/supabase-js'

import { fetchCreaApi } from '@/lib/creaApiFetch'

export type AppBootstrapProfile = {
  name: string | null
  role: string | null
  avatar_url: string | null
  onboarding_completed: boolean
  trial_ends_at: string | null
  created_at: string | null
  subscription_tier: string | null
  company_subscription_plan: string | null
}

export type AppBootstrapPayload = {
  profile: AppBootstrapProfile
}

export async function fetchAppBootstrap(): Promise<{
  payload: AppBootstrapPayload | null
  error: string | null
}> {
  const { data, error } = await fetchCreaApi<AppBootstrapPayload>('/api/app/bootstrap', {
    method: 'GET',
  })
  if (error || !data?.profile) {
    return { payload: null, error: error ?? 'invalid_bootstrap' }
  }
  return { payload: data, error: null }
}

export function bootstrapProfileToHints(
  profile: AppBootstrapProfile,
  user: User
): { onboardingCompleted: boolean; role: string | null } {
  const role =
    (typeof profile.role === 'string' && profile.role.trim()) ||
    (typeof user.user_metadata?.role === 'string' ? String(user.user_metadata.role) : null)
  return {
    onboardingCompleted: profile.onboarding_completed === true,
    role,
  }
}

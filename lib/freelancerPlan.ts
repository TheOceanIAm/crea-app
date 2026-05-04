import type { User } from '@supabase/supabase-js'

export type FreelancerPlan = 'workspace' | 'starter' | 'pro' | 'premium'

function norm(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
}

export function resolveFreelancerPlanFromUser(user: User | null | undefined): FreelancerPlan {
  const um = user?.user_metadata as Record<string, unknown> | undefined
  const raw = um?.freelancer_plan ?? um?.plan ?? um?.subscription_tier ?? um?.freelancer_tier
  const p = norm(raw)
  if (p === 'workspace') return 'workspace'
  if (p === 'pro') return 'pro'
  if (p === 'premium') return 'premium'
  return 'starter'
}

export function isFreelancerWorkspaceOnlyPlan(plan: FreelancerPlan): boolean {
  return plan === 'workspace'
}

export function isFreelancerStarterPlan(plan: FreelancerPlan): boolean {
  return plan === 'starter'
}

/** Talent pool browse + favorites: freelancers need Pro or Premium (not Starter / Workspace). */
export function isFreelancerTalentPoolPlan(plan: FreelancerPlan): boolean {
  return plan === 'pro' || plan === 'premium'
}

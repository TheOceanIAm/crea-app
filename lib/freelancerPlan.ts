import type { User } from '@supabase/supabase-js'
import type { NormalizedFreelancerPlan } from '@/lib/billingDisplay'
import { normalizeFreelancerPlanKey } from '@/lib/billingDisplay'

/** @deprecated Use NormalizedFreelancerPlan — kept for gradual migration. */
export type FreelancerPlan = NormalizedFreelancerPlan

export function resolveFreelancerPlanFromUser(user: User | null | undefined): NormalizedFreelancerPlan {
  if (!user?.user_metadata) return 'free'
  const m = user.user_metadata as Record<string, unknown>
  const raw = m.freelancer_plan ?? m.plan ?? m.subscription_tier ?? m.freelancer_tier
  return normalizeFreelancerPlanKey(raw)
}

export function resolveFreelancerPlanFromUserAndProfileTier(
  user: User | null | undefined,
  profilesSubscriptionTier: unknown
): NormalizedFreelancerPlan {
  const fromUser = resolveFreelancerPlanFromUser(user)
  if (fromUser === 'pro') return 'pro'
  return normalizeFreelancerPlanKey(profilesSubscriptionTier)
}

export function isFreelancerPro(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

export function freelancerCanApplyToJobs(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

export function freelancerCanPostJobs(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

export function freelancerHasSunPlanner(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

export function freelancerHasBriefAI(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

export function freelancerHasInvoicing(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

export function freelancerWorkspaceAccess(plan: NormalizedFreelancerPlan): 'full' | 'limited' {
  return plan === 'pro' ? 'full' : 'limited'
}

/** @deprecated Use !isFreelancerPro(plan) */
export function isFreelancerWorkspaceOnlyPlan(plan: NormalizedFreelancerPlan): boolean {
  return !isFreelancerPro(plan)
}

/** @deprecated Use !isFreelancerPro(plan) */
export function isFreelancerStarterPlan(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'free'
}

/** @deprecated Use isFreelancerPro */
export function isFreelancerTalentPoolPlan(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

/** @deprecated Use isFreelancerPro */
export function canFreelancerCreatePrivateProjects(plan: NormalizedFreelancerPlan): boolean {
  return plan === 'pro'
}

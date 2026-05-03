import type { FreelancerPlan } from '@/lib/freelancerPlan'

/** Trial length for Sun Planner on Workspace-only freelancer plan (days). */
export const WORKSPACE_SUN_PLANNER_TRIAL_DAYS = 14

const MS_PER_DAY = 86400000

/**
 * Whether a freelancer may use Sun Planner on Production.
 * - Starter / Pro / Premium: always yes.
 * - Workspace: yes until WORKSPACE_SUN_PLANNER_TRIAL_DAYS after trialStartedAt (first touch via RPC).
 */
export function freelancerSunPlannerAllowed(
  plan: FreelancerPlan,
  trialStartedAtIso: string | null
): boolean {
  if (plan === 'starter' || plan === 'pro' || plan === 'premium') return true
  if (plan !== 'workspace') return false
  if (!trialStartedAtIso) return false
  const start = new Date(trialStartedAtIso).getTime()
  if (Number.isNaN(start)) return false
  const end = start + WORKSPACE_SUN_PLANNER_TRIAL_DAYS * MS_PER_DAY
  return Date.now() < end
}

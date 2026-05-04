import type { FreelancerPlan } from '@/lib/freelancerPlan'

/** 14-day trial for Workspace Production (Sun + Weather) and Starter Sun Planner (Sun only). */
export const PRODUCTION_SUN_PLANNER_TRIAL_DAYS = 14

/** @deprecated use PRODUCTION_SUN_PLANNER_TRIAL_DAYS */
export const WORKSPACE_SUN_PLANNER_TRIAL_DAYS = PRODUCTION_SUN_PLANNER_TRIAL_DAYS

const MS_PER_DAY = 86400000

function isWithinProductionTrial(trialStartedAtIso: string | null): boolean {
  if (!trialStartedAtIso) return false
  const start = new Date(trialStartedAtIso).getTime()
  if (Number.isNaN(start)) return false
  return Date.now() < start + PRODUCTION_SUN_PLANNER_TRIAL_DAYS * MS_PER_DAY
}

/**
 * Sun Planner (Production): Pro / Premium full; Workspace & Starter within 14-day trial from `touch_sun_planner_trial_start`.
 */
export function freelancerProductionSunAllowed(
  plan: FreelancerPlan,
  trialStartedAtIso: string | null
): boolean {
  if (plan === 'pro' || plan === 'premium') return true
  if (plan === 'workspace' || plan === 'starter') return isWithinProductionTrial(trialStartedAtIso)
  return false
}

/**
 * Weather (Production): Starter / Pro / Premium full; Workspace only within the same 14-day trial window as Sun.
 */
export function freelancerProductionWeatherAllowed(
  plan: FreelancerPlan,
  trialStartedAtIso: string | null
): boolean {
  if (plan === 'starter' || plan === 'pro' || plan === 'premium') return true
  if (plan === 'workspace') return isWithinProductionTrial(trialStartedAtIso)
  return false
}

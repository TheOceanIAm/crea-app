import type { NormalizedFreelancerPlan } from '@/lib/billingDisplay'
import { freelancerHasSunPlanner } from '@/lib/freelancerPlan'

/** Sun Planner (Production): Pro only. */
export function freelancerProductionSunAllowed(
  plan: NormalizedFreelancerPlan,
  _trialStartedAtIso: string | null
): boolean {
  return freelancerHasSunPlanner(plan)
}

/** Weather (Production): all tiers. */
export function freelancerProductionWeatherAllowed(
  _plan: NormalizedFreelancerPlan,
  _trialStartedAtIso: string | null
): boolean {
  return true
}

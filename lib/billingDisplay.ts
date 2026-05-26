/** Normalized freelancer tier from `user_metadata.freelancer_plan`. */
export type NormalizedFreelancerPlan = 'free' | 'pro'

const LEGACY_FREELANCER_PRO = new Set(['pro', 'premium'])
const LEGACY_FREELANCER_FREE = new Set(['free', 'workspace', 'starter', ''])

export function normalizeFreelancerPlanKey(raw: unknown): NormalizedFreelancerPlan {
  const p = String(raw ?? 'free').toLowerCase().trim()
  if (LEGACY_FREELANCER_PRO.has(p)) return 'pro'
  if (LEGACY_FREELANCER_FREE.has(p)) return 'free'
  return 'free'
}

export function freelancerPlanLabel(plan: NormalizedFreelancerPlan): string {
  return plan === 'pro' ? 'Pro' : 'Free'
}

export function freelancerPlanDescription(plan: NormalizedFreelancerPlan): string {
  if (plan === 'pro') {
    return 'Full access: apply to jobs, get invited, post jobs, Sun Planner, Brief AI, Invoicing, and full Workspace.'
  }
  return 'Browse all job listings and use Workspace (Call Sheet + Shot List only). Upgrade to Pro to apply, post jobs, and unlock production tools.'
}

/** Company tier from Stripe `user_metadata.company_plan`. */
export type CompanyStripePlan = 'free' | 'pro' | null

const LEGACY_COMPANY_PRO = new Set(['pro', 'agency', 'business', 'enterprise', 'professional'])
const LEGACY_COMPANY_FREE = new Set(['free', 'studio', 'starter', 'basic', 'premium', ''])

export function normalizeCompanyStripePlan(raw: unknown): CompanyStripePlan {
  const p = String(raw ?? '').toLowerCase().trim()
  if (p === '') return null
  if (LEGACY_COMPANY_PRO.has(p)) return 'pro'
  if (LEGACY_COMPANY_FREE.has(p)) return 'free'
  return null
}

export function companyStripePlanLabel(plan: CompanyStripePlan): string {
  switch (plan) {
    case 'pro':
      return 'Pro'
    case 'free':
      return 'Free trial'
    default:
      return 'No active subscription'
  }
}

export function companyStripePlanDescription(plan: CompanyStripePlan): string {
  switch (plan) {
    case 'pro':
      return 'Unlimited job listings and pool saves, all features, 2 team seats included (extra seats €12.99/mo each).'
    case 'free':
      return '1 job listing per month on Free — upgrade to Pro for unlimited listings and full hiring tools.'
    default:
      return 'Choose Pro on Pricing to unlock job postings and hiring tools.'
  }
}

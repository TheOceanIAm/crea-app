import type { CompanySubscriptionPlanDb } from '@/lib/companyPlanFromSession'

/** Effective company tier for limits & feature gates. */
export type ResolvedCompanyPlan = CompanySubscriptionPlanDb

export function resolveCompanyPlanForAccess(raw: unknown): ResolvedCompanyPlan {
  const p = String(raw ?? '').toLowerCase().trim()
  if (p === 'pro' || p === 'agency' || p === 'business' || p === 'enterprise' || p === 'professional') {
    return 'pro'
  }
  return 'free'
}

export function isCompanyPro(plan: ResolvedCompanyPlan): boolean {
  return plan === 'pro'
}

export function companyHasBryterAndAxa(plan: ResolvedCompanyPlan): boolean {
  return plan === 'pro'
}

export function companyHasAccountingIntegrations(plan: ResolvedCompanyPlan): boolean {
  return plan === 'pro'
}

export function maxActiveJobListings(plan: ResolvedCompanyPlan): number {
  return plan === 'pro' ? Number.POSITIVE_INFINITY : 0
}

export function maxPoolSaves(plan: ResolvedCompanyPlan): number {
  return plan === 'pro' ? Number.POSITIVE_INFINITY : 0
}

export function maxTeamSeats(plan: ResolvedCompanyPlan, extraSeats = 0): number {
  if (plan !== 'pro') return 0
  const extra = Number.isFinite(extraSeats) ? Math.max(0, Math.floor(extraSeats)) : 0
  return 2 + extra
}

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

/** Platform trial grants Pro-level access for feature gates. */
export function companyPlanWithPlatformTrial(
  plan: ResolvedCompanyPlan,
  inPlatformTrial: boolean
): ResolvedCompanyPlan {
  return inPlatformTrial ? 'pro' : plan
}

export function companyCanReviewApplications(plan: ResolvedCompanyPlan): boolean {
  return isCompanyPro(plan)
}

export function companyHasBryterAndAxa(plan: ResolvedCompanyPlan): boolean {
  return plan === 'pro'
}

export function companyHasAccountingIntegrations(plan: ResolvedCompanyPlan): boolean {
  return plan === 'pro'
}

/** Free companies (after platform trial): one new listing per calendar month (UTC). */
export const COMPANY_FREE_JOB_LISTINGS_PER_MONTH = 1

/** @deprecated Use COMPANY_FREE_JOB_LISTINGS_PER_MONTH */
export const COMPANY_FREE_ACTIVE_JOB_LISTINGS = COMPANY_FREE_JOB_LISTINGS_PER_MONTH

export function companyJobListingMonthStartUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export function companyJobListingPostCap(
  plan: ResolvedCompanyPlan,
  inPlatformTrial: boolean
): number {
  if (plan === 'pro' || inPlatformTrial) return Number.POSITIVE_INFINITY
  return COMPANY_FREE_JOB_LISTINGS_PER_MONTH
}

export function maxActiveJobListings(plan: ResolvedCompanyPlan): number {
  return plan === 'pro' ? Number.POSITIVE_INFINITY : COMPANY_FREE_JOB_LISTINGS_PER_MONTH
}

export function companyFreeJobListingLimitMessage(): string {
  return `Free includes ${COMPANY_FREE_JOB_LISTINGS_PER_MONTH} job listing per month. Upgrade to Pro for unlimited listings.`
}

export function maxPoolSaves(plan: ResolvedCompanyPlan): number {
  return plan === 'pro' ? Number.POSITIVE_INFINITY : 0
}

export function maxTeamSeats(plan: ResolvedCompanyPlan, extraSeats = 0): number {
  if (plan !== 'pro') return 0
  const extra = Number.isFinite(extraSeats) ? Math.max(0, Math.floor(extraSeats)) : 0
  return 2 + extra
}

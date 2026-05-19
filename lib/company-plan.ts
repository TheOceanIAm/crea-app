import type { CompanySubscriptionPlanDb } from '@/lib/companyPlanFromSession'

/** Mirrors crea-services `resolveCompanyPlanForAccess`. */
export function resolveCompanyPlanForAccess(raw: unknown): CompanySubscriptionPlanDb {
  const p = String(raw ?? '')
    .toLowerCase()
    .trim()
  if (p === 'studio' || p === 'agency' || p === 'business' || p === 'enterprise') return p
  return 'studio'
}

/** Business / Enterprise — Bryter & Axa partners hub. */
export function companyHasBryterAndAxa(plan: CompanySubscriptionPlanDb): boolean {
  return plan === 'business' || plan === 'enterprise'
}

import type { User } from '@supabase/supabase-js'

/** Company billing tier — aligned with crea-services + DB check (free | pro). */
export type CompanySubscriptionPlanDb = 'free' | 'pro'

/** Mirrors crea-services `companySubscriptionPlanForDb`. */
export function companySubscriptionPlanForDb(raw: unknown): CompanySubscriptionPlanDb {
  const p = String(raw ?? '').toLowerCase().trim()
  if (p === 'pro' || p === 'agency' || p === 'business' || p === 'enterprise' || p === 'professional') {
    return 'pro'
  }
  return 'free'
}

/**
 * Auth metadata (`company_plan`) → `company_profiles.subscription_plan` → legacy `profiles.subscription_tier`.
 */
export function resolveCompanySubscriptionPlanFromSources(
  user: User | null | undefined,
  profilesSubscriptionTier: unknown,
  companyProfileSubscriptionPlan: unknown
): CompanySubscriptionPlanDb {
  const meta = user?.user_metadata as Record<string, unknown> | undefined
  const metaPlan = meta?.company_plan
  if (String(metaPlan ?? '').trim() !== '') {
    return companySubscriptionPlanForDb(metaPlan)
  }
  if (String(companyProfileSubscriptionPlan ?? '').trim() !== '') {
    return companySubscriptionPlanForDb(companyProfileSubscriptionPlan)
  }
  return companySubscriptionPlanForDb(profilesSubscriptionTier)
}

import type { User } from '@supabase/supabase-js'

/**
 * Company billing tier — aligned with crea-services `lib/company-plan.ts`
 * (`company_profiles.subscription_plan`, Stripe `user_metadata.company_plan`).
 */
export type CompanySubscriptionPlanDb = 'studio' | 'agency' | 'business' | 'enterprise'

/** Mirrors crea-services `companySubscriptionPlanForDb`. */
export function companySubscriptionPlanForDb(raw: unknown): CompanySubscriptionPlanDb {
  const p = String(raw ?? '')
    .toLowerCase()
    .trim()
  if (p === 'agency' || p === 'business' || p === 'enterprise') return p
  if (p === 'pro' || p === 'professional') return 'agency'
  if (
    p === 'studio' ||
    p === 'starter' ||
    p === 'free' ||
    p === 'basic' ||
    p === 'premium' ||
    p === ''
  )
    return 'studio'
  return 'studio'
}

/**
 * Same precedence as crea-services `companySubscriptionPlanFromSources`:
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

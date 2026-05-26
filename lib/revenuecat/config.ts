import type { NormalizedFreelancerPlan } from '@/lib/billingDisplay'
import type { CompanySubscriptionPlanDb } from '@/lib/companyPlanFromSession'

/** RevenueCat entitlement identifiers (must match RevenueCat dashboard). */
export const RC_ENTITLEMENT_STARTER = 'crea_starter'
export const RC_ENTITLEMENT_PRO = 'Crea Services Pro'
export const RC_ENTITLEMENT_STUDIO = 'crea_studio'
export const RC_ENTITLEMENT_AGENCY = 'crea_agency'

/** Offering package identifiers in the `default` offering. */
export const RC_PACKAGE_STARTER = 'crea_starter'
export const RC_PACKAGE_PRO = 'crea_pro'
export const RC_PACKAGE_STUDIO = 'crea_studio'
export const RC_PACKAGE_AGENCY = 'crea_agency'

/** App Store product identifiers (legacy — map to pro until new products ship). */
export const RC_PRODUCT_STARTER = '56912026'
export const RC_PRODUCT_PRO = '165846'
export const RC_PRODUCT_STUDIO = '156715'
export const RC_PRODUCT_AGENCY = '1156474'

export const RC_DEFAULT_OFFERING_ID = 'default'

export const RC_PACKAGE_TO_PRODUCT: Record<string, string> = {
  [RC_PACKAGE_STARTER]: RC_PRODUCT_STARTER,
  [RC_PACKAGE_PRO]: RC_PRODUCT_PRO,
  [RC_PACKAGE_STUDIO]: RC_PRODUCT_STUDIO,
  [RC_PACKAGE_AGENCY]: RC_PRODUCT_AGENCY,
}

/** Normalized subscription tier for app logic (2-tier model). */
export type SubscriptionPlanKey = 'free' | 'pro'

/** Legacy entitlements → pro (paid access until App Store products are migrated). */
const ENTITLEMENT_TO_PLAN: Record<string, SubscriptionPlanKey> = {
  [RC_ENTITLEMENT_STARTER]: 'pro',
  [RC_ENTITLEMENT_PRO]: 'pro',
  [RC_ENTITLEMENT_STUDIO]: 'pro',
  [RC_ENTITLEMENT_AGENCY]: 'pro',
}

export function revenueCatApiKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || 'appl_BKbFnLWKlDXkxLytdHvPULFQeHI').trim()
}

export function planFromEntitlementId(entitlementId: string): SubscriptionPlanKey | null {
  return ENTITLEMENT_TO_PLAN[entitlementId] ?? null
}

export function planFromActiveEntitlements(entitlementIds: string[]): SubscriptionPlanKey {
  for (const id of entitlementIds) {
    if (planFromEntitlementId(id) === 'pro') return 'pro'
  }
  return 'free'
}

/** Both free and pro are valid for either role in the 2-tier model. */
export function isFreelancerPlan(_plan: SubscriptionPlanKey): boolean {
  return true
}

export function isCompanyPlan(_plan: SubscriptionPlanKey): boolean {
  return true
}

export function freelancerPlanFromSubscription(plan: SubscriptionPlanKey): NormalizedFreelancerPlan {
  return plan === 'pro' ? 'pro' : 'free'
}

export function companyPlanFromSubscription(plan: SubscriptionPlanKey): CompanySubscriptionPlanDb {
  return plan === 'pro' ? 'pro' : 'free'
}

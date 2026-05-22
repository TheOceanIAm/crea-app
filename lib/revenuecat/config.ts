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

/** App Store product identifiers (subscriptions in App Store Connect). */
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

export type SubscriptionPlanKey = 'free' | 'starter' | 'pro' | 'studio' | 'agency'

const ENTITLEMENT_TO_PLAN: Record<string, SubscriptionPlanKey> = {
  [RC_ENTITLEMENT_STARTER]: 'starter',
  [RC_ENTITLEMENT_PRO]: 'pro',
  [RC_ENTITLEMENT_STUDIO]: 'studio',
  [RC_ENTITLEMENT_AGENCY]: 'agency',
}

/** Highest active plan when multiple entitlements are active (agency > studio > pro > starter). */
const PLAN_RANK: Record<SubscriptionPlanKey, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  studio: 3,
  agency: 4,
}

export function revenueCatApiKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || 'appl_BKbFnLWKlDXkxLytdHvPULFQeHI').trim()
}

export function planFromEntitlementId(entitlementId: string): SubscriptionPlanKey | null {
  return ENTITLEMENT_TO_PLAN[entitlementId] ?? null
}

export function planFromActiveEntitlements(entitlementIds: string[]): SubscriptionPlanKey {
  let best: SubscriptionPlanKey = 'free'
  for (const id of entitlementIds) {
    const p = planFromEntitlementId(id)
    if (p && PLAN_RANK[p] > PLAN_RANK[best]) best = p
  }
  return best
}

export function isFreelancerPlan(plan: SubscriptionPlanKey): boolean {
  return plan === 'starter' || plan === 'pro'
}

export function isCompanyPlan(plan: SubscriptionPlanKey): boolean {
  return plan === 'studio' || plan === 'agency'
}

export function freelancerPlanFromSubscription(plan: SubscriptionPlanKey): 'workspace' | 'starter' | 'pro' | 'premium' {
  if (plan === 'pro') return 'pro'
  if (plan === 'starter') return 'starter'
  return 'workspace'
}

export function companyPlanFromSubscription(plan: SubscriptionPlanKey): 'studio' | 'agency' | 'business' | 'enterprise' {
  if (plan === 'agency') return 'agency'
  if (plan === 'studio') return 'studio'
  return 'studio'
}

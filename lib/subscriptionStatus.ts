import { Platform } from 'react-native'
import type { User } from '@supabase/supabase-js'
import Purchases from 'react-native-purchases'
import {
  companyPlanFromSubscription,
  freelancerPlanFromSubscription,
  isCompanyPlan,
  isFreelancerPlan,
  type SubscriptionPlanKey,
} from '@/lib/revenuecat/config'

export type { SubscriptionPlanKey } from '@/lib/revenuecat/config'
import {
  isSubscribedFromCustomerInfo,
  resolveSubscriptionPlanFromCustomerInfo,
} from '@/lib/revenuecat/customerInfo'
import type { NormalizedFreelancerPlan } from '@/lib/billingDisplay'
import { resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'
import { resolveCompanySubscriptionPlanFromSources } from '@/lib/companyPlanFromSession'
import { resolveAppRole, isCeoProfile } from '@/lib/profileRole'

export type SubscriptionStatusSource = 'revenuecat' | 'stripe' | 'trial' | 'free'

export type SubscriptionStatus = {
  currentPlan: SubscriptionPlanKey
  isSubscribed: boolean
  source: SubscriptionStatusSource
  /** App-tier string used in profile UI (free | pro). */
  appTier: string
}

function hasStripeSubscriptionInMetadata(user: User | null | undefined): boolean {
  const m = user?.user_metadata as Record<string, unknown> | undefined
  const id = m?.stripe_subscription_id
  return typeof id === 'string' && id.trim().length > 0
}

function stripePlanFromUser(
  user: User | null | undefined,
  profileTier: unknown,
  companyPlan: unknown,
  role: string
): SubscriptionPlanKey {
  if (role === 'company') {
    const cp = resolveCompanySubscriptionPlanFromSources(user, profileTier, companyPlan)
    return cp === 'pro' ? 'pro' : 'free'
  }
  const fp = resolveFreelancerPlanFromUser(user)
  return fp === 'pro' ? 'pro' : 'free'
}

/**
 * Platform-aware subscription status: RevenueCat on iOS, Stripe/metadata elsewhere.
 */
export async function getSubscriptionStatus(params: {
  user: User | null | undefined
  profile?: {
    role?: string | null
    subscription_tier?: string | null
  } | null
  companySubscriptionPlan?: string | null
}): Promise<SubscriptionStatus> {
  const { user, profile, companySubscriptionPlan } = params
  const role = String(resolveAppRole(profile?.role, user) ?? '').toLowerCase()

  if (!user || isCeoProfile(role)) {
    return { currentPlan: 'free', isSubscribed: false, source: 'free', appTier: 'free' }
  }

  if (Platform.OS === 'ios') {
    try {
      const customerInfo = await Purchases.getCustomerInfo()
      const rcPlan = resolveSubscriptionPlanFromCustomerInfo(customerInfo)
      if (isSubscribedFromCustomerInfo(customerInfo)) {
        const appTier =
          role === 'company'
            ? companyPlanFromSubscription(rcPlan)
            : freelancerPlanFromSubscription(rcPlan)
        return {
          currentPlan: rcPlan,
          isSubscribed: true,
          source: 'revenuecat',
          appTier,
        }
      }
    } catch {
      /* fall through to Stripe metadata */
    }
  }

  if (hasStripeSubscriptionInMetadata(user)) {
    const plan = stripePlanFromUser(user, profile?.subscription_tier, companySubscriptionPlan, role)
    const appTier =
      role === 'company'
        ? companyPlanFromSubscription(plan)
        : freelancerPlanFromSubscription(plan)
    return {
      currentPlan: plan,
      isSubscribed: plan === 'pro',
      source: 'stripe',
      appTier,
    }
  }

  const appTier =
    role === 'company'
      ? companyPlanFromSubscription('free')
      : freelancerPlanFromSubscription('free')

  return { currentPlan: 'free', isSubscribed: false, source: 'free', appTier }
}

export function subscriptionPlanMatchesRole(plan: SubscriptionPlanKey, role: string): boolean {
  const r = role.toLowerCase()
  if (r === 'freelancer') return plan === 'free' || isFreelancerPlan(plan)
  if (r === 'company') return plan === 'free' || isCompanyPlan(plan)
  return true
}

export function freelancerPlanForStatus(plan: SubscriptionPlanKey): NormalizedFreelancerPlan {
  return freelancerPlanFromSubscription(plan)
}

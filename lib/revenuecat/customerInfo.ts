import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases'
import { planFromActiveEntitlements, type SubscriptionPlanKey } from '@/lib/revenuecat/config'

function activeEntitlementIds(customerInfo: CustomerInfo | null | undefined): string[] {
  if (!customerInfo?.entitlements?.active) return []
  return Object.entries(customerInfo.entitlements.active)
    .filter(([, info]) => isEntitlementActive(info))
    .map(([id]) => id)
}

function isEntitlementActive(info: PurchasesEntitlementInfo | undefined): boolean {
  if (!info?.isActive) return false
  if (!info.expirationDate) return true
  const exp = new Date(info.expirationDate).getTime()
  return !Number.isNaN(exp) && exp > Date.now()
}

export function resolveSubscriptionPlanFromCustomerInfo(
  customerInfo: CustomerInfo | null | undefined
): SubscriptionPlanKey {
  return planFromActiveEntitlements(activeEntitlementIds(customerInfo))
}

export function isSubscribedFromCustomerInfo(customerInfo: CustomerInfo | null | undefined): boolean {
  return resolveSubscriptionPlanFromCustomerInfo(customerInfo) !== 'free'
}

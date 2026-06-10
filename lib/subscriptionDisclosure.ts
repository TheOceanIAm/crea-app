import type { PurchasesPackage } from 'react-native-purchases'
import { storeProductMatchesRole } from '@/lib/revenuecat/config'
import { formatPackageDisplayPrice, packageCadence } from '@/lib/revenuecat/storeProductPrice'

const DEFAULT_TITLES = {
  freelancer: 'Crea Freelancer Pro',
  company: 'Crea Company Pro',
} as const

export function subscriptionProductTitle(
  pkg: PurchasesPackage,
  role: 'freelancer' | 'company'
): string {
  const fromStore = pkg.product.title?.trim()
  if (fromStore && storeProductMatchesRole(pkg.product.identifier, role)) {
    return fromStore
  }
  return DEFAULT_TITLES[role]
}

export function subscriptionLengthLabel(cadence: 'monthly' | 'yearly'): string {
  return cadence === 'yearly' ? '1 year (auto-renewing)' : '1 month (auto-renewing)'
}

export function subscriptionPriceLabel(
  pkg: PurchasesPackage,
  role: 'freelancer' | 'company',
  cadence: 'monthly' | 'yearly'
): string {
  return formatPackageDisplayPrice(pkg, role, cadence).text
}

export type SubscriptionDisclosure = {
  title: string
  length: string
  price: string
}

export function buildSubscriptionDisclosure(
  pkg: PurchasesPackage,
  role: 'freelancer' | 'company'
): SubscriptionDisclosure | null {
  const cadence = packageCadence(pkg)
  if (cadence === 'other') return null
  return {
    title: subscriptionProductTitle(pkg, role),
    length: subscriptionLengthLabel(cadence),
    price: subscriptionPriceLabel(pkg, role, cadence),
  }
}

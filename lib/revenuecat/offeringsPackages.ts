import type { PurchasesPackage } from 'react-native-purchases'

import {
  RC_DEFAULT_OFFERING_ID,
  RC_PACKAGE_AGENCY,
  RC_PACKAGE_PRO,
  RC_PACKAGE_TO_PRODUCT,
} from '@/lib/revenuecat/config'

export function filterPackagesForRole(
  packages: PurchasesPackage[],
  role: 'freelancer' | 'company'
): PurchasesPackage[] {
  const packageKey = role === 'company' ? RC_PACKAGE_AGENCY : RC_PACKAGE_PRO
  const primaryProductId = RC_PACKAGE_TO_PRODUCT[packageKey]
  const matching = packages.filter((pkg) => {
    if (pkg.identifier === packageKey) return true
    if (primaryProductId && pkg.product.identifier === primaryProductId) return true
    return false
  })
  const filtered = matching.length ? matching : packages

  const rank = (pkg: PurchasesPackage) => {
    const type = (pkg.packageType || '').toLowerCase()
    if (type.includes('annual') || type.includes('year')) return 0
    if (type.includes('monthly') || type.includes('month')) return 1
    return 2
  }

  return [...filtered].sort((a, b) => rank(a) - rank(b))
}

export async function fetchRoleOfferingPackages(
  role: 'freelancer' | 'company'
): Promise<{ packages: PurchasesPackage[]; error: string | null }> {
  const Purchases = (await import('react-native-purchases')).default
  const offerings = await Purchases.getOfferings()
  const offering = offerings.all[RC_DEFAULT_OFFERING_ID] ?? offerings.current ?? null
  const available = offering?.availablePackages ?? []
  if (!available.length) {
    return { packages: [], error: 'No subscription plans are available from the App Store right now.' }
  }
  return { packages: filterPackagesForRole(available, role), error: null }
}

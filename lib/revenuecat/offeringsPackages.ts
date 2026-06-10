import type { PurchasesPackage } from 'react-native-purchases'

import {
  RC_DEFAULT_OFFERING_ID,
  RC_PACKAGE_AGENCY,
  RC_PACKAGE_PRO,
  RC_PACKAGE_TO_PRODUCT,
  storeProductMatchesRole,
} from '@/lib/revenuecat/config'

function packageCadenceRank(pkg: PurchasesPackage): number {
  const type = (pkg.packageType || '').toLowerCase()
  const productId = pkg.product.identifier.toLowerCase()
  if (type.includes('annual') || type.includes('year') || productId.includes('.yearly')) return 0
  if (type.includes('monthly') || type.includes('month') || productId.includes('.monthly')) return 1
  return 2
}

export function filterPackagesForRole(
  packages: PurchasesPackage[],
  role: 'freelancer' | 'company'
): PurchasesPackage[] {
  const byProduct = packages.filter((pkg) => storeProductMatchesRole(pkg.product.identifier, role))
  if (byProduct.length > 0) {
    return [...byProduct].sort((a, b) => packageCadenceRank(a) - packageCadenceRank(b))
  }

  const packageKey = role === 'company' ? RC_PACKAGE_AGENCY : RC_PACKAGE_PRO
  const primaryProductId = RC_PACKAGE_TO_PRODUCT[packageKey]
  const byPackageKey = packages.filter((pkg) => {
    const id = pkg.identifier.toLowerCase()
    if (pkg.identifier === packageKey) return true
    if (primaryProductId && pkg.product.identifier === primaryProductId) return true
    if (role === 'company' && (id.includes('agency') || id.includes('company'))) return true
    if (role === 'freelancer' && (id.includes('freelancer') || id === RC_PACKAGE_PRO)) return true
    return false
  })

  return [...byPackageKey].sort((a, b) => packageCadenceRank(a) - packageCadenceRank(b))
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
  const packages = filterPackagesForRole(available, role)
  if (!packages.length) {
    return {
      packages: [],
      error:
        role === 'company'
          ? 'Company Pro plans are not available from the App Store for this build. Try again later or contact support.'
          : 'Freelancer Pro plans are not available from the App Store for this build. Try again later or contact support.',
    }
  }
  return { packages, error: null }
}

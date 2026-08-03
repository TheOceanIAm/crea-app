import type { PurchasesPackage } from 'react-native-purchases'

import { RC_DEFAULT_OFFERING_ID, storeProductMatchesRole } from '@/lib/revenuecat/config'

function packageCadenceRank(pkg: PurchasesPackage): number {
  const type = (pkg.packageType || '').toLowerCase()
  const productId = pkg.product.identifier.toLowerCase()
  if (type.includes('annual') || type.includes('year') || productId.includes('.yearly')) return 0
  if (type.includes('monthly') || type.includes('month') || productId.includes('.monthly')) return 1
  return 2
}

/**
 * Only packages whose StoreKit product ID matches the account role.
 * Never match on RevenueCat package *names* alone — a mis-wired package
 * (e.g. `crea_pro` pointing at a Company SKU) would otherwise show Freelancer
 * catalog prices while Apple charges Company Pro Yearly.
 */
export function filterPackagesForRole(
  packages: PurchasesPackage[],
  role: 'freelancer' | 'company'
): PurchasesPackage[] {
  return packages
    .filter((pkg) => storeProductMatchesRole(pkg.product.identifier, role))
    .sort((a, b) => packageCadenceRank(a) - packageCadenceRank(b))
}

function roleMissingMessage(role: 'freelancer' | 'company'): string {
  return role === 'company'
    ? 'Company Pro plans are not available from the App Store for this build. Try again later or contact support.'
    : 'Freelancer Pro plans are not available from the App Store for this build. Try again later or contact support.'
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Newly approved App Store products often take minutes to appear in StoreKit.
 * RevenueCat can return the Offering with only the products Apple has propagated
 * so far (e.g. Company yes, Freelancer not yet). Retry briefly before failing.
 */
export async function fetchRoleOfferingPackages(
  role: 'freelancer' | 'company',
  opts?: { retries?: number; retryDelayMs?: number }
): Promise<{ packages: PurchasesPackage[]; error: string | null }> {
  const Purchases = (await import('react-native-purchases')).default
  const retries = opts?.retries ?? 4
  const retryDelayMs = opts?.retryDelayMs ?? 2500

  let lastAvailable: PurchasesPackage[] = []

  for (let attempt = 0; attempt <= retries; attempt++) {
    const offerings = await Purchases.getOfferings()
    const offering = offerings.all[RC_DEFAULT_OFFERING_ID] ?? offerings.current ?? null
    const available = offering?.availablePackages ?? []
    lastAvailable = available

    if (!available.length) {
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1))
        continue
      }
      return { packages: [], error: 'No subscription plans are available from the App Store right now.' }
    }

    const packages = filterPackagesForRole(available, role)
    if (packages.length > 0) {
      return { packages, error: null }
    }

    // Offering has *some* products (often the other role) but not ours yet — wait for StoreKit.
    if (attempt < retries) {
      await sleep(retryDelayMs * (attempt + 1))
    }
  }

  if (!lastAvailable.length) {
    return { packages: [], error: 'No subscription plans are available from the App Store right now.' }
  }
  return { packages: [], error: roleMissingMessage(role) }
}

import { NativeModules, Platform } from 'react-native'
import type { PurchasesPackage } from 'react-native-purchases'
import {
  COMPANY_PLAN_PRICE_EUR,
  FREELANCER_PLAN_PRICE_EUR,
  formatCatalogPrice,
} from '@/lib/planCatalogPrices'

export type StorePriceProduct = {
  price: number
  currencyCode: string
  priceString: string
}

/** BCP 47 locale for number/currency formatting (device language/region). */
export function getDeviceLocaleTag(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings as
        | { AppleLocale?: string; AppleLanguages?: string[] }
        | undefined
      const appleLocale = settings?.AppleLocale ?? settings?.AppleLanguages?.[0]
      if (typeof appleLocale === 'string' && appleLocale.trim()) {
        return appleLocale.trim().replace(/_/g, '-')
      }
    }
    if (Platform.OS === 'android') {
      const locale = NativeModules.I18nManager?.localeIdentifier as string | undefined
      if (typeof locale === 'string' && locale.trim()) {
        return locale.trim().replace(/_/g, '-')
      }
    }
  } catch {
    // ignore
  }
  return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'
}

const REGION_CURRENCY: Record<string, string> = {
  DE: 'EUR',
  AT: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
  US: 'USD',
  GB: 'GBP',
  CH: 'CHF',
  AU: 'AUD',
  CA: 'CAD',
  NZ: 'NZD',
  JP: 'JPY',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
}

export function expectedCurrencyForDeviceLocale(localeTag?: string): string | null {
  const tag = (localeTag ?? getDeviceLocaleTag()).trim()
  const region = tag.split('-')[1]?.toUpperCase()
  if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region]
  if (tag.toLowerCase().startsWith('de')) return 'EUR'
  return null
}

/**
 * Localized price from StoreKit — prefer Apple's `priceString` (matches checkout / App Store region).
 * Re-formatting with `price` + `currencyCode` alone can show US tier ($7.99) while DE checkout is €8.99.
 */
export function formatStoreProductPrice(
  product: StorePriceProduct,
  opts?: { perMonth?: boolean; perYear?: boolean }
): string {
  const suffix = opts?.perMonth ? '/mo' : opts?.perYear ? '/yr' : ''
  const fromStore = product.priceString?.trim()
  if (fromStore) {
    return suffix ? `${fromStore}${suffix}` : fromStore
  }

  const currency = (product.currencyCode || 'EUR').toUpperCase()
  const locale = getDeviceLocaleTag()
  let formatted: string
  try {
    formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    }).format(product.price)
  } catch {
    formatted = `${currency} ${product.price.toFixed(2)}`
  }
  if (opts?.perMonth) return `${formatted}/mo`
  if (opts?.perYear) return `${formatted}/yr`
  return formatted
}

export function formatPackagePrice(pkg: PurchasesPackage, cadence: 'monthly' | 'yearly'): string {
  return formatPackageDisplayPrice(pkg, 'freelancer', cadence).text
}

/** TestFlight/Sandbox often returns USD from StoreKit while the payment sheet uses the real storefront (e.g. EUR in DE). */
export function shouldUseCatalogPriceFallback(product: StorePriceProduct): boolean {
  const expected = expectedCurrencyForDeviceLocale()
  const actual = (product.currencyCode || '').toUpperCase()
  if (!expected || !actual || actual === expected) return false
  return expected === 'EUR' && actual === 'USD'
}

function catalogAmountForPackage(
  pkg: PurchasesPackage,
  role: 'freelancer' | 'company'
): number | null {
  const cadence = packageCadence(pkg)
  if (role === 'company') {
    return cadence === 'yearly' ? COMPANY_PLAN_PRICE_EUR.proYearly : COMPANY_PLAN_PRICE_EUR.proMonthly
  }
  return cadence === 'yearly' ? FREELANCER_PLAN_PRICE_EUR.proYearly : FREELANCER_PLAN_PRICE_EUR.proMonthly
}

export function formatPackageDisplayPrice(
  pkg: PurchasesPackage,
  role: 'freelancer' | 'company',
  cadence: 'monthly' | 'yearly'
): { text: string; usesCatalogFallback: boolean } {
  if (shouldUseCatalogPriceFallback(pkg.product)) {
    const amount = catalogAmountForPackage(pkg, role)
    if (amount != null) {
      const suffix = cadence === 'yearly' ? '/yr' : '/mo'
      return { text: `${formatCatalogPrice(amount)}${suffix}`, usesCatalogFallback: true }
    }
  }
  return {
    text: formatStoreProductPrice(pkg.product, cadence === 'yearly' ? { perYear: true } : { perMonth: true }),
    usesCatalogFallback: false,
  }
}

export function packageCadence(pkg: PurchasesPackage): 'monthly' | 'yearly' | 'other' {
  const type = (pkg.packageType || '').toLowerCase()
  if (type.includes('annual') || type.includes('year')) return 'yearly'
  if (type.includes('monthly') || type.includes('month')) return 'monthly'
  return 'other'
}

/** Human-readable price line for settings (monthly · yearly). */
export function formatMonthlyYearlyPriceLine(
  packages: PurchasesPackage[],
  role: 'freelancer' | 'company' = 'freelancer'
): string | null {
  const monthly = packages.find((p) => packageCadence(p) === 'monthly')
  const yearly = packages.find((p) => packageCadence(p) === 'yearly')
  const parts: string[] = []
  if (monthly) parts.push(formatPackageDisplayPrice(monthly, role, 'monthly').text)
  if (yearly) parts.push(formatPackageDisplayPrice(yearly, role, 'yearly').text)
  return parts.length ? parts.join(' · ') : null
}

/** Hint when StoreKit currency does not match device region (common in TestFlight/Sandbox). */
export function storeCurrencyRegionHint(
  productCurrency: string,
  opts?: { usesCatalogFallback?: boolean }
): string | null {
  if (opts?.usesCatalogFallback) {
    return 'TestFlight often shows USD in the app; the Apple payment sheet shows your real price (e.g. €8.99 in Germany).'
  }
  const expected = expectedCurrencyForDeviceLocale()
  const actual = (productCurrency || '').toUpperCase()
  if (!expected || !actual || actual === expected) return null
  return `Prices are shown in ${actual} for your App Store account region — checkout uses that currency.`
}

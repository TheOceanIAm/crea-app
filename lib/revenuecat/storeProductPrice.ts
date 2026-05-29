import Constants from 'expo-constants'
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

/** iOS Region (not language) — e.g. Germany with English UI → `en-DE` → `DE`. */
export function getDeviceRegionCode(): string | null {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings as
        | { AppleLocale?: string; AppleLanguages?: string[] }
        | undefined
      const appleLocale = settings?.AppleLocale
      if (typeof appleLocale === 'string' && appleLocale.trim()) {
        const base = appleLocale.trim().split('@')[0]!.replace(/_/g, '-')
        const parts = base.split('-').filter(Boolean)
        if (parts.length >= 2) return parts[parts.length - 1]!.toUpperCase()
      }
      const lang0 = settings?.AppleLanguages?.[0]
      if (typeof lang0 === 'string' && lang0.trim()) {
        const parts = lang0.trim().replace(/_/g, '-').split('-').filter(Boolean)
        if (parts.length >= 2) return parts[1]!.toUpperCase()
      }
    }
  } catch {
    // ignore
  }
  const fromTag = getDeviceLocaleTag().split('-')[1]?.toUpperCase()
  return fromTag || null
}

/** Prefer German StoreKit formatting when the device region is Germany. */
export function getRevenueCatPreferredLocale(): string {
  if (getDeviceRegionCode() === 'DE') return 'de-DE'
  return getDeviceLocaleTag()
}

function isTestFlightBuild(): boolean {
  return Constants.executionEnvironment === 'storeClient'
}

const EU_REGIONS = new Set([
  'DE',
  'AT',
  'CH',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'IE',
  'PT',
  'FI',
  'GR',
  'LU',
])

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
  const region = getDeviceRegionCode()
  if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region]
  const tag = (localeTag ?? getDeviceLocaleTag()).trim()
  const fromTag = tag.split('-')[1]?.toUpperCase()
  if (fromTag && REGION_CURRENCY[fromTag]) return REGION_CURRENCY[fromTag]
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

/**
 * TestFlight/Sandbox often returns USD from StoreKit while the payment sheet uses the real storefront (EUR in DE).
 * Sandbox tester country ≠ iPhone region — TestFlight builds use catalog EUR when StoreKit still reports USD.
 */
export function shouldUseCatalogPriceFallback(product: StorePriceProduct): boolean {
  const actual = (product.currencyCode || '').toUpperCase()
  if (actual !== 'USD') return false

  if (expectedCurrencyForDeviceLocale() === 'EUR') return true

  const region = getDeviceRegionCode()
  if (region && EU_REGIONS.has(region)) return true

  if (isTestFlightBuild()) return true

  return false
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
): { line: string | null; usesCatalogFallback: boolean } {
  const monthly = packages.find((p) => packageCadence(p) === 'monthly')
  const yearly = packages.find((p) => packageCadence(p) === 'yearly')
  const parts: string[] = []
  let usesCatalogFallback = false
  if (monthly) {
    const m = formatPackageDisplayPrice(monthly, role, 'monthly')
    parts.push(m.text)
    usesCatalogFallback = usesCatalogFallback || m.usesCatalogFallback
  }
  if (yearly) {
    const y = formatPackageDisplayPrice(yearly, role, 'yearly')
    parts.push(y.text)
    usesCatalogFallback = usesCatalogFallback || y.usesCatalogFallback
  }
  return {
    line: parts.length ? parts.join(' · ') : null,
    usesCatalogFallback,
  }
}

/** Hint when StoreKit currency does not match device region (common in TestFlight/Sandbox). */
export function storeCurrencyRegionHint(
  productCurrency: string,
  opts?: { usesCatalogFallback?: boolean }
): string | null {
  if (opts?.usesCatalogFallback) {
    if (getDeviceRegionCode() === 'DE') {
      return 'In TestFlight zeigt die App manchmal USD; beim Bezahlen gilt der Preis aus dem Apple-Dialog (z. B. 8,99 € in Deutschland).'
    }
    return 'TestFlight often shows USD in the app; the Apple payment sheet shows your real price (e.g. €8.99 in Germany).'
  }
  const expected = expectedCurrencyForDeviceLocale()
  const actual = (productCurrency || '').toUpperCase()
  if (!expected || !actual || actual === expected) return null
  return `Prices are shown in ${actual} for your App Store account region — checkout uses that currency.`
}

import { NativeModules, Platform } from 'react-native'
import type { PurchasesPackage } from 'react-native-purchases'

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
 * Localized price from StoreKit fields — uses Apple’s currency + device locale formatting.
 * Falls back to priceString when Intl fails.
 */
export function formatStoreProductPrice(
  product: StorePriceProduct,
  opts?: { perMonth?: boolean; perYear?: boolean }
): string {
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
    formatted = product.priceString?.trim() || `${currency} ${product.price.toFixed(2)}`
  }
  if (opts?.perMonth) return `${formatted}/mo`
  if (opts?.perYear) return `${formatted}/yr`
  return formatted
}

export function formatPackagePrice(pkg: PurchasesPackage, cadence: 'monthly' | 'yearly'): string {
  return formatStoreProductPrice(pkg.product, cadence === 'yearly' ? { perYear: true } : { perMonth: true })
}

function packageCadence(pkg: PurchasesPackage): 'monthly' | 'yearly' | 'other' {
  const type = (pkg.packageType || '').toLowerCase()
  if (type.includes('annual') || type.includes('year')) return 'yearly'
  if (type.includes('monthly') || type.includes('month')) return 'monthly'
  return 'other'
}

/** Human-readable price line for settings (monthly · yearly). */
export function formatMonthlyYearlyPriceLine(
  packages: PurchasesPackage[]
): string | null {
  const monthly = packages.find((p) => packageCadence(p) === 'monthly')
  const yearly = packages.find((p) => packageCadence(p) === 'yearly')
  const parts: string[] = []
  if (monthly) parts.push(formatPackagePrice(monthly, 'monthly'))
  if (yearly) parts.push(formatPackagePrice(yearly, 'yearly'))
  return parts.length ? parts.join(' · ') : null
}

/** Hint when device locale suggests EUR but App Store storefront returns USD (common in US sandbox testers). */
export function storeCurrencyRegionHint(productCurrency: string): string | null {
  const expected = expectedCurrencyForDeviceLocale()
  const actual = (productCurrency || '').toUpperCase()
  if (!expected || !actual || actual === expected) return null
  return `Prices are shown in ${actual} for your App Store account region — checkout uses that currency.`
}

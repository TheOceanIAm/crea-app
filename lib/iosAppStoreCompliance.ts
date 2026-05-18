import { Linking, Platform } from 'react-native'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'

/**
 * Apple Guideline 3.1.1: do not present subscription purchase, plan comparison,
 * or in-app Stripe checkout for paid tiers on iOS — send users to the website.
 */
export const IOS_SUBSCRIPTION_PURCHASE_ON_WEB_ONLY = Platform.OS === 'ios'

/**
 * When true, Login/Register show “sign up on creaservices.de” instead of the in-app form.
 * Keep false to allow account creation in the app while subscription stays web-only (above).
 */
export const IOS_SIGNUP_ON_WEB_ONLY = false

/** Web origin for marketing links (matches EXPO_PUBLIC_CREA_WEB_URL + creaWeb normalization, or www fallback). */
export function getCreaMarketingSiteUrl(): string {
  const base = getCreaWebBaseUrl().trim()
  return base || 'https://www.creaservices.de'
}

/**
 * Account creation on the web (public). After email confirmation, users are sent to `/onboarding`.
 * `/onboarding` itself requires a session — do not deep-link guests there or middleware redirects to `/login`.
 */
export function getCreaWebRegisterUrl(): string {
  return `${getCreaMarketingSiteUrl().replace(/\/$/, '')}/register`
}

export async function openCreaWebsiteInBrowser(): Promise<boolean> {
  try {
    await Linking.openURL(getCreaMarketingSiteUrl())
    return true
  } catch {
    return false
  }
}

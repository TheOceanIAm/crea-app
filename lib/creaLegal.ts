import { Linking } from 'react-native'

/** Override via EXPO_PUBLIC_CREA_TERMS_URL / EXPO_PUBLIC_CREA_PRIVACY_URL in .env */
export function getTermsOfServiceUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_CREA_TERMS_URL || 'https://www.creaservices.de/terms').trim()
  return raw.replace(/\/$/, '').replace(/^https:\/\/creaservices\.de/, 'https://www.creaservices.de')
}

export function getPrivacyPolicyUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_CREA_PRIVACY_URL || 'https://www.creaservices.de/privacy').trim()
  return raw.replace(/\/$/, '').replace(/^https:\/\/creaservices\.de/, 'https://www.creaservices.de')
}

export function openTerms(): void {
  Linking.openURL(getTermsOfServiceUrl()).catch(() => {})
}

export function openPrivacy(): void {
  Linking.openURL(getPrivacyPolicyUrl()).catch(() => {})
}

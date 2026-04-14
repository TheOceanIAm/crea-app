import { Linking } from 'react-native'

/** Override via EXPO_PUBLIC_CREA_TERMS_URL / EXPO_PUBLIC_CREA_PRIVACY_URL in .env */
export function getTermsOfServiceUrl(): string {
  return (process.env.EXPO_PUBLIC_CREA_TERMS_URL || 'https://creaservices.de/terms').replace(/\/$/, '')
}

export function getPrivacyPolicyUrl(): string {
  return (process.env.EXPO_PUBLIC_CREA_PRIVACY_URL || 'https://creaservices.de/privacy').replace(/\/$/, '')
}

export function openTerms(): void {
  Linking.openURL(getTermsOfServiceUrl()).catch(() => {})
}

export function openPrivacy(): void {
  Linking.openURL(getPrivacyPolicyUrl()).catch(() => {})
}

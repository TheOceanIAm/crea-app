import Constants from 'expo-constants'
import { Platform } from 'react-native'

export function isExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo'
}

export function purchasesUnavailableUserMessage(cause?: unknown): string {
  if (Platform.OS !== 'ios') {
    return 'In-app subscriptions are only available on iOS.'
  }
  if (isExpoGo()) {
    return (
      'Expo Go cannot run App Store subscriptions. Close Expo Go, then open the CREA app ' +
      'from the simulator home screen (yellow CREA icon — installed via npx expo run:ios).'
    )
  }
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  if (raw.includes('RNPurchases') || raw.includes('Native module')) {
    return 'StoreKit is not available in this build. Rebuild with: npx expo run:ios'
  }
  return 'Subscriptions are not available in this build. Run: npx expo run:ios'
}

export const OFFERINGS_EMPTY_MESSAGE =
  'App Store products are not available yet (status: Ready for Submission / Developer Action Needed). ' +
  'For simulator testing: open ios/CREA.xcworkspace in Xcode → Product → Scheme → Edit Scheme → Run → Options → ' +
  'StoreKit Configuration → storekit/CreaSubscriptions.storekit, then run npx expo run:ios again. ' +
  'For production: submit the app version with all subscriptions linked in App Store Connect.'

export function offeringsLoadErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? '')
  if (
    raw.includes('could not be fetched from App Store Connect') ||
    raw.includes('why-are-offerings-empty') ||
    raw.includes('DEVELOPER_ACTION_NEEDED') ||
    raw.includes('configuration')
  ) {
    return OFFERINGS_EMPTY_MESSAGE
  }
  return raw.trim() || 'Could not load subscription plans.'
}

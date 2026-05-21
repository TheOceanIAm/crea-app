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
  'No subscription plans loaded from the App Store. Complete subscription metadata in App Store Connect ' +
  '(products must not show Missing Metadata), or add a StoreKit Configuration file in Xcode for simulator testing.'

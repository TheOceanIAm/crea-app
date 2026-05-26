import Constants from 'expo-constants'
import * as Device from 'expo-device'
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

export function isIosSimulator(): boolean {
  return Platform.OS === 'ios' && !Device.isDevice
}

export function offeringsEmptyMessage(): string {
  if (isIosSimulator()) {
    return (
      'Simulator: StoreKit only works when Xcode launches the app (⌘R). ' +
      '1) npm run dev  2) npm run ios:xcode  3) Press Run in Xcode. ' +
      'Upload the StoreKit public certificate in RevenueCat if purchases fail.'
    )
  }
  return (
    'App Store subscriptions are not available yet. Fix rejected localizations in App Store Connect ' +
    'and submit a new app version with all subscriptions linked.'
  )
}

/** @deprecated Use offeringsEmptyMessage() for context-aware copy. */
export const OFFERINGS_EMPTY_MESSAGE = offeringsEmptyMessage()

export function offeringsLoadErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? '')
  if (
    raw.includes('could not be fetched from App Store Connect') ||
    raw.includes('why-are-offerings-empty') ||
    raw.includes('DEVELOPER_ACTION_NEEDED') ||
    raw.includes('configuration')
  ) {
    return offeringsEmptyMessage()
  }
  return raw.trim() || 'Could not load subscription plans.'
}

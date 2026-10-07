import Constants from 'expo-constants'
import { Platform } from 'react-native'

/**
 * The App Store binary through 1.0.11 aborts when the native WebView is mounted.
 * Expo then discards the update and reopens the embedded bundle.
 * 1.0.12 and later ship with that view.
 */
export function nativeBinaryHasWebView(): boolean {
  if (Platform.OS !== 'ios') return true
  const [major = 0, minor = 0, patch = 0] = (Constants.nativeAppVersion ?? '').split('.').map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) ? value : 0
  })
  if (major > 1) return true
  if (major < 1) return false
  if (minor > 0) return true
  return patch >= 12
}

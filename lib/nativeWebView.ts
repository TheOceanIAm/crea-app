import Constants from 'expo-constants'
import { Platform } from 'react-native'

/**
 * The App Store binary through 1.0.11 aborts when the native WebView is mounted.
 * Expo then discards the update and reopens the embedded bundle.
 * 1.0.12 and later ship with that view.
 */
function versionAtLeast(version: string, major: number, minor: number, patch: number): boolean {
  const [a = 0, b = 0, c = 0] = version.split('.').map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) ? value : 0
  })
  if (a !== major) return a > major
  if (b !== minor) return b > minor
  return c >= patch
}

export function nativeBinaryHasWebView(): boolean {
  if (Platform.OS !== 'ios') return true
  // Build 100 is 1.0.12. Earlier App Store builds abort if this view is mounted.
  const build = Number.parseInt(Constants.nativeBuildVersion ?? '', 10)
  if (Number.isFinite(build) && build >= 100) return true
  return versionAtLeast(Constants.nativeAppVersion ?? '', 1, 0, 12)
}

import { Platform } from 'react-native'

/**
 * The App Store binary through 1.0.11 aborts when the native WebView is mounted.
 * Expo then discards the update and reopens the embedded bundle.
 * Build 100 is runtime 1.0.12 and ships with that view.
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

function installedRuntimeVersion(): string {
  try {
    const Updates = require('expo-updates') as { runtimeVersion?: string | null }
    return String(Updates.runtimeVersion ?? '')
  } catch {
    return ''
  }
}

export function nativeBinaryHasWebView(): boolean {
  if (Platform.OS !== 'ios') return true
  return versionAtLeast(installedRuntimeVersion(), 1, 0, 12)
}

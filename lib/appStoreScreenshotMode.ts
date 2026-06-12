/**
 * Local-only App Store screenshot fixtures (`/app-store-screenshots/*`).
 * Enable with __DEV__ or EXPO_PUBLIC_APP_STORE_SCREENSHOTS=1 when running Metro.
 */
export function isAppStoreScreenshotModeEnabled(): boolean {
  if (__DEV__) return true
  const v = (process.env.EXPO_PUBLIC_APP_STORE_SCREENSHOTS ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

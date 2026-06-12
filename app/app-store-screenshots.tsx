import { Redirect, useLocalSearchParams } from 'expo-router'
import { AppStoreScreenshotContent } from '@/components/app-store-screenshots/AppStoreScreenshotContent'
import { AppStoreScreenshotShell } from '@/components/app-store-screenshots/AppStoreScreenshotShell'
import {
  appStoreScreenshotEntry,
  isAppStoreScreenshotId,
  type AppStoreScreenshotId,
} from '@/lib/appStoreScreenshotCatalog'
import { isAppStoreScreenshotModeEnabled } from '@/lib/appStoreScreenshotMode'

function resolveScreenId(raw: string | string[] | undefined): AppStoreScreenshotId {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string' && isAppStoreScreenshotId(value)) return value
  return 'profile'
}

/** Local App Store screenshot fixtures — `?screen=jobs` etc. No auth, dev-only. */
export default function AppStoreScreenshotsScreen() {
  const { screen } = useLocalSearchParams<{ screen?: string | string[] }>()

  if (!isAppStoreScreenshotModeEnabled()) {
    return <Redirect href="/login" />
  }

  const id = resolveScreenId(screen)
  const entry = appStoreScreenshotEntry(id)

  return (
    <AppStoreScreenshotShell activeTab={entry.activeTab}>
      <AppStoreScreenshotContent screen={entry.id} />
    </AppStoreScreenshotShell>
  )
}

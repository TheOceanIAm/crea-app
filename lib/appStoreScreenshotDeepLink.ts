import type { Href } from 'expo-router'
import { isAppStoreScreenshotId } from '@/lib/appStoreScreenshotCatalog'

function screenFromUrl(url: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(url)
    } catch {
      return url
    }
  })()

  try {
    const normalized = decoded.replace(/^exp\+crea-app:\/\//i, 'http://x/').replace(/^crea:\/\//i, 'http://x/')
    const parsed = new URL(normalized.includes('://') ? normalized : `http://x/${normalized}`)
    const q = parsed.searchParams.get('screen')
    if (q && isAppStoreScreenshotId(q)) return q
  } catch {
    /* fall through */
  }

  const legacy = decoded.match(/app-store-screenshots\/([a-z-]+)/i)
  if (legacy?.[1] && isAppStoreScreenshotId(legacy[1])) return legacy[1]

  return null
}

export function parseAppStoreScreenshotHref(url: string | null | undefined): Href | null {
  const screen = url ? screenFromUrl(url) : null
  if (!screen) return null
  return `/app-store-screenshots?screen=${screen}` as Href
}

export function isAppStoreScreenshotDeepLink(url: string | null | undefined): boolean {
  return parseAppStoreScreenshotHref(url) != null
}

/** Deep-link URLs for Simulator (`npm run dev:ios` uses exp+crea-app). */
export function appStoreScreenshotDeepLinkUrls(screen: string): string[] {
  const query = `screen=${encodeURIComponent(screen)}`
  return [
    `exp+crea-app://--/app-store-screenshots?${query}`,
    `exp+crea-app:///app-store-screenshots?${query}`,
    `crea:///app-store-screenshots?${query}`,
    `crea://app-store-screenshots?${query}`,
  ]
}

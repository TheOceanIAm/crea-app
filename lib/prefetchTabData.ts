import type { MainTabName } from '@/lib/appEntryRoute'
import { getCache, setCache } from '@/lib/appCache'
import {
  cacheDashboardOverview,
  dashboardOverviewCacheKey,
  hydrateDashboardOverviewFromDisk,
  loadDashboardOverview,
  persistDashboardOverviewToDisk,
  readCachedDashboardOverview,
} from '@/lib/dashboardOverview'
import {
  hydratePinboardFeedFromDisk,
  loadPinboardFeedPage,
  persistPinboardFeedToDisk,
  pinboardCacheKey,
  readCachedPinboardFeed,
  type PinboardFeedCache,
} from '@/lib/pinboardFeed'
import { setWarmedOverview, setWarmedPinboard } from '@/lib/warmAppCaches'

let inflight: Partial<Record<MainTabName, Promise<void>>> = {}

async function warmOverviewForFeed(userId: string): Promise<void> {
  const cached = readCachedDashboardOverview(userId)
  if (cached) {
    setWarmedOverview(cached)
    return
  }

  const disk = await hydrateDashboardOverviewFromDisk(userId)
  if (disk) {
    setWarmedOverview(disk)
  }

  const overview = await loadDashboardOverview(userId)
  if (overview) {
    cacheDashboardOverview(overview)
    setWarmedOverview(overview)
    void persistDashboardOverviewToDisk(overview)
  }
}

async function prefetchFeed(userId: string): Promise<void> {
  const key = pinboardCacheKey(userId)
  const memPosts = readCachedPinboardFeed(userId)
  if (memPosts) {
    setWarmedPinboard(userId, memPosts)
    await warmOverviewForFeed(userId)
    return
  }

  const existing = getCache<PinboardFeedCache>(key)
  if (existing) {
    setWarmedPinboard(userId, existing.posts)
    await warmOverviewForFeed(userId)
    return
  }

  const [diskPosts] = await Promise.all([
    hydratePinboardFeedFromDisk(userId),
    warmOverviewForFeed(userId),
  ])

  if (diskPosts !== null) {
    setWarmedPinboard(userId, diskPosts)
  }

  const { posts, error } = await loadPinboardFeedPage({ limit: 25 })
  if (!error) {
    setCache(key, { posts }, 25_000)
    setWarmedPinboard(userId, posts)
    void persistPinboardFeedToDisk(userId, posts)
  }
}

async function prefetchDashboard(userId: string): Promise<void> {
  const cached = readCachedDashboardOverview(userId)
  if (cached) {
    setWarmedOverview(cached)
    return
  }

  const disk = await hydrateDashboardOverviewFromDisk(userId)
  if (disk) {
    setWarmedOverview(disk)
  }

  if (getCache(dashboardOverviewCacheKey(userId))) return

  const overview = await loadDashboardOverview(userId)
  if (overview) {
    cacheDashboardOverview(overview)
    setWarmedOverview(overview)
    void persistDashboardOverviewToDisk(overview)
  }
}

/** Hydrate disk caches immediately after session is known (before network). */
export async function hydrateMainTabFromDisk(userId: string, tab: MainTabName): Promise<void> {
  if (tab === 'feed') {
    const [diskPosts, diskOverview] = await Promise.all([
      hydratePinboardFeedFromDisk(userId),
      hydrateDashboardOverviewFromDisk(userId),
    ])
    if (diskPosts !== null) setWarmedPinboard(userId, diskPosts)
    if (diskOverview) setWarmedOverview(diskOverview)
    return
  }

  if (tab === 'dashboard') {
    const disk = await hydrateDashboardOverviewFromDisk(userId)
    if (disk) setWarmedOverview(disk)
  }
}

/** Awaitable prefetch for bootstrap gate (cold start). */
export async function prefetchMainTabDataAwait(userId: string, tab: MainTabName): Promise<void> {
  if (tab === 'feed') {
    const existing = inflight.feed
    if (existing) return existing
    inflight.feed = prefetchFeed(userId).finally(() => {
      delete inflight.feed
    })
    return inflight.feed
  }

  if (tab === 'dashboard') {
    const existing = inflight.dashboard
    if (existing) return existing
    inflight.dashboard = prefetchDashboard(userId).finally(() => {
      delete inflight.dashboard
    })
    return inflight.dashboard
  }
}

/** Fire-and-forget prefetch when user switches tabs later. */
export function prefetchMainTabData(userId: string, tab: MainTabName): void {
  void prefetchMainTabDataAwait(userId, tab)
}

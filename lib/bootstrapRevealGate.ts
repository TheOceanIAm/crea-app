import type { MainTabName } from '@/lib/appEntryRoute'
import { readFastBootstrapEnabled } from '@/lib/bootstrapHints'
import { getCache } from '@/lib/appCache'
import { dashboardOverviewCacheKey } from '@/lib/dashboardOverview'
import { pinboardCacheKey } from '@/lib/pinboardFeed'
import { prefetchMainTabDataAwait } from '@/lib/prefetchTabData'

/** Branded splash minimum while the entry tab prefetches (ms). */
export const BOOTSTRAP_MIN_REVEAL_MS = 2_200

/** Returning visit with warm in-memory cache — brief polish only. */
export const BOOTSTRAP_MIN_REVEAL_QUICK_MS = 900

/** Quick revisit: cap how long we wait on network prefetch. */
export const BOOTSTRAP_PREFETCH_CAP_MS = 2_800

/** Cold start: never hold splash longer than this (ms from bootstrap start). */
export const BOOTSTRAP_ABSOLUTE_MAX_MS = 6_000

function entryTabHasWarmCache(userId: string, tab: MainTabName): boolean {
  if (tab === 'feed') return Boolean(getCache(pinboardCacheKey(userId)))
  if (tab === 'dashboard') return Boolean(getCache(dashboardOverviewCacheKey(userId)))
  return true
}

export async function resolveBootstrapMinRevealMs(
  userId: string,
  entryTab: MainTabName
): Promise<number> {
  const fast = await readFastBootstrapEnabled()
  const warm = entryTabHasWarmCache(userId, entryTab)
  if (fast && warm) return BOOTSTRAP_MIN_REVEAL_QUICK_MS
  return BOOTSTRAP_MIN_REVEAL_MS
}

/** Hold splash for min duration while first screen data loads (whichever finishes last, capped). */
export async function awaitBootstrapReveal(opts: {
  startedAt: number
  userId: string
  entryTab: MainTabName
}): Promise<void> {
  const minMs = await resolveBootstrapMinRevealMs(opts.userId, opts.entryTab)
  const elapsed = Date.now() - opts.startedAt
  const minWait = Math.max(0, minMs - elapsed)
  const absoluteRemaining = Math.max(0, BOOTSTRAP_ABSOLUTE_MAX_MS - elapsed)
  const isQuick = minMs <= BOOTSTRAP_MIN_REVEAL_QUICK_MS

  const prefetchPromise = prefetchMainTabDataAwait(opts.userId, opts.entryTab)
  const boundedPrefetch = isQuick
    ? Promise.race([
        prefetchPromise,
        new Promise<void>((resolve) => setTimeout(resolve, BOOTSTRAP_PREFETCH_CAP_MS)),
      ])
    : Promise.race([
        prefetchPromise,
        new Promise<void>((resolve) => setTimeout(resolve, absoluteRemaining)),
      ])

  await Promise.all([
    new Promise<void>((resolve) => setTimeout(resolve, minWait)),
    boundedPrefetch,
  ])
}

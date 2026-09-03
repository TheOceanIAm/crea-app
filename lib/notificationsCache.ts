import { getCache, setCache } from '@/lib/appCache'
import {
  fetchAlertReadKeys,
  loadNotificationFeed,
  type NotificationRow,
} from '@/lib/notificationsFeed'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { queryClient } from '@/lib/queryClient'
import { notificationsKey } from '@/lib/queryKeys'
import { LIST_DISK_TTL_MS, LIST_MEM_TTL_MS } from '@/lib/cachePolicy'

export type NotificationsCache = {
  rows: NotificationRow[]
  reads: string[]
}

const DISK_TTL_MS = 24 * 60 * 60 * 1000
const MEM_TTL_MS = 20_000

export function notificationsCacheKey(userId: string): string {
  return `notifications:${userId}`
}

function notificationsDiskKey(userId: string): string {
  return `crea:notifications:${userId}`
}

export function readCachedNotifications(userId: string): NotificationsCache | null {
  return getCache<NotificationsCache>(notificationsCacheKey(userId))
}

export function cacheNotifications(userId: string, data: NotificationsCache): void {
  setCache(notificationsCacheKey(userId), data, MEM_TTL_MS)
}

/** Drop in-memory + disk alert cache (e.g. after crew remove or project delete). */
export async function clearNotificationsCache(userId: string): Promise<void> {
  setCache(notificationsCacheKey(userId), { rows: [], reads: [] }, 0)
  await writePersistedCache(notificationsDiskKey(userId), { rows: [], reads: [] }, 0)
}

export async function hydrateNotificationsFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<NotificationsCache>(notificationsDiskKey(userId))
  if (!hit) return false
  cacheNotifications(userId, hit)
  if (!queryClient.getQueryData(notificationsKey(userId))) {
    queryClient.setQueryData(notificationsKey(userId), hit)
  }
  return true
}

export async function persistNotificationsToDisk(userId: string, data: NotificationsCache): Promise<void> {
  await writePersistedCache(notificationsDiskKey(userId), data, DISK_TTL_MS)
}

let inflight: Promise<void> | null = null
let needsPrefetchAfter = false

/** Full feed refresh + cache write; returns unread count (for Alerts badge). */
export async function refreshNotificationsAndCount(userId: string): Promise<number> {
  const [feed, reads] = await Promise.all([
    loadNotificationFeed(userId),
    fetchAlertReadKeys(userId),
  ])
  const data: NotificationsCache = { rows: feed, reads: Array.from(reads) }
  cacheNotifications(userId, data)
  queryClient.setQueryData(notificationsKey(userId), data)
  void persistNotificationsToDisk(userId, data)
  return feed.filter((r) => !reads.has(r.id)).length
}

export async function prefetchNotifications(userId: string): Promise<void> {
  if (inflight) {
    needsPrefetchAfter = true
    return inflight
  }
  inflight = (async () => {
    do {
      needsPrefetchAfter = false
      if (!readCachedNotifications(userId)) {
        await hydrateNotificationsFromDisk(userId)
      }
      await refreshNotificationsAndCount(userId)
    } while (needsPrefetchAfter)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

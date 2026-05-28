import { getCache, setCache } from '@/lib/appCache'
import {
  fetchAlertReadKeys,
  loadNotificationFeed,
  type NotificationRow,
} from '@/lib/notificationsFeed'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'

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

export async function hydrateNotificationsFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<NotificationsCache>(notificationsDiskKey(userId))
  if (!hit) return false
  cacheNotifications(userId, hit)
  return true
}

export async function persistNotificationsToDisk(userId: string, data: NotificationsCache): Promise<void> {
  await writePersistedCache(notificationsDiskKey(userId), data, DISK_TTL_MS)
}

let inflight: Promise<void> | null = null

export async function prefetchNotifications(userId: string): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (!readCachedNotifications(userId)) {
      await hydrateNotificationsFromDisk(userId)
    }
    const [feed, reads] = await Promise.all([
      loadNotificationFeed(userId),
      fetchAlertReadKeys(userId),
    ])
    const data: NotificationsCache = { rows: feed, reads: Array.from(reads) }
    cacheNotifications(userId, data)
    void persistNotificationsToDisk(userId, data)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

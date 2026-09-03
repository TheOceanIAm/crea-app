import { getCache, setCache } from '@/lib/appCache'
import { loadDirectMessageInbox, type ConvoRow } from '@/lib/messagesInboxLoad'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { queryClient } from '@/lib/queryClient'
import { messagesKey } from '@/lib/queryKeys'
import { LIST_DISK_TTL_MS, LIST_MEM_TTL_MS } from '@/lib/cachePolicy'

export type MessagesCache = {
  inbox: ConvoRow[]
  archived: ConvoRow[]
}

const DISK_TTL_MS = LIST_DISK_TTL_MS
const MEM_TTL_MS = LIST_MEM_TTL_MS

export function messagesCacheKey(userId: string): string {
  return `messages:${userId}`
}

function messagesDiskKey(userId: string): string {
  return `crea:messages:${userId}`
}

export function readCachedMessages(userId: string): MessagesCache | null {
  return getCache<MessagesCache>(messagesCacheKey(userId))
}

export function cacheMessages(userId: string, data: MessagesCache): void {
  setCache(messagesCacheKey(userId), data, MEM_TTL_MS)
}

export async function hydrateMessagesFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<MessagesCache>(messagesDiskKey(userId))
  if (!hit) return false
  cacheMessages(userId, hit)
  if (!queryClient.getQueryData(messagesKey(userId))) {
    queryClient.setQueryData(messagesKey(userId), hit)
  }
  return true
}

export async function persistMessagesToDisk(userId: string, data: MessagesCache): Promise<void> {
  await writePersistedCache(messagesDiskKey(userId), data, DISK_TTL_MS)
}

let inflight: Promise<void> | null = null

export async function prefetchMessages(userId: string): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (!readCachedMessages(userId)) {
      await hydrateMessagesFromDisk(userId)
    }
    const result = await loadDirectMessageInbox(userId)
    if (result.ok === false) return
    const data: MessagesCache = { inbox: result.inbox, archived: result.archived }
    cacheMessages(userId, data)
    queryClient.setQueryData(messagesKey(userId), data)
    void persistMessagesToDisk(userId, data)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

import { getCache, setCache } from '@/lib/appCache'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { conversationKey } from '@/lib/queryKeys'
import { LIST_DISK_TTL_MS, LIST_MEM_TTL_MS } from '@/lib/cachePolicy'

export type ConversationMsgRow = {
  id: string
  sender_id: string
  created_at: string
  body?: string
  content?: string
  message?: string
}

export type ConversationCache = {
  title: string
  otherUserId: string | null
  rows: ConversationMsgRow[]
}

const MEM_TTL_MS = LIST_MEM_TTL_MS
const DISK_TTL_MS = LIST_DISK_TTL_MS

function memKey(conversationId: string): string {
  return `conversation:${conversationId}`
}

function diskKey(conversationId: string): string {
  return `crea:conversation:${conversationId}`
}

export function readCachedConversation(conversationId: string): ConversationCache | null {
  return getCache<ConversationCache>(memKey(conversationId))
}

export function cacheConversation(conversationId: string, data: ConversationCache): void {
  setCache(memKey(conversationId), data, MEM_TTL_MS)
}

export async function hydrateConversationFromDisk(conversationId: string): Promise<ConversationCache | null> {
  const hit = await readPersistedCache<ConversationCache>(diskKey(conversationId))
  if (!hit) return null
  cacheConversation(conversationId, hit)
  return hit
}

export async function persistConversationToDisk(
  conversationId: string,
  data: ConversationCache
): Promise<void> {
  await writePersistedCache(diskKey(conversationId), data, DISK_TTL_MS)
}

async function loadConversationThread(
  conversationId: string,
  me: string
): Promise<ConversationCache> {
  const { data: convo } = await supabase
    .from('conversations')
    .select('participant_1, participant_2')
    .eq('id', conversationId)
    .maybeSingle()

  let title = 'Messages'
  let otherUserId: string | null = null
  if (convo) {
    const other = convo.participant_1 === me ? convo.participant_2 : convo.participant_1
    otherUserId = typeof other === 'string' ? other : null
    if (otherUserId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', otherUserId)
        .maybeSingle()
      if (prof?.name) title = String(prof.name)
    }
  }

  const { data: msgs, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  return { title, otherUserId, rows: (msgs ?? []) as ConversationMsgRow[] }
}

const inflight = new Map<string, Promise<ConversationCache>>()

/** Prefetch a thread into mem/disk + QueryClient (e.g. on inbox pressIn). */
export function prefetchConversation(conversationId: string, me: string): void {
  if (!conversationId || !me) return
  if (readCachedConversation(conversationId) || queryClient.getQueryData(conversationKey(conversationId))) {
    return
  }
  if (inflight.has(conversationId)) return

  const run = (async () => {
    const disk = await hydrateConversationFromDisk(conversationId)
    if (disk && !queryClient.getQueryData(conversationKey(conversationId))) {
      queryClient.setQueryData(conversationKey(conversationId), disk)
    }
    const data = await loadConversationThread(conversationId, me)
    cacheConversation(conversationId, data)
    void persistConversationToDisk(conversationId, data)
    queryClient.setQueryData(conversationKey(conversationId), data)
    return data
  })().finally(() => {
    inflight.delete(conversationId)
  })

  inflight.set(conversationId, run)
}

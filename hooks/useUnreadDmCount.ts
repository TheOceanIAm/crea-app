import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { supabase } from '@/lib/supabase'
import { subscribeDmBadgeInvalidate } from '@/lib/invalidateDmBadge'

let realtimeTopicSeq = 0

export async function fetchUnreadDmCount(uid: string): Promise<number> {
  const { data: convs, error: convErr } = await supabase
    .from('conversations')
    .select('id, participant_1, participant_2')
    .or(`participant_1.eq.${uid},participant_2.eq.${uid}`)
    .limit(200)
  if (convErr || !convs?.length) return 0

  const allIds = convs.map((c) => String(c.id))
  let ids = allIds
  const { data: archivedRows } = await supabase
    .from('conversation_archives')
    .select('conversation_id')
    .eq('user_id', uid)
    .eq('archived', true)
  if (archivedRows?.length) {
    const archived = new Set(archivedRows.map((r) => String(r.conversation_id)))
    ids = allIds.filter((id) => !archived.has(id))
  }
  if (!ids.length) return 0

  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .eq('read', false)
    .neq('sender_id', uid)
  return count ?? 0
}

/** Unread direct-message count for header badge + tab shell. */
export function useUnreadDmCount(userId: string | null, enabled = true) {
  const [count, setCount] = useState(0)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async (uid: string) => {
    if (inFlight.current) return inFlight.current
    inFlight.current = (async () => {
      try {
        const n = await fetchUnreadDmCount(uid)
        setCount(n)
      } catch {
        setCount(0)
      }
    })()
    try {
      await inFlight.current
    } finally {
      inFlight.current = null
    }
  }, [])

  useEffect(() => {
    if (!userId || !enabled) {
      setCount(0)
      return
    }
    void refresh(userId)
  }, [enabled, refresh, userId])

  useEffect(() => {
    if (!userId || !enabled) return
    return subscribeDmBadgeInvalidate(() => {
      void refresh(userId)
    })
  }, [enabled, refresh, userId])

  useEffect(() => {
    if (!userId || !enabled) return
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh(userId)
    })
    return () => sub.remove()
  }, [enabled, refresh, userId])

  useEffect(() => {
    if (!userId || !enabled) return
    const topic = `unread-dm-${userId}-${++realtimeTopicSeq}`
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void refresh(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void refresh(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_archives' }, () => {
        void refresh(userId)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [enabled, refresh, userId])

  return { unreadDmCount: count, refreshUnreadDm: refresh }
}

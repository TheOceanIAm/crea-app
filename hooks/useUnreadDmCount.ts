import { useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { fetchDmUnreadTotal } from '@/lib/dmUnreadCounts'

let realtimeTopicSeq = 0

/** Query key for the unread-DM badge. Exported so other code can invalidate it. */
export const unreadDmCountKey = (userId: string | null) =>
  ['unreadDmCount', userId ?? 'anon'] as const

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
  return fetchDmUnreadTotal(ids, uid)
}

/**
 * Unread direct-message count for header badge + tab shell.
 *
 * Backed by TanStack Query: caching, in-flight deduping and stale-while-revalidate
 * are handled by the QueryClient. App-foreground refetch is wired globally via
 * focusManager in lib/queryClient.ts. We keep one Supabase Realtime channel here
 * that invalidates the query so the badge updates live.
 */
export function useUnreadDmCount(userId: string | null, enabled = true) {
  const isEnabled = Boolean(userId) && enabled

  const { data, refetch } = useQuery({
    queryKey: unreadDmCountKey(userId),
    queryFn: () => fetchUnreadDmCount(userId as string),
    enabled: isEnabled,
    // Keep showing the previous count while a refetch is in flight (no flicker to 0).
    placeholderData: (prev) => prev,
  })

  useEffect(() => {
    if (!isEnabled || !userId) return
    const topic = `unread-dm-${userId}-${++realtimeTopicSeq}`
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: unreadDmCountKey(userId) })
    }
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, invalidate)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_archives' },
        invalidate,
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isEnabled, userId])

  const refreshUnreadDm = useCallback(async () => {
    await refetch()
  }, [refetch])

  return { unreadDmCount: data ?? 0, refreshUnreadDm }
}

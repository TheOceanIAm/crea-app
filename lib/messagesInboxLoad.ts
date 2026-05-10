import { supabase } from '@/lib/supabase'
import { messagePreviewForInbox } from '@/lib/bookingDm'
import { parseSupabaseTimestamp, supabaseTimestampMs } from '@/lib/supabaseTimestamp'

export type ConvoRow = {
  id: string
  name: string
  avatar: string
  lastMessage: string
  time: string
  unread: boolean
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Inbox time column: relative recency (reads as “how fresh”) — avoids confusion with wall-clock
 * times like 17:26 when the user expects “how long ago” vs the current time.
 */
export function formatMessageListTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = parseSupabaseTimestamp(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()

  if (diffMs < 0) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Now'
  if (mins < 60) return `${mins}m`

  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameCalendarDay(d, yesterday)) return 'Yesterday'

  const weekMs = 7 * 24 * 60 * 60 * 1000
  if (diffMs < weekMs) {
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  }

  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

async function unreadCountsForConversations(conversationIds: string[], userId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!conversationIds.length) return map
  const { data, error } = await supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', conversationIds)
    .eq('read', false)
    .neq('sender_id', userId)
  if (error) {
    console.warn('[messagesInboxLoad] unread batch', error.message)
    return map
  }
  for (const row of data ?? []) {
    const id = String((row as { conversation_id: string }).conversation_id)
    map.set(id, (map.get(id) ?? 0) + 1)
  }
  return map
}

export type LoadInboxResult =
  | { ok: true; inbox: ConvoRow[]; archived: ConvoRow[] }
  | { ok: false; error: string; inbox: ConvoRow[]; archived: ConvoRow[] }

/** Single round-trip friendly inbox load (no per-row await). */
export async function loadDirectMessageInbox(userId: string): Promise<LoadInboxResult> {
  const { data: rows, error } = await supabase
    .from('conversations')
    .select('id, participant_1, participant_2, last_message, last_message_at')
    .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(50)

  if (error) {
    console.warn('[messagesInboxLoad] conversations', error.message)
    return { ok: false, error: error.message, inbox: [], archived: [] }
  }

  const { data: archivedRows } = await supabase
    .from('conversation_archives')
    .select('conversation_id')
    .eq('user_id', userId)
    .eq('archived', true)
  const archivedIds = new Set((archivedRows ?? []).map((r) => String(r.conversation_id)))

  const listRaw = rows ?? []
  const convIdsForActivity = listRaw.map((r) => String(r.id))

  let activityAt = new Map<string, string>()
  if (convIdsForActivity.length > 0) {
    const { data: actRows, error: actErr } = await supabase.rpc('crea_dm_conversation_activity', {
      p_ids: convIdsForActivity,
    })
    if (actErr && typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[messagesInboxLoad] crea_dm_conversation_activity', actErr.message)
    }
    for (const row of (actRows ?? []) as Array<{ conversation_id: string; last_msg_at: string }>) {
      activityAt.set(String(row.conversation_id), row.last_msg_at)
    }
  }

  const list = [...listRaw].sort((a, b) => {
    const ta = activityAt.get(String(a.id)) ?? (a as { last_message_at?: string }).last_message_at
    const tb = activityAt.get(String(b.id)) ?? (b as { last_message_at?: string }).last_message_at
    const da = ta ? supabaseTimestampMs(ta) : 0
    const db = tb ? supabaseTimestampMs(tb) : 0
    return db - da
  })

  const otherIds = [...new Set(list.map((r) => (r.participant_1 === userId ? r.participant_2 : r.participant_1)).map(String))]

  const { data: profs } = otherIds.length
    ? await supabase.from('profiles').select('id, name, avatar_url').in('id', otherIds)
    : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }> }

  const profMap = new Map((profs ?? []).map((p) => [String(p.id), p]))
  const convIds = list.map((r) => String(r.id))
  const unreadMap = await unreadCountsForConversations(convIds, userId)

  const inbox: ConvoRow[] = []
  const archived: ConvoRow[] = []

  for (const row of list) {
    const otherId = row.participant_1 === userId ? row.participant_2 : row.participant_1
    const p = profMap.get(String(otherId))
    const cid = String(row.id)
    const convo: ConvoRow = {
      id: cid,
      name: (p?.name && String(p.name).trim()) || 'User',
      avatar: typeof p?.avatar_url === 'string' ? p.avatar_url : '',
      lastMessage: (() => {
        const raw = typeof row.last_message === 'string' ? row.last_message.trim() : ''
        if (!raw) return 'No messages yet'
        if (raw.startsWith('CREA_')) return messagePreviewForInbox(raw)
        return raw
      })(),
      time: formatMessageListTime(activityAt.get(cid) ?? row.last_message_at),
      unread: (unreadMap.get(cid) ?? 0) > 0,
    }
    if (archivedIds.has(cid)) archived.push(convo)
    else inbox.push(convo)
  }

  return { ok: true, inbox, archived }
}

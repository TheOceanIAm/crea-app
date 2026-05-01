import { supabase } from '@/lib/supabase'

export type ConvoRow = {
  id: string
  name: string
  avatar: string
  lastMessage: string
  time: string
  unread: boolean
}

function timeAgo(str: string | null | undefined): string {
  if (!str) return '—'
  const t = new Date(str).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
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

  const list = rows ?? []
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
      lastMessage:
        typeof row.last_message === 'string' && row.last_message.trim()
          ? row.last_message
          : 'No messages yet',
      time: timeAgo(row.last_message_at),
      unread: (unreadMap.get(cid) ?? 0) > 0,
    }
    if (archivedIds.has(cid)) archived.push(convo)
    else inbox.push(convo)
  }

  return { ok: true, inbox, archived }
}

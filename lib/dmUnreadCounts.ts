import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultClient } from '@/lib/supabase'

/**
 * Unread DM counts per conversation via SQL aggregate RPC.
 * Falls back to a bounded row scan if the RPC is unavailable.
 */
export async function fetchDmUnreadCountsByConversation(
  conversationIds: string[],
  viewerId: string,
  client: SupabaseClient = defaultClient
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const ids = [...new Set(conversationIds.map((id) => String(id).trim()).filter(Boolean))]
  if (!ids.length || !viewerId) return map

  const { data: rpcRows, error: rpcErr } = await client.rpc('crea_dm_unread_counts', {
    p_ids: ids,
  })

  if (!rpcErr && Array.isArray(rpcRows)) {
    for (const row of rpcRows as Array<{ conversation_id?: string; unread_count?: number | string }>) {
      const key = String(row.conversation_id ?? '').trim()
      if (!key) continue
      map.set(key, Number(row.unread_count) || 0)
    }
    return map
  }

  const { data, error } = await client
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', ids)
    .eq('read', false)
    .neq('sender_id', viewerId)
    .limit(5000)

  if (error) {
    console.warn('[dmUnreadCounts] fallback', error.message, rpcErr?.message)
    return map
  }
  for (const row of data ?? []) {
    const key = String((row as { conversation_id?: string }).conversation_id ?? '')
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
}

export async function fetchDmUnreadTotal(
  conversationIds: string[],
  viewerId: string,
  client: SupabaseClient = defaultClient
): Promise<number> {
  const map = await fetchDmUnreadCountsByConversation(conversationIds, viewerId, client)
  let total = 0
  for (const n of map.values()) total += n
  return total
}

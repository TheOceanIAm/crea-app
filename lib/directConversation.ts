import { supabase } from '@/lib/supabase'

function orderedParticipants(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

/**
 * Find or create a 1:1 conversation between the current user and another profile.
 * Returns null if not authenticated or on error.
 */
export async function findOrCreateDirectConversation(peerId: string): Promise<
  { ok: true; conversationId: string } | { ok: false; error: string }
> {
  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  if (!me) {
    return { ok: false, error: 'not_authenticated' }
  }
  if (me === peerId) {
    return { ok: false, error: 'self' }
  }

  const [p1, p2] = orderedParticipants(me, peerId)

  const { data: existing, error: findErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('participant_1', p1)
    .eq('participant_2', p2)
    .maybeSingle()

  if (findErr) {
    return { ok: false, error: findErr.message }
  }
  if (existing?.id) {
    return { ok: true, conversationId: String(existing.id) }
  }

  const now = new Date().toISOString()
  const { data: created, error: insErr } = await supabase
    .from('conversations')
    .insert({
      participant_1: p1,
      participant_2: p2,
      last_message: '',
      last_message_at: now,
    })
    .select('id')
    .single()

  if (insErr || !created?.id) {
    return { ok: false, error: insErr?.message ?? 'insert_failed' }
  }
  return { ok: true, conversationId: String(created.id) }
}

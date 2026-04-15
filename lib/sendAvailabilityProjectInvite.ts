import { supabase } from '@/lib/supabase'
import { findOrCreateDirectConversation } from '@/lib/directConversation'

async function insertMessageBody(conversationId: string, senderId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {
    conversation_id: conversationId,
    sender_id: senderId,
    body: text,
    read: false,
  }
  let { error } = await supabase.from('messages').insert(payload)
  if (error?.message?.includes('column') && error.message.includes('body')) {
    const alt = { ...payload }
    delete alt.body
    alt.content = text
    const r2 = await supabase.from('messages').insert(alt)
    error = r2.error
  }
  if (error) {
    return { ok: false, error: error.message }
  }
  await supabase
    .from('conversations')
    .update({ last_message: text, last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
  return { ok: true }
}

/**
 * Sends a DM to the freelancer with project + date (company workflow from availability).
 */
export async function sendAvailabilityProjectInvite(params: {
  freelancerId: string
  projectId: string
  projectTitle: string
  isoDate: string
}): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const conv = await findOrCreateDirectConversation(params.freelancerId)
  if (!conv.ok) return conv

  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  if (!me) return { ok: false, error: 'not_authenticated' }

  const dateLabel = new Date(`${params.isoDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const title = params.projectTitle.trim() || 'Project'
  const body = `Availability: I’d like to book you for «${title}» on ${dateLabel} (${params.isoDate}).\nOpen project: crea://project/${params.projectId}`

  const ins = await insertMessageBody(conv.conversationId, me, body)
  if (ins.ok === false) return { ok: false, error: ins.error }

  return { ok: true, conversationId: conv.conversationId }
}

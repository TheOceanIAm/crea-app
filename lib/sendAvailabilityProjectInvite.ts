import { supabase } from '@/lib/supabase'
import { toISODateLocal } from '@/lib/availabilityCalendar'
import { bookingInboxPreview, formatBookingDmBody, type BookingDmPayloadV1 } from '@/lib/bookingDm'
import { findOrCreateDirectConversation } from '@/lib/directConversation'
import { requestNotifyRecipientPush } from '@/lib/notifyMessagePush'

async function insertMessageBody(
  conversationId: string,
  senderId: string,
  text: string,
  opts?: { conversationPreview?: string }
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {
    conversation_id: conversationId,
    sender_id: senderId,
    body: text,
    read: false,
  }
  let { data: inserted, error } = await supabase.from('messages').insert(payload).select('id').single()
  if (error?.message?.includes('column') && error.message.includes('body')) {
    const alt = { ...payload }
    delete alt.body
    alt.content = text
    const r2 = await supabase.from('messages').insert(alt).select('id').single()
    inserted = r2.data
    error = r2.error
  }
  if (error) {
    return { ok: false, error: error.message }
  }
  const messageId = typeof inserted?.id === 'string' ? inserted.id : ''
  if (!messageId) {
    return { ok: false, error: 'Message id missing' }
  }
  await supabase
    .from('conversations')
    .update({
      last_message: opts?.conversationPreview ?? text,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
  return { ok: true, messageId }
}

/**
 * Sends a DM to the freelancer with project + date(s) (company workflow from availability).
 */
export async function sendAvailabilityProjectInvite(params: {
  freelancerId: string
  projectId: string
  projectTitle: string
  /** Optional: override deep link target, e.g. `crea://jobs/<id>`. */
  openDeepLink?: string
  /** First day (inclusive). */
  isoStartDate: string
  /** Last day (inclusive); defaults to start when omitted. */
  isoEndDate?: string
  /** All chosen calendar days (sorted), for non-contiguous ranges. */
  selectedIsoDates?: string[]
  userMessage?: string
}): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const { data: fp } = await supabase
    .from('freelancer_profiles')
    .select('plan_tier')
    .eq('id', params.freelancerId)
    .maybeSingle()
  const planTier = String((fp as { plan_tier?: string | null } | null)?.plan_tier ?? '')
    .trim()
    .toLowerCase()
  if (planTier === 'workspace') {
    return {
      ok: false,
      error: 'Booking invites are not available for this account plan.',
    }
  }

  const conv = await findOrCreateDirectConversation(params.freelancerId)
  if (!conv.ok) return conv

  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  if (!me) return { ok: false, error: 'not_authenticated' }

  const end = params.isoEndDate ?? params.isoStartDate
  let unique: string[]
  if (params.selectedIsoDates && params.selectedIsoDates.length > 0) {
    unique = Array.from(new Set(params.selectedIsoDates)).sort()
  } else {
    const out: string[] = []
    const a = new Date(`${params.isoStartDate}T12:00:00`)
    const b = new Date(`${end}T12:00:00`)
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
      unique = [params.isoStartDate]
    } else {
      const cursor = new Date(a)
      while (cursor <= b) {
        out.push(toISODateLocal(cursor))
        cursor.setDate(cursor.getDate() + 1)
      }
      unique = out
    }
  }
  const title = params.projectTitle.trim() || 'Project'
  const openDeepLink = params.openDeepLink?.trim() || `crea://project/${params.projectId}`
  const payload: BookingDmPayloadV1 = {
    v: 1,
    title,
    isoStartDate: params.isoStartDate,
    isoEndDate: end,
    selectedIsoDates: unique,
    userMessage: params.userMessage?.trim() || undefined,
    openDeepLink,
  }
  const body = formatBookingDmBody(payload)
  const preview = bookingInboxPreview(payload)

  const ins = await insertMessageBody(conv.conversationId, me, body, { conversationPreview: preview })
  if (ins.ok === false) return { ok: false, error: ins.error }

  const base = params.openDeepLink?.trim() || `crea://project/${params.projectId}`
  const sep = base.includes('?') ? '&' : '?'
  const enrichedOpen = `${base}${sep}bookingMsg=${encodeURIComponent(ins.messageId)}&conv=${encodeURIComponent(conv.conversationId)}`
  const payloadEnriched: BookingDmPayloadV1 = { ...payload, openDeepLink: enrichedOpen }
  const bodyEnriched = formatBookingDmBody(payloadEnriched)
  let upErr = (await supabase.from('messages').update({ body: bodyEnriched }).eq('id', ins.messageId)).error
  if (upErr?.message?.includes('column') || upErr?.message?.includes('body')) {
    upErr = (await supabase.from('messages').update({ content: bodyEnriched }).eq('id', ins.messageId)).error
  }
  if (upErr && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[sendAvailabilityProjectInvite] patch deep link', upErr.message)
  }

  void requestNotifyRecipientPush(ins.messageId)

  return { ok: true, conversationId: conv.conversationId }
}

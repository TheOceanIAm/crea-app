import { supabase } from '@/lib/supabase'
import { formatBookingReplyBody, type BookingReplyStatus } from '@/lib/bookingDm'
import { requestNotifyRecipientPush } from '@/lib/notifyMessagePush'

/**
 * Freelancer accepts/declines a structured booking DM; notifies the company via the same thread + push.
 */
export async function replyToBookingMessage(opts: {
  conversationId: string
  bookingMessageId: string
  status: BookingReplyStatus
  projectTitle: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  if (!me) return { ok: false, error: 'not_authenticated' }

  const humanLine =
    opts.status === 'accepted'
      ? `Accepted the booking request for «${opts.projectTitle}».`
      : `Declined the booking request for «${opts.projectTitle}».`
  const wireBody = formatBookingReplyBody(
    { v: 1, forMessageId: opts.bookingMessageId, status: opts.status },
    humanLine
  )

  if (opts.status === 'accepted') {
    const { error: syncErr } = await supabase.rpc('sync_project_member_from_booking_accept', {
      p_booking_message_id: opts.bookingMessageId,
    })
    if (syncErr) return { ok: false, error: syncErr.message }
  }

  const payload: Record<string, unknown> = {
    conversation_id: opts.conversationId,
    sender_id: me,
    body: wireBody,
    read: false,
  }
  let { data: inserted, error } = await supabase.from('messages').insert(payload).select('id').single()
  if (error?.message?.includes('column') && error.message.includes('body')) {
    const alt = { ...payload }
    delete alt.body
    alt.content = wireBody
    const r2 = await supabase.from('messages').insert(alt).select('id').single()
    inserted = r2.data
    error = r2.error
  }
  if (error) return { ok: false, error: error.message }

  await supabase
    .from('conversations')
    .update({ last_message: humanLine, last_message_at: new Date().toISOString() })
    .eq('id', opts.conversationId)

  if (inserted?.id) void requestNotifyRecipientPush(inserted.id)
  return { ok: true }
}

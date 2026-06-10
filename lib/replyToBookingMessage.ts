import { supabase } from '@/lib/supabase'
import { formatBookingReplyBody, type BookingReplyStatus } from '@/lib/bookingDm'
import { requestNotifyRecipientPush } from '@/lib/notifyMessagePush'

function bookingAcceptErrorMessage(raw: string): string {
  const m = raw.trim().toLowerCase()
  if (m.includes('invalid booking payload') || m.includes('not a booking request')) {
    return 'This booking invite could not be read. Ask the company to send a new invite from the job listing.'
  }
  if (m.includes('project not found')) {
    return 'The linked project is no longer available. Ask the company to re-send the booking from an active job.'
  }
  if (m.includes('could not match job') || m.includes('could not parse project')) {
    return 'We could not match this invite to a job. Ask the company to send it again from Jobs.'
  }
  if (m.includes('forbidden')) {
    return 'You cannot accept this booking invite.'
  }
  return raw.trim() || 'Something went wrong. Try again.'
}

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
    if (syncErr) return { ok: false, error: bookingAcceptErrorMessage(syncErr.message) }
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

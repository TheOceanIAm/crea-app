import { supabase } from '@/lib/supabase'

/** App → web: mirror project chat into job_messages when this project is linked to a job listing. */
export async function mirrorProjectMessageToJob(opts: {
  jobId: string
  senderId: string
  body: string
  /** Copy project row timestamp so merge/realtime dedupe matches. */
  createdAt?: string | null
}): Promise<{ error: string | null }> {
  const createdAt =
    typeof opts.createdAt === 'string' && !Number.isNaN(Date.parse(opts.createdAt))
      ? new Date(opts.createdAt).toISOString()
      : null
  const { error } = await supabase.from('job_messages').insert({
    job_id: opts.jobId,
    sender_id: opts.senderId,
    content: opts.body,
    ...(createdAt ? { created_at: createdAt } : {}),
  })
  if (error) {
    console.warn('[mirrorProjectMessageToJob]', error.message)
    return { error: error.message }
  }
  return { error: null }
}

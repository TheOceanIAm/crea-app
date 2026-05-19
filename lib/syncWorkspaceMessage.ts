import { supabase } from '@/lib/supabase'

/** App → web: mirror project chat into job_messages when this project is linked to a job listing. */
export async function mirrorProjectMessageToJob(opts: {
  jobId: string
  senderId: string
  body: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('job_messages').insert({
    job_id: opts.jobId,
    sender_id: opts.senderId,
    content: opts.body,
  })
  if (error) {
    console.warn('[mirrorProjectMessageToJob]', error.message)
    return { error: error.message }
  }
  return { error: null }
}

import type { SupabaseClient } from '@supabase/supabase-js'

export type DeleteCompanyJobResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Company marketplace jobs are `jobs` with `is_solo_workspace=false`.
 * Hard-deletes the job (child rows cascade via FKs) and cleans up the mirrored
 * `projects` row. A DB trigger also removes the mirrored project, but we clean up
 * client-side too so the list refreshes immediately.
 */
export async function deleteCompanyJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string
): Promise<DeleteCompanyJobResult> {
  const id = jobId.trim()
  if (!id) return { ok: false, error: 'Invalid job.' }

  const { data: deletedJobs, error: jobErr } = await supabase
    .from('jobs')
    .delete()
    .eq('id', id)
    .eq('company_id', userId)
    .eq('is_solo_workspace', false)
    .select('id')

  if (jobErr) return { ok: false, error: jobErr.message }

  if (!deletedJobs?.length) {
    return {
      ok: false,
      error:
        'Could not delete this job. If this keeps happening, ask support to apply the latest database migration (company job delete policy).',
    }
  }

  const { error: projectErr } = await supabase
    .from('projects')
    .delete()
    .eq('company_id', userId)
    .or(`id.eq.${id},job_id.eq.${id}`)

  if (projectErr && __DEV__) {
    console.warn('[deleteCompanyJob] projects cleanup', projectErr.message)
  }

  return { ok: true }
}

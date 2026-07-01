import type { SupabaseClient } from '@supabase/supabase-js'

export type DeletePrivateWorkspaceProjectResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Private workspaces are `jobs` with `is_solo_workspace=true`.
 * Deleting only `projects` leaves the job row and sync recreates the project on next load.
 */
export async function deletePrivateWorkspaceProject(
  supabase: SupabaseClient,
  userId: string,
  listingId: string
): Promise<DeletePrivateWorkspaceProjectResult> {
  const id = listingId.trim()
  if (!id) return { ok: false, error: 'Invalid project.' }

  const { data: deletedJobs, error: jobErr } = await supabase
    .from('jobs')
    .delete()
    .eq('id', id)
    .eq('company_id', userId)
    .eq('is_solo_workspace', true)
    .select('id')

  if (jobErr) return { ok: false, error: jobErr.message }

  if (!deletedJobs?.length) {
    return {
      ok: false,
      error:
        'Could not delete this workspace. If this keeps happening, ask support to apply the latest database migration (solo workspace delete policy).',
    }
  }

  const { error: projectErr } = await supabase
    .from('projects')
    .delete()
    .eq('company_id', userId)
    .or(`id.eq.${id},job_id.eq.${id}`)

  if (projectErr && __DEV__) {
    console.warn('[deletePrivateWorkspaceProject] projects cleanup', projectErr.message)
  }

  return { ok: true }
}

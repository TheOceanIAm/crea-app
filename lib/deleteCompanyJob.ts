import type { SupabaseClient } from '@supabase/supabase-js'

import { deletePrivateWorkspaceProject } from '@/lib/deletePrivateWorkspaceProject'

export type DeleteCompanyJobResult =
  | { ok: true }
  | { ok: false; error: string }

const DELETE_BLOCKED =
  'Could not delete this job. If this keeps happening, ask support to apply the latest database migration (company job delete policy).'

type ResolvedListing =
  | { kind: 'job'; jobId: string; solo: boolean }
  | { kind: 'orphan-project' }
  | { kind: 'missing' }

/**
 * Company project lists pass `projects.id`. Newer rows share that id with `jobs`.
 * Older public projects can exist only on `projects` (no `job_id`), so a jobs
 * delete by that id matches nothing and looks like a missing RLS policy.
 */
async function resolveListing(supabase: SupabaseClient, id: string): Promise<ResolvedListing> {
  const { data: jobById } = await supabase
    .from('jobs')
    .select('id, is_solo_workspace')
    .eq('id', id)
    .maybeSingle()
  if (jobById?.id) {
    return { kind: 'job', jobId: String(jobById.id), solo: Boolean(jobById.is_solo_workspace) }
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, job_id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return { kind: 'missing' }

  const linkedJobId = typeof project.job_id === 'string' ? project.job_id.trim() : ''
  if (!linkedJobId) return { kind: 'orphan-project' }

  const { data: linked } = await supabase
    .from('jobs')
    .select('id, is_solo_workspace')
    .eq('id', linkedJobId)
    .maybeSingle()
  if (!linked?.id) return { kind: 'orphan-project' }
  return { kind: 'job', jobId: String(linked.id), solo: Boolean(linked.is_solo_workspace) }
}

async function deleteOrphanProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string
): Promise<DeleteCompanyJobResult> {
  const { data: deleted, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('company_id', userId)
    .select('id')

  if (error) return { ok: false, error: error.message }
  if (!deleted?.length) {
    return { ok: false, error: 'Could not delete this project.' }
  }
  return { ok: true }
}

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

  const listing = await resolveListing(supabase, id)
  if (listing.kind === 'missing') return { ok: false, error: DELETE_BLOCKED }
  if (listing.kind === 'orphan-project') return deleteOrphanProject(supabase, userId, id)
  if (listing.solo) {
    return deletePrivateWorkspaceProject(supabase, userId, listing.jobId)
  }

  const { data: rpcRows, error: rpcErr } = await supabase.rpc('delete_company_job_listing', {
    p_job_id: listing.jobId,
  })
  const rpcRow = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as { id?: string } | null
  if (!rpcErr && rpcRow?.id) {
    await supabase
      .from('projects')
      .delete()
      .eq('company_id', userId)
      .or(`id.eq.${id},job_id.eq.${listing.jobId}`)
    return { ok: true }
  }

  const { data: deletedJobs, error: jobErr } = await supabase
    .from('jobs')
    .delete()
    .eq('id', listing.jobId)
    .eq('is_solo_workspace', false)
    .select('id')

  if (jobErr) return { ok: false, error: jobErr.message }

  if (!deletedJobs?.length) {
    return { ok: false, error: rpcErr?.message || DELETE_BLOCKED }
  }

  const { error: projectErr } = await supabase
    .from('projects')
    .delete()
    .eq('company_id', userId)
    .or(`id.eq.${id},job_id.eq.${listing.jobId}`)

  if (projectErr && __DEV__) {
    console.warn('[deleteCompanyJob] projects cleanup', projectErr.message)
  }

  return { ok: true }
}

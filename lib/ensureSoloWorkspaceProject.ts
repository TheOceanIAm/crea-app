import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Web private projects are `jobs` with `is_solo_workspace`; native workspace reads `public.projects`.
 * Creates a matching `projects` row (same id as `jobs.id`) when missing — idempotent.
 */
export async function ensureSoloWorkspaceProjectRow(
  supabase: SupabaseClient,
  params: { projectOrJobId: string; userId: string }
): Promise<{ ok: boolean; reason?: string }> {
  const { projectOrJobId, userId } = params

  const { data: existing } = await supabase.from('projects').select('id').eq('id', projectOrJobId).maybeSingle()
  if (existing?.id) return { ok: true }

  const { error: rpcErr } = await supabase.rpc('ensure_solo_workspace_project_for_job', {
    p_job_id: projectOrJobId,
  })
  if (!rpcErr) {
    const { data: afterRpc } = await supabase.from('projects').select('id').eq('id', projectOrJobId).maybeSingle()
    if (afterRpc?.id) return { ok: true }
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select(
      'id, title, company_id, is_solo_workspace, status, budget_type, budget_amount, location, updated_at'
    )
    .eq('id', projectOrJobId)
    .maybeSingle()

  if (jobErr || !job) return { ok: false, reason: 'job_not_found' }

  const row = job as {
    id: string
    title?: string | null
    company_id: string
    is_solo_workspace?: boolean | null
    status?: string | null
    budget_type?: string | null
    budget_amount?: number | null
    location?: string | null
    updated_at?: string | null
  }

  if (!row.is_solo_workspace || row.company_id !== userId) {
    return { ok: false, reason: 'not_solo_owner' }
  }

  const { error: insErr } = await supabase.from('projects').insert({
    id: row.id,
    job_id: row.id,
    company_id: userId,
    freelancer_id: userId,
    title: (row.title && String(row.title).trim()) || 'Untitled project',
    status: typeof row.status === 'string' && row.status.trim() ? row.status : 'active',
    budget_type: row.budget_type ?? 'negotiable',
    budget_amount: row.budget_amount ?? null,
    location: row.location?.trim() ? row.location : 'Remote',
  })

  if (insErr) {
    if (insErr.code === '23505') return { ok: true }
    return { ok: false, reason: insErr.message }
  }

  return { ok: true }
}

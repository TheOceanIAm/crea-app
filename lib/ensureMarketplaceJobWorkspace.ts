import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Native workspace reads `public.projects`. Marketplace listings need a row as soon as the job exists
 * so the company can open `/project/:id` without a manual step. Lead `freelancer_id` starts as
 * `company_id` until an application is accepted (handled in DB).
 */
export async function ensureMarketplaceJobWorkspaceRow(
  supabase: SupabaseClient,
  params: { jobId: string; userId: string }
): Promise<{ ok: boolean; projectId?: string; reason?: string }> {
  const { jobId, userId } = params

  const { data: existing } = await supabase.from('projects').select('id').eq('job_id', jobId).maybeSingle()
  if (existing?.id) return { ok: true, projectId: existing.id }

  const { data: byPk } = await supabase.from('projects').select('id').eq('id', jobId).maybeSingle()
  if (byPk?.id) return { ok: true, projectId: byPk.id }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select(
      'id, company_id, is_solo_workspace, title, project_status, budget_type, budget_amount, budget_currency, location, location_type'
    )
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr || !job) return { ok: false, reason: 'job_not_found' }

  const row = job as {
    id: string
    company_id: string
    is_solo_workspace?: boolean | null
    title?: string | null
    project_status?: string | null
    budget_type?: string | null
    budget_amount?: number | null
    budget_currency?: string | null
    location?: string | null
    location_type?: string | null
  }

  if (row.company_id !== userId || row.is_solo_workspace) {
    return { ok: false, reason: 'not_company_marketplace_job' }
  }

  const ps =
    typeof row.project_status === 'string' && row.project_status.trim()
      ? row.project_status.trim()
      : 'active'
  const loc =
    (row.location && String(row.location).trim()) ||
    (row.location_type && String(row.location_type).trim()) ||
    'Remote'

  const { data: inserted, error: insErr } = await supabase
    .from('projects')
    .insert({
      id: row.id,
      job_id: row.id,
      company_id: row.company_id,
      freelancer_id: row.company_id,
      title: (row.title && String(row.title).trim()) || 'Untitled project',
      status: ps,
      budget_type: row.budget_type ?? 'negotiable',
      budget_amount: row.budget_amount ?? null,
      budget_currency: (row.budget_currency && String(row.budget_currency).trim()) || 'EUR',
      location: loc,
    })
    .select('id')
    .maybeSingle()

  if (insErr) {
    if (insErr.code === '23505') {
      const { data: again } = await supabase.from('projects').select('id').eq('job_id', jobId).maybeSingle()
      if (again?.id) return { ok: true, projectId: again.id }
    }
    return { ok: false, reason: insErr.message }
  }

  if (inserted?.id) return { ok: true, projectId: inserted.id }
  return { ok: false, reason: 'insert_failed' }
}

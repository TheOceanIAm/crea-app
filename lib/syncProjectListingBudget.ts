import type { SupabaseClient } from '@supabase/supabase-js'

export type SyncProjectListingBudgetInput = {
  total_budget: number | null
  currency?: string | null
}

/**
 * Mirror budget-tab targets into jobs/projects listing fields used by project overview cards.
 */
export async function syncProjectListingBudget(
  supabase: SupabaseClient,
  projectId: string,
  input: SyncProjectListingBudgetInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const currency = (input.currency?.trim() || 'EUR').toUpperCase()
  const amount = input.total_budget
  const budgetType = amount != null ? 'fixed' : 'negotiable'

  const { data: proj, error: projErr } = await supabase
    .from('projects')
    .select('id, job_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projErr) return { ok: false, error: projErr.message }
  if (!proj?.id) return { ok: false, error: 'Project not found.' }

  const { error: projectUpdErr } = await supabase
    .from('projects')
    .update({
      budget_amount: amount,
      budget_type: budgetType,
      budget_currency: currency,
    })
    .eq('id', projectId)

  if (projectUpdErr) return { ok: false, error: projectUpdErr.message }

  const jobId =
    typeof proj.job_id === 'string' && proj.job_id.trim().length > 0 ? proj.job_id.trim() : projectId

  const { error: jobUpdErr } = await supabase
    .from('jobs')
    .update({
      budget_amount: amount,
      budget_type: budgetType,
      budget_currency: currency,
    })
    .eq('id', jobId)

  if (jobUpdErr) return { ok: false, error: jobUpdErr.message }

  return { ok: true }
}

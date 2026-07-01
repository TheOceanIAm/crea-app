import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureSoloWorkspaceProjectRow } from '@/lib/ensureSoloWorkspaceProject'
import type { JobListingBudgetType } from '@/lib/jobListingBudget'

export type CreatePrivateWorkspaceProjectInput = {
  title: string
  notes?: string
  clientLabel?: string
  budget_type?: JobListingBudgetType
  budget_amount?: number | null
  budget_currency?: string
}

export type CreatePrivateWorkspaceProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string }

/**
 * Private workspaces are `jobs` rows with `is_solo_workspace=true` (web parity).
 * A DB trigger / RPC mirrors them into `public.projects` for the native workspace UI.
 */
export async function createPrivateWorkspaceProject(
  supabase: SupabaseClient,
  userId: string,
  input: CreatePrivateWorkspaceProjectInput
): Promise<CreatePrivateWorkspaceProjectResult> {
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'Project name is required.' }

  const notes = (input.notes ?? '').trim()
  const clientLabel = (input.clientLabel ?? '').trim()
  const budgetType = input.budget_type ?? 'negotiable'
  const budgetCurrency = (input.budget_currency ?? 'EUR').trim().toUpperCase() || 'EUR'
  const budgetAmount = budgetType === 'negotiable' ? null : (input.budget_amount ?? null)
  const description =
    notes ||
    'Private workspace — add a brief, milestones, and files in the project workspace.'

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      company_id: userId,
      title,
      category: 'General',
      location: 'Remote',
      location_type: 'Remote',
      location_geo: null,
      budget_type: budgetType,
      budget_amount: budgetAmount,
      budget_currency: budgetCurrency,
      budget_max: null,
      description,
      skills: [],
      budget_breakdown: null,
      status: 'active',
      start_date: null,
      is_solo_workspace: true,
      solo_workspace_client_label: clientLabel || null,
    })
    .select('id')
    .single()

  if (jobErr || !job?.id) {
    return { ok: false, error: jobErr?.message ?? 'Could not create workspace.' }
  }

  const ensured = await ensureSoloWorkspaceProjectRow(supabase, {
    projectOrJobId: job.id,
    userId,
  })
  if (!ensured.ok) {
    return { ok: false, error: ensured.reason ?? 'Could not open workspace project.' }
  }

  if (notes) {
    const { error: briefErr } = await supabase
      .from('projects')
      .update({
        brief_ai_context: notes,
        brief_ai_outputs: { workspace_summary: notes },
      })
      .eq('id', job.id)

    if (briefErr) {
      return { ok: false, error: briefErr.message }
    }
  }

  return { ok: true, projectId: job.id }
}

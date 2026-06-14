import type { SupabaseClient } from '@supabase/supabase-js'

/** Keep in sync with crea-services — canonical workspace milestones live on `public.milestones` (job_id). */

export type WorkspaceMilestoneStatus = 'pending' | 'in_progress' | 'completed'

export type WorkspaceMilestoneDbRow = {
  id: string
  job_id: string
  title: string
  status: string
  due_at?: string | null
  due_date?: string | null
  position: number
}

export type WorkspaceMilestoneUi = {
  id: string
  title: string
  completed: boolean
  scheduledAt: string | null
  sortOrder: number
}

const MILESTONE_SELECT =
  'id, job_id, title, status, due_at, due_date, position'

export function mapWorkspaceMilestoneToUi(row: WorkspaceMilestoneDbRow): WorkspaceMilestoneUi {
  const status = String(row.status ?? 'pending').toLowerCase()
  const scheduledAt = row.due_at?.trim() || row.due_date?.trim() || null
  return {
    id: row.id,
    title: row.title,
    completed: status === 'completed',
    scheduledAt,
    sortOrder: typeof row.position === 'number' ? row.position : 0,
  }
}

export async function fetchWorkspaceMilestones(
  supabase: SupabaseClient,
  jobId: string
): Promise<{ rows: WorkspaceMilestoneUi[]; error: string | null }> {
  const { data, error } = await supabase
    .from('milestones')
    .select(MILESTONE_SELECT)
    .eq('job_id', jobId)
    .order('position', { ascending: true })

  if (error) return { rows: [], error: error.message }
  return {
    rows: ((data ?? []) as WorkspaceMilestoneDbRow[]).map(mapWorkspaceMilestoneToUi),
    error: null,
  }
}

export async function insertWorkspaceMilestone(
  supabase: SupabaseClient,
  opts: {
    jobId: string
    title: string
    position: number
    scheduledAt: string | null
  }
): Promise<{ row: WorkspaceMilestoneUi | null; error: string | null }> {
  const { data, error } = await supabase
    .from('milestones')
    .insert({
      job_id: opts.jobId,
      title: opts.title,
      status: 'pending',
      position: opts.position,
      due_at: opts.scheduledAt,
      due_date: opts.scheduledAt,
    })
    .select(MILESTONE_SELECT)
    .single()

  if (error) return { row: null, error: error.message }
  return { row: mapWorkspaceMilestoneToUi(data as WorkspaceMilestoneDbRow), error: null }
}

export async function setWorkspaceMilestoneCompleted(
  supabase: SupabaseClient,
  milestoneId: string,
  completed: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('milestones')
    .update({ status: completed ? 'completed' : 'pending' })
    .eq('id', milestoneId)
  return { error: error?.message ?? null }
}

export async function deleteWorkspaceMilestone(
  supabase: SupabaseClient,
  milestoneId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('milestones').delete().eq('id', milestoneId)
  return { error: error?.message ?? null }
}

import type { SupabaseClient } from '@supabase/supabase-js'

/** Keep in sync with crea-services — canonical workspace milestones live on `public.milestones` (job_id). */

export type WorkspaceMilestoneStatus = 'pending' | 'in_progress' | 'completed'
export type WorkspaceMilestonePriority = 'p1' | 'p2' | 'p3'

export type WorkspaceMilestoneDbRow = {
  id: string
  job_id: string
  title: string
  status: string
  priority?: string | null
  due_at?: string | null
  due_date?: string | null
  position: number
}

export type WorkspaceMilestoneUi = {
  id: string
  title: string
  completed: boolean
  priority: WorkspaceMilestonePriority
  scheduledAt: string | null
  sortOrder: number
}

export const MILESTONE_PRIORITY_CONFIG: Record<
  WorkspaceMilestonePriority,
  { label: string; short: string; color: string; bg: string; border: string }
> = {
  p1: {
    label: 'Priority 1',
    short: 'P1',
    color: '#f87171',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.35)',
  },
  p2: {
    label: 'Priority 2',
    short: 'P2',
    color: '#FFDC00',
    bg: 'rgba(255,220,0,0.12)',
    border: 'rgba(255,220,0,0.35)',
  },
  p3: {
    label: 'Priority 3',
    short: 'P3',
    color: '#4ade80',
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.35)',
  },
}

const MILESTONE_SELECT = 'id, job_id, title, status, priority, due_at, due_date, position'

export function parseWorkspaceMilestonePriority(value: unknown): WorkspaceMilestonePriority {
  const raw = String(value ?? 'p3').toLowerCase()
  if (raw === 'p1' || raw === 'p2' || raw === 'p3') return raw
  return 'p3'
}

export function mapWorkspaceMilestoneToUi(row: WorkspaceMilestoneDbRow): WorkspaceMilestoneUi {
  const status = String(row.status ?? 'pending').toLowerCase()
  const scheduledAt = row.due_at?.trim() || row.due_date?.trim() || null
  return {
    id: row.id,
    title: row.title,
    completed: status === 'completed',
    priority: parseWorkspaceMilestonePriority(row.priority),
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
    priority?: WorkspaceMilestonePriority
  }
): Promise<{ row: WorkspaceMilestoneUi | null; error: string | null }> {
  const priority = opts.priority ?? 'p3'
  const { data, error } = await supabase
    .from('milestones')
    .insert({
      job_id: opts.jobId,
      title: opts.title,
      status: 'pending',
      priority,
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

export async function setWorkspaceMilestonePriority(
  supabase: SupabaseClient,
  milestoneId: string,
  priority: WorkspaceMilestonePriority
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('milestones').update({ priority }).eq('id', milestoneId)
  return { error: error?.message ?? null }
}

export async function deleteWorkspaceMilestone(
  supabase: SupabaseClient,
  milestoneId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('milestones').delete().eq('id', milestoneId)
  return { error: error?.message ?? null }
}

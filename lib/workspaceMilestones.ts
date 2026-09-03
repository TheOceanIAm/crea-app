import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

/** Keep in sync with crea-services — canonical workspace milestones live on `public.milestones` (job_id). */

export type WorkspaceMilestoneStatus = 'pending' | 'in_progress' | 'completed'
export type WorkspaceMilestonePriority = 'p1' | 'p2' | 'p3'

/** Secondary Postgres error after a failed statement in the same transaction. */
const TX_ABORTED_RE = /current transaction is aborted|commands ignored until end of transaction/i

export function isTransactionAbortedError(message: string | null | undefined): boolean {
  return Boolean(message && TX_ABORTED_RE.test(message))
}

/** User-facing copy; never surface raw "transaction is aborted" strings. */
export function friendlyMilestoneError(
  action: 'load' | 'add' | 'update' | 'delete',
  message: string | null | undefined
): string {
  if (isTransactionAbortedError(message)) {
    switch (action) {
      case 'load':
        return 'Could not load milestones. Please try again.'
      case 'add':
        return 'Could not add this milestone. Please try again.'
      case 'update':
        return 'Could not update this milestone. Please try again.'
      case 'delete':
        return 'Could not remove this milestone. Please try again.'
    }
  }
  const trimmed = message?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'Something went wrong. Please try again.'
}

function logMilestoneDbError(context: string, error: PostgrestError | null | undefined) {
  if (!error) return
  console.error(`[milestones] ${context}`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  })
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export type WorkspaceMilestoneDbRow = {
  id: string
  job_id: string
  title: string
  description?: string | null
  status: string
  priority?: string | null
  due_at?: string | null
  due_date?: string | null
  position: number
  deliverables?: unknown
  frameio_url?: string | null
}

export type WorkspaceMilestoneUi = {
  id: string
  title: string
  description: string
  completed: boolean
  status: WorkspaceMilestoneStatus
  priority: WorkspaceMilestonePriority
  scheduledAt: string | null
  sortOrder: number
  deliverables: string[]
  frameioUrl: string | null
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

const MILESTONE_SELECT =
  'id, job_id, title, description, status, priority, due_at, due_date, position, deliverables, frameio_url'

const STATUSES: WorkspaceMilestoneStatus[] = ['pending', 'in_progress', 'completed']

export const MILESTONE_STATUS_CONFIG: Record<
  WorkspaceMilestoneStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  pending: {
    label: 'Pending',
    color: 'rgba(255,255,255,0.45)',
    bg: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.12)',
  },
  in_progress: {
    label: 'In Progress',
    color: '#FFDC00',
    bg: 'rgba(255,220,0,0.1)',
    border: 'rgba(255,220,0,0.3)',
  },
  completed: {
    label: 'Completed',
    color: '#4ade80',
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.3)',
  },
}

export function parseWorkspaceMilestonePriority(value: unknown): WorkspaceMilestonePriority {
  const raw = String(value ?? 'p3').toLowerCase()
  if (raw === 'p1' || raw === 'p2' || raw === 'p3') return raw
  return 'p3'
}

export function parseWorkspaceMilestoneStatus(value: unknown): WorkspaceMilestoneStatus {
  const raw = String(value ?? 'pending').toLowerCase()
  if (STATUSES.includes(raw as WorkspaceMilestoneStatus)) return raw as WorkspaceMilestoneStatus
  return 'pending'
}

export function parseWorkspaceMilestoneDeliverables(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function mapWorkspaceMilestoneToUi(row: WorkspaceMilestoneDbRow): WorkspaceMilestoneUi {
  const status = parseWorkspaceMilestoneStatus(row.status)
  const scheduledAt = row.due_at?.trim() || row.due_date?.trim() || null
  const frameioUrl = row.frameio_url?.trim() || null
  return {
    id: row.id,
    title: row.title,
    description: typeof row.description === 'string' ? row.description.trim() : '',
    completed: status === 'completed',
    status,
    priority: parseWorkspaceMilestonePriority(row.priority),
    scheduledAt,
    sortOrder: typeof row.position === 'number' ? row.position : 0,
    deliverables: parseWorkspaceMilestoneDeliverables(row.deliverables),
    frameioUrl,
  }
}

export async function fetchWorkspaceMilestones(
  supabase: SupabaseClient,
  jobId: string
): Promise<{ rows: WorkspaceMilestoneUi[]; error: string | null }> {
  const run = () =>
    supabase
      .from('milestones')
      .select(MILESTONE_SELECT)
      .eq('job_id', jobId)
      .order('position', { ascending: true })

  let { data, error } = await run()
  if (error && isTransactionAbortedError(error.message)) {
    logMilestoneDbError('fetch (aborted — retrying once)', error)
    await sleep(350)
    ;({ data, error } = await run())
  }

  if (error) {
    logMilestoneDbError('fetch', error)
    return { rows: [], error: friendlyMilestoneError('load', error.message) }
  }
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
    description?: string
    deliverables?: string[]
    frameioUrl?: string | null
  }
): Promise<{ row: WorkspaceMilestoneUi | null; error: string | null }> {
  const priority = opts.priority ?? 'p3'
  const description = opts.description?.trim() || ''
  const deliverables = parseWorkspaceMilestoneDeliverables(opts.deliverables)
  const frameioUrl = opts.frameioUrl?.trim() || null
  const { data, error } = await supabase
    .from('milestones')
    .insert({
      job_id: opts.jobId,
      title: opts.title,
      description,
      status: 'pending',
      priority,
      position: opts.position,
      due_at: opts.scheduledAt,
      due_date: opts.scheduledAt,
      deliverables,
      frameio_url: frameioUrl,
    })
    .select(MILESTONE_SELECT)
    .single()

  if (error) {
    logMilestoneDbError('insert', error)
    return { row: null, error: friendlyMilestoneError('add', error.message) }
  }
  return { row: mapWorkspaceMilestoneToUi(data as WorkspaceMilestoneDbRow), error: null }
}

export async function setWorkspaceMilestoneStatus(
  supabase: SupabaseClient,
  milestoneId: string,
  status: WorkspaceMilestoneStatus
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('milestones').update({ status }).eq('id', milestoneId)
  if (error) {
    logMilestoneDbError('setStatus', error)
    return { error: friendlyMilestoneError('update', error.message) }
  }
  return { error: null }
}

export async function setWorkspaceMilestoneCompleted(
  supabase: SupabaseClient,
  milestoneId: string,
  completed: boolean
): Promise<{ error: string | null }> {
  return setWorkspaceMilestoneStatus(supabase, milestoneId, completed ? 'completed' : 'pending')
}

export async function setWorkspaceMilestonePriority(
  supabase: SupabaseClient,
  milestoneId: string,
  priority: WorkspaceMilestonePriority
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('milestones').update({ priority }).eq('id', milestoneId)
  if (error) {
    logMilestoneDbError('setPriority', error)
    return { error: friendlyMilestoneError('update', error.message) }
  }
  return { error: null }
}

export async function deleteWorkspaceMilestone(
  supabase: SupabaseClient,
  milestoneId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('milestones').delete().eq('id', milestoneId)
  if (error) {
    logMilestoneDbError('delete', error)
    return { error: friendlyMilestoneError('delete', error.message) }
  }
  return { error: null }
}

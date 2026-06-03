import { supabase } from '@/lib/supabase'

type JobSlotRow = {
  status?: string | null
  project_status?: string | null
  updated_at?: string | null
}

export const TERMINAL_ALERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function jobIsCompleted(
  job: { status?: string | null; project_status?: string | null } | null | undefined
): boolean {
  if (!job) return false
  if (String(job.status ?? '').toLowerCase() === 'closed') return true
  if (String(job.project_status ?? '').toLowerCase() === 'completed') return true
  return false
}

export function jobCountsAsActiveFreelancerSlot(
  job: { status?: string | null; project_status?: string | null } | null | undefined
): boolean {
  if (!job) return false
  return !jobIsCompleted(job)
}

export function jobRecentlyCompleted(
  job: JobSlotRow | null | undefined,
  now = Date.now()
): boolean {
  if (!job || !jobIsCompleted(job)) return false
  const t = new Date(String(job.updated_at ?? '')).getTime()
  return Number.isFinite(t) && now - t <= TERMINAL_ALERT_WINDOW_MS
}

export type NotificationAccessContext = {
  accessibleProjectIds: Set<string>
  activeCompanyJobIds: Set<string>
  acceptedActiveFreelancerJobIds: Set<string>
  crewMemberProjectIds: Set<string>
  recentlyCompletedProjectIds: Set<string>
  recentlyCompletedJobIds: Set<string>
}

function projectAccessibleForJob(
  jobId: string | null | undefined,
  ctx: { activeCompanyJobIds: Set<string>; acceptedActiveFreelancerJobIds: Set<string> },
  myRole: string
): boolean {
  const jid = String(jobId ?? '').trim()
  if (!jid) return true
  if (myRole === 'company') return ctx.activeCompanyJobIds.has(jid)
  if (myRole === 'freelancer') return ctx.acceptedActiveFreelancerJobIds.has(jid)
  return false
}

function jobFromEmbed(raw: unknown): JobSlotRow | null {
  if (Array.isArray(raw)) return (raw[0] as JobSlotRow) ?? null
  if (raw && typeof raw === 'object') return raw as JobSlotRow
  return null
}

/** @see crea-services/lib/notification-feed-access.ts */
export async function loadNotificationAccessContext(
  userId: string,
  myRole: string
): Promise<NotificationAccessContext> {
  const accessibleProjectIds = new Set<string>()
  const activeCompanyJobIds = new Set<string>()
  const acceptedActiveFreelancerJobIds = new Set<string>()
  const crewMemberProjectIds = new Set<string>()
  const recentlyCompletedProjectIds = new Set<string>()
  const recentlyCompletedJobIds = new Set<string>()

  if (myRole === 'company') {
    const { data: myJobs } = await supabase
      .from('jobs')
      .select('id, status, project_status, updated_at')
      .eq('company_id', userId)
      .limit(300)
    for (const j of myJobs ?? []) {
      const row = j as JobSlotRow & { id: string }
      if (jobCountsAsActiveFreelancerSlot(row)) activeCompanyJobIds.add(String(row.id))
    }
  }

  if (myRole === 'freelancer') {
    const { data: acceptedApps } = await supabase
      .from('job_applications')
      .select('job_id, jobs(status, project_status, updated_at)')
      .eq('freelancer_id', userId)
      .eq('status', 'accepted')
      .limit(300)
    for (const row of acceptedApps ?? []) {
      const jid = String((row as { job_id?: string }).job_id ?? '').trim()
      if (!jid) continue
      const job = jobFromEmbed((row as { jobs?: unknown }).jobs)
      if (!job) continue
      if (jobCountsAsActiveFreelancerSlot(job)) {
        acceptedActiveFreelancerJobIds.add(jid)
      } else if (jobRecentlyCompleted(job)) {
        recentlyCompletedJobIds.add(jid)
      }
    }
  }

  const jobCtx = { activeCompanyJobIds, acceptedActiveFreelancerJobIds }

  const { data: memberships } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('profile_id', userId)
    .limit(300)
  const memberProjectIds = [
    ...new Set(
      (memberships ?? [])
        .map((m) => String((m as { project_id?: string }).project_id ?? '').trim())
        .filter(Boolean)
    ),
  ]
  for (const pid of memberProjectIds) crewMemberProjectIds.add(pid)

  if (memberProjectIds.length > 0) {
    const { data: memberProjects } = await supabase
      .from('projects')
      .select('id, job_id, jobs(status, project_status, updated_at)')
      .in('id', memberProjectIds)
    for (const p of memberProjects ?? []) {
      const pid = String((p as { id?: string }).id ?? '').trim()
      if (!pid) continue
      const jid = String((p as { job_id?: string | null }).job_id ?? '').trim()
      const job = jobFromEmbed((p as { jobs?: unknown }).jobs)

      if (myRole === 'freelancer') {
        if (job && jobCountsAsActiveFreelancerSlot(job)) {
          accessibleProjectIds.add(pid)
        } else if (job && jobRecentlyCompleted(job)) {
          recentlyCompletedProjectIds.add(pid)
          if (jid) recentlyCompletedJobIds.add(jid)
        }
        continue
      }

      if (projectAccessibleForJob(jid || null, jobCtx, myRole)) {
        accessibleProjectIds.add(pid)
      }
    }
  }

  if (myRole === 'company') {
    const { data: ownedProjects } = await supabase
      .from('projects')
      .select('id, job_id')
      .eq('company_id', userId)
      .limit(300)
    for (const p of ownedProjects ?? []) {
      const pid = String((p as { id?: string }).id ?? '').trim()
      if (!pid) continue
      if (projectAccessibleForJob((p as { job_id?: string | null }).job_id, jobCtx, myRole)) {
        accessibleProjectIds.add(pid)
      }
    }
  }

  if (myRole === 'freelancer' && acceptedActiveFreelancerJobIds.size > 0) {
    const { data: projs } = await supabase
      .from('projects')
      .select('id, job_id')
      .in('job_id', [...acceptedActiveFreelancerJobIds])
    for (const p of projs ?? []) {
      const pid = String((p as { id?: string }).id ?? '').trim()
      if (pid) accessibleProjectIds.add(pid)
    }
  }

  if (myRole === 'freelancer' && recentlyCompletedJobIds.size > 0) {
    const { data: projs } = await supabase
      .from('projects')
      .select('id, job_id')
      .in('job_id', [...recentlyCompletedJobIds])
    for (const p of projs ?? []) {
      const pid = String((p as { id?: string }).id ?? '').trim()
      const jid = String((p as { job_id?: string | null }).job_id ?? '').trim()
      if (pid) recentlyCompletedProjectIds.add(pid)
      if (jid) recentlyCompletedJobIds.add(jid)
    }
  }

  return {
    accessibleProjectIds,
    activeCompanyJobIds,
    acceptedActiveFreelancerJobIds,
    crewMemberProjectIds,
    recentlyCompletedProjectIds,
    recentlyCompletedJobIds,
  }
}

export function filterNotificationRowByAccess<
  T extends { kind: string; projectId: string; jobId?: string; targetId?: string },
>(row: T, ctx: NotificationAccessContext, myRole: string): boolean {
  if (row.kind === 'project_completed') {
    if (row.projectId && ctx.recentlyCompletedProjectIds.has(row.projectId)) return true
    if (row.jobId && ctx.recentlyCompletedJobIds.has(row.jobId)) return true
    return false
  }

  if (row.projectId && !ctx.accessibleProjectIds.has(row.projectId)) return false

  if (row.kind === 'job_application') {
    const jid = row.jobId || row.targetId || ''
    return jid ? ctx.activeCompanyJobIds.has(jid) : false
  }

  if (row.kind === 'workspace_ready' && row.projectId) {
    return ctx.accessibleProjectIds.has(row.projectId)
  }

  if (row.jobId) {
    if (myRole === 'company') return ctx.activeCompanyJobIds.has(row.jobId)
    if (myRole === 'freelancer') {
      if (ctx.acceptedActiveFreelancerJobIds.has(row.jobId)) return true
      if (row.projectId && ctx.accessibleProjectIds.has(row.projectId)) return true
      return false
    }
  }

  return true
}

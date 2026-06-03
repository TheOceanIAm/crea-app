import { supabase } from '@/lib/supabase'

type JobSlotRow = { status?: string | null; project_status?: string | null }

function jobCountsAsActiveFreelancerSlot(
  job: { status?: string | null; project_status?: string | null } | null | undefined
): boolean {
  if (!job) return false
  if (String(job.status ?? '').toLowerCase() === 'closed') return false
  if (String(job.project_status ?? '').toLowerCase() === 'completed') return false
  return true
}

export type NotificationAccessContext = {
  accessibleProjectIds: Set<string>
  activeCompanyJobIds: Set<string>
  acceptedActiveFreelancerJobIds: Set<string>
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

/** @see crea-services/lib/notification-feed-access.ts */
export async function loadNotificationAccessContext(
  userId: string,
  myRole: string
): Promise<NotificationAccessContext> {
  const accessibleProjectIds = new Set<string>()
  const activeCompanyJobIds = new Set<string>()
  const acceptedActiveFreelancerJobIds = new Set<string>()

  if (myRole === 'company') {
    const { data: myJobs } = await supabase
      .from('jobs')
      .select('id, status, project_status')
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
      .select('job_id, jobs(status, project_status)')
      .eq('freelancer_id', userId)
      .eq('status', 'accepted')
      .limit(300)
    for (const row of acceptedApps ?? []) {
      const jid = String((row as { job_id?: string }).job_id ?? '').trim()
      if (!jid) continue
      const jobsRaw = (row as { jobs?: JobSlotRow | JobSlotRow[] | null }).jobs
      const job = Array.isArray(jobsRaw) ? jobsRaw[0] : jobsRaw
      if (!job || !jobCountsAsActiveFreelancerSlot(job)) continue
      acceptedActiveFreelancerJobIds.add(jid)
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
  if (memberProjectIds.length > 0) {
    const { data: memberProjects } = await supabase
      .from('projects')
      .select('id, job_id')
      .in('id', memberProjectIds)
    for (const p of memberProjects ?? []) {
      const pid = String((p as { id?: string }).id ?? '').trim()
      if (!pid) continue
      if (projectAccessibleForJob((p as { job_id?: string | null }).job_id, jobCtx, myRole)) {
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

  return { accessibleProjectIds, activeCompanyJobIds, acceptedActiveFreelancerJobIds }
}

export function filterNotificationRowByAccess<
  T extends { kind: string; projectId: string; jobId?: string; targetId?: string },
>(row: T, ctx: NotificationAccessContext, myRole: string): boolean {
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
    if (myRole === 'freelancer') return ctx.acceptedActiveFreelancerJobIds.has(row.jobId)
  }

  return true
}

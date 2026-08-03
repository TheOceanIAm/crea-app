import { supabase } from '@/lib/supabase'
import { listMyCrewInvites } from '@/lib/crewInvites'
import {
  filterNotificationRowByAccess,
  loadNotificationAccessContext,
} from '@/lib/notification-feed-access'
import { projectStatusDisplayLabel } from '@/lib/projectStatusDisplay'
import {
  loadWorkspaceFileAlertRows,
  loadWorkspaceReviewLinkAlertRows,
} from '@/lib/workspaceActivityAlertRows'
import { supabaseTimestampMs } from '@/lib/supabaseTimestamp'

export type NotificationKind =
  | 'invite'
  | 'crew_invite'
  | 'project_update'
  | 'project_completed'
  | 'project_message'
  | 'job_application'
  | 'invoice_incoming'
  | 'invoice_freelancer'
  | 'workspace_ready'

export type NotificationRow = {
  id: string
  kind: NotificationKind
  projectId: string
  jobId?: string
  targetId?: string
  title: string
  body: string
  at: string
}

export async function fetchAlertReadKeys(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('user_alert_reads')
    .select('alert_key')
    .eq('user_id', userId)
  if (error) {
    console.warn('[user_alert_reads]', error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => String(r.alert_key)))
}

export async function markAlertRead(userId: string, alertKey: string): Promise<void> {
  const { error } = await supabase.from('user_alert_reads').upsert(
    { user_id: userId, alert_key: alertKey, read_at: new Date().toISOString() },
    { onConflict: 'user_id,alert_key' }
  )
  if (error) console.warn('[markAlertRead]', error.message)
}

export async function countUnreadAlerts(userId: string): Promise<number> {
  const [rows, reads] = await Promise.all([loadNotificationFeed(userId), fetchAlertReadKeys(userId)])
  return rows.filter((r) => !reads.has(r.id)).length
}

/** Loads combined Alerts feed (no direct messages — those use the Messages tab). */
export async function loadNotificationFeed(userId: string): Promise<NotificationRow[]> {
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  const myRole = String(myProfile?.role ?? '').trim().toLowerCase()

  if (myRole === 'ceo') {
    return []
  }

  const accessCtx = await loadNotificationAccessContext(userId, myRole)

  const { data: memberships } = await supabase
    .from('project_members')
    .select('id, project_id, member_role, created_at')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  const projectIds = [...accessCtx.accessibleProjectIds]

  const { data: projects } = projectIds.length
    ? await supabase
        .from('projects')
        .select('id, title, updated_at, status, freelancer_id, company_id, created_at, job_id')
        .in('id', projectIds)
        .limit(200)
    : { data: [] as Array<Record<string, unknown>> }

  const projectTitle = new Map<string, string>()
  const projectJobId = new Map<string, string>()
  const projectById = new Map<string, Record<string, unknown>>()
  for (const p of projects ?? []) {
    const id = String(p.id)
    projectTitle.set(id, String(p.title || 'Project'))
    projectById.set(id, p as Record<string, unknown>)
    const jid = p.job_id != null ? String(p.job_id).trim() : ''
    if (jid) projectJobId.set(id, jid)
  }

  const leadIds = [
    ...new Set(
      (projects ?? [])
        .map((p) => p.freelancer_id)
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
    ),
  ]
  const { data: leadProfiles } = leadIds.length
    ? await supabase.from('profiles').select('id, name').in('id', leadIds)
    : { data: [] as { id: string; name: string | null }[] }
  const leadNameById = new Map<string, string>()
  for (const lp of leadProfiles ?? []) {
    const n = String(lp.name ?? '').trim()
    leadNameById.set(String(lp.id), n || 'Project lead')
  }

  const inviteRows: NotificationRow[] = (memberships ?? [])
    .filter((m) => String(m.member_role) === 'crew')
    .map((m) => {
      const pid = String(m.project_id)
      const t = projectTitle.get(pid) ?? 'Project'
      const proj = projectById.get(pid)
      const jobId = projectJobId.get(pid)
      const hasPublicJob = Boolean(jobId)
      const leadId = typeof proj?.freelancer_id === 'string' ? String(proj.freelancer_id) : ''
      const leadName = leadId ? (leadNameById.get(leadId) ?? 'Project lead') : 'Project lead'
      const body = hasPublicJob
        ? `You were added to «${t}».`
        : `${leadName} added you to the private project «${t}».`
      return {
        id: `invite-${String(m.id)}`,
        kind: 'invite' as const,
        projectId: pid,
        jobId,
        title: t,
        body,
        at: String(m.created_at),
      }
    })

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const sevenDaysAgoIso = new Date(sevenDaysAgo).toISOString()

  const jobIdToProjectId = new Map<string, string>()
  for (const p of projects ?? []) {
    const pid = String(p.id)
    const jid = p.job_id != null ? String(p.job_id).trim() : ''
    if (jid) jobIdToProjectId.set(jid, pid)
  }

  const accessibleJobIds = [
    ...new Set([
      ...projectJobId.values(),
      ...accessCtx.activeCompanyJobIds,
      ...accessCtx.recentlyCompletedJobIds,
    ]),
  ].filter(Boolean)

  const { data: recentJobs } = accessibleJobIds.length
    ? await supabase
        .from('jobs')
        .select('id, title, project_status, updated_at')
        .in('id', accessibleJobIds)
        .gte('updated_at', sevenDaysAgoIso)
        .order('updated_at', { ascending: false })
        .limit(60)
    : { data: [] as Array<{ id: string; title: string | null; project_status: string | null; updated_at: string }> }

  const statusChangeRows: NotificationRow[] = (recentJobs ?? [])
    .filter((j) => String(j.project_status ?? '').toLowerCase() !== 'completed')
    .map((j) => {
      const jid = String(j.id)
      const pid = jobIdToProjectId.get(jid) ?? jid
      const label = projectStatusDisplayLabel(j.project_status)
      return {
        id: `job-status-${jid}-${j.updated_at}`,
        kind: 'project_update' as const,
        projectId: pid,
        jobId: jid,
        title: String(j.title || projectTitle.get(pid) || 'Project'),
        body: `Project status changed to ${label}.`,
        at: String(j.updated_at),
      }
    })

  const { data: nativeMilestones } = projectIds.length
    ? await supabase
        .from('project_milestones')
        .select('id, project_id, title, completed, created_at')
        .in('project_id', projectIds)
        .gte('created_at', sevenDaysAgoIso)
        .order('created_at', { ascending: false })
        .limit(60)
    : { data: [] as Array<{ id: string; project_id: string; title: string; completed: boolean; created_at: string }> }

  const nativeMilestoneRows: NotificationRow[] = (nativeMilestones ?? []).map((m) => {
    const pid = String(m.project_id)
    const title = String(m.title || 'Milestone').trim() || 'Milestone'
    const completed = Boolean(m.completed)
    return {
      id: `milestone-native-${m.id}-${completed ? 'done' : 'new'}`,
      kind: 'project_update' as const,
      projectId: pid,
      jobId: projectJobId.get(pid),
      title: projectTitle.get(pid) ?? 'Project',
      body: completed ? `Milestone completed: ${title}` : `Milestone added: ${title}`,
      at: String(m.created_at),
    }
  })

  let jobMilestoneRows: NotificationRow[] = []
  const jobIdsForMilestones = [...new Set(projectJobId.values())]
  if (jobIdsForMilestones.length > 0) {
    const { data: jobMilestones, error: jobMsErr } = await supabase
      .from('milestones')
      .select('id, job_id, title, status, created_at')
      .in('job_id', jobIdsForMilestones)
      .gte('created_at', sevenDaysAgoIso)
      .order('created_at', { ascending: false })
      .limit(60)
    if (!jobMsErr) {
      jobMilestoneRows = (jobMilestones ?? []).map((m) => {
        const jid = String(m.job_id)
        const pid = jobIdToProjectId.get(jid) ?? jid
        const title = String(m.title || 'Milestone').trim() || 'Milestone'
        const completed = String(m.status ?? '').toLowerCase() === 'completed'
        return {
          id: `milestone-job-${m.id}-${completed ? 'done' : 'new'}`,
          kind: 'project_update' as const,
          projectId: pid,
          jobId: jid,
          title: projectTitle.get(pid) ?? 'Project',
          body: completed ? `Milestone completed: ${title}` : `Milestone added: ${title}`,
          at: String(m.created_at),
        }
      })
    }
  }

  const milestoneRows = [...nativeMilestoneRows, ...jobMilestoneRows]

  const activityCtx = {
    supabase,
    userId,
    projectIds,
    projectTitle,
    projectJobId,
    jobIdToProjectId,
    accessibleJobIds,
    sevenDaysAgoIso,
  }
  const [fileRows, reviewLinkRows] = await Promise.all([
    loadWorkspaceFileAlertRows(activityCtx),
    loadWorkspaceReviewLinkAlertRows(activityCtx),
  ])

  const { data: projectMessages } = projectIds.length
    ? await supabase
        .from('project_messages')
        .select('id, project_id, sender_id, body, created_at')
        .in('project_id', projectIds)
        .neq('sender_id', userId)
        .order('created_at', { ascending: false })
        .limit(80)
    : { data: [] as Array<{ id: string; project_id: string; sender_id: string; body: string | null; created_at: string }> }

  const messageRows: NotificationRow[] = (projectMessages ?? []).map((m) => {
    const pid = String(m.project_id)
    return {
      id: `project-msg-${m.id}`,
      kind: 'project_message' as const,
      projectId: pid,
      jobId: projectJobId.get(pid),
      title: projectTitle.get(pid) ?? 'Project',
      body: 'New message.',
      at: String(m.created_at),
    }
  })

  let companyRows: NotificationRow[] = []
  if (myRole === 'company') {
    const activeJobIdList = [...accessCtx.activeCompanyJobIds]
    const { data: myJobs } =
      activeJobIdList.length > 0
        ? await supabase.from('jobs').select('id, title').in('id', activeJobIdList).limit(200)
        : { data: [] as { id: string; title: string | null }[] }
    const jobIds = activeJobIdList
    const jobTitle = new Map<string, string>()
    for (const j of myJobs ?? []) jobTitle.set(String(j.id), String(j.title || 'Project'))

    const { data: apps } = jobIds.length
      ? await supabase
          .from('job_applications')
          .select('id, job_id, status, created_at')
          .in('job_id', jobIds)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(60)
      : { data: [] as Array<{ id: string; job_id: string; created_at: string }> }

    const applicationRows: NotificationRow[] = (apps ?? []).map((a) => ({
      id: `job-app-${a.id}`,
      kind: 'job_application' as const,
      projectId: '',
      jobId: String(a.job_id),
      targetId: String(a.job_id),
      title: jobTitle.get(String(a.job_id)) ?? 'Project',
      body: 'New freelancer application received for your project.',
      at: String(a.created_at),
    }))

    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, title, invoice_number, created_at, status')
      .eq('company_id', userId)
      .in('status', ['pending', 'overdue'])
      .order('created_at', { ascending: false })
      .limit(60)

    const invoiceRows: NotificationRow[] = (invoices ?? []).map((inv) => ({
      id: `invoice-${inv.id}`,
      kind: 'invoice_incoming' as const,
      projectId: '',
      targetId: String(inv.id),
      title: String(inv.title || inv.invoice_number || 'Invoice'),
      body: 'Invoice awaiting payment.',
      at: String(inv.created_at ?? new Date().toISOString()),
    }))

    companyRows = [...applicationRows, ...invoiceRows]
  }

  let freelancerRows: NotificationRow[] = []
  if (myRole === 'freelancer') {
    const { data: finv } = await supabase
      .from('invoices')
      .select('id, title, invoice_number, status, created_at, updated_at')
      .eq('freelancer_id', userId)
      .order('updated_at', { ascending: false })
      .limit(80)

    const invoiceFreelancerRows: NotificationRow[] = (finv ?? [])
      .filter((inv) => {
        const st = String(inv.status ?? '').toLowerCase()
        return st === 'paid' || st === 'pending' || st === 'overdue'
      })
      .map((inv) => {
        const st = String(inv.status ?? '').toLowerCase()
        const paid = st === 'paid'
        return {
          id: `invoice-fl-${inv.id}-${paid ? 'paid' : 'open'}`,
          kind: 'invoice_freelancer' as const,
          projectId: '',
          targetId: String(inv.id),
          title: String(inv.title || inv.invoice_number || 'Invoice'),
          body: paid ? 'Invoice was paid.' : 'Invoice update or payment pending.',
          at: String(inv.updated_at ?? inv.created_at ?? new Date().toISOString()),
        }
      })

    const { data: crewProjects } =
      accessCtx.accessibleProjectIds.size > 0
        ? await supabase
            .from('projects')
            .select('id, title, freelancer_id, created_at, job_id')
            .in('id', [...accessCtx.accessibleProjectIds])
            .not('job_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(40)
        : { data: [] as Array<{ id: string; title: string | null; job_id: string | null; created_at: string | null }> }

    const workspaceRows: NotificationRow[] = (crewProjects ?? [])
      .filter((p) => p.job_id)
      .filter((p) => {
        const created = supabaseTimestampMs(p.created_at)
        return created > 0 && created >= sevenDaysAgo
      })
      .map((p) => ({
        id: `workspace-${p.id}`,
        kind: 'workspace_ready' as const,
        projectId: String(p.id),
        jobId: String(p.job_id),
        title: String(p.title || 'Project'),
        body: 'Your project workspace is available.',
        at: String(p.created_at ?? new Date().toISOString()),
      }))

    freelancerRows = [...invoiceFreelancerRows, ...workspaceRows]
  }

  let completedRows: NotificationRow[] = []
  if (myRole === 'freelancer' && accessCtx.recentlyCompletedJobIds.size > 0) {
    const completedJobIds = [...accessCtx.recentlyCompletedJobIds]
    const { data: completedJobs } = await supabase
      .from('jobs')
      .select('id, title, updated_at, project_status, status')
      .in('id', completedJobIds)
    const jobMeta = new Map<string, { title: string; updated_at: string }>()
    for (const j of completedJobs ?? []) {
      const jid = String((j as { id?: string }).id ?? '').trim()
      if (!jid) continue
      jobMeta.set(jid, {
        title: String((j as { title?: string | null }).title ?? 'Project'),
        updated_at: String((j as { updated_at?: string | null }).updated_at ?? ''),
      })
    }
    const { data: completedProjs } = await supabase
      .from('projects')
      .select('id, title, job_id, updated_at')
      .in('job_id', completedJobIds)
    completedRows = (completedProjs ?? [])
      .filter((p) => accessCtx.recentlyCompletedProjectIds.has(String(p.id)))
      .map((p) => {
        const pid = String(p.id)
        const jid = String(p.job_id ?? '').trim()
        const meta = jid ? jobMeta.get(jid) : undefined
        const at = meta?.updated_at || String(p.updated_at ?? '')
        return {
          id: `project-completed-${pid}-${at}`,
          kind: 'project_completed' as const,
          projectId: pid,
          jobId: jid || undefined,
          title: String(p.title || meta?.title || 'Project'),
          body: 'Project marked as completed.',
          at: at || new Date().toISOString(),
        }
      })
  }

  // Pending crew invitations addressed to this user. These reference a project
  // the user cannot access yet, so they bypass the access filter (see
  // filterNotificationRowByAccess) and carry the invite id in `targetId`.
  const myInvites = await listMyCrewInvites()
  const crewInviteRows: NotificationRow[] = myInvites.map((inv) => ({
    id: `crew-invite-${inv.id}`,
    kind: 'crew_invite' as const,
    projectId: inv.projectId,
    targetId: inv.id,
    title: inv.projectTitle,
    body: `${inv.companyName} invited you to join «${inv.projectTitle}». Accept to get workspace access.`,
    at: inv.invitedAt,
  }))

  return [
    ...crewInviteRows,
    ...inviteRows,
    ...messageRows,
    ...milestoneRows,
    ...fileRows,
    ...reviewLinkRows,
    ...statusChangeRows,
    ...completedRows,
    ...companyRows,
    ...freelancerRows,
  ]
    .filter((row) => filterNotificationRowByAccess(row, accessCtx, myRole))
    .sort((a, b) => supabaseTimestampMs(b.at) - supabaseTimestampMs(a.at))
    .slice(0, 100)
}

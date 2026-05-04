import { supabase } from '@/lib/supabase'

export type NotificationKind =
  | 'invite'
  | 'project_update'
  | 'project_message'
  | 'job_application'
  | 'invoice_incoming'
  | 'invoice_freelancer'
  | 'workspace_ready'

export type NotificationRow = {
  id: string
  kind: NotificationKind
  projectId: string
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

  // CEO: project/invoice/application alerts are disabled; DMs use Messages only.
  if (myRole === 'ceo') {
    return []
  }

  const { data: memberships } = await supabase
    .from('project_members')
    .select('id, project_id, member_role, created_at')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  const projectIds = [...new Set((memberships ?? []).map((m) => String(m.project_id)))]

  const { data: projects } = projectIds.length
    ? await supabase
        .from('projects')
        .select('id, title, updated_at, status, freelancer_id, company_id, created_at, job_id')
        .in('id', projectIds)
        .limit(200)
    : { data: [] as Array<Record<string, unknown>> }

  const projectTitle = new Map<string, string>()
  const projectById = new Map<string, Record<string, unknown>>()
  for (const p of projects ?? []) {
    const id = String(p.id)
    projectTitle.set(id, String(p.title || 'Project'))
    projectById.set(id, p as Record<string, unknown>)
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
      const jobId = proj?.job_id
      const hasPublicJob = jobId != null && String(jobId).length > 0
      const leadId =
        typeof proj?.freelancer_id === 'string' ? String(proj.freelancer_id) : ''
      const leadName = leadId ? leadNameById.get(leadId) ?? 'Project lead' : 'Project lead'
      const body = hasPublicJob
        ? `You were added to «${t}».`
        : `${leadName} added you to the private project «${t}».`
      return {
        id: `invite-${String(m.id)}`,
        kind: 'invite' as const,
        projectId: pid,
        title: t,
        body,
        at: String(m.created_at),
      }
    })

  const updateRows: NotificationRow[] = (projects ?? [])
    .filter((p) => Boolean(p.updated_at))
    .map((p) => ({
      id: `project-update-${p.id}-${p.updated_at}`,
      kind: 'project_update' as const,
      projectId: String(p.id),
      title: String(p.title || 'Project'),
      body: `Project updated${p.status ? ` · ${String(p.status)}` : ''}.`,
      at: String(p.updated_at),
    }))

  const { data: projectMessages } = projectIds.length
    ? await supabase
        .from('project_messages')
        .select('id, project_id, sender_id, body, created_at')
        .in('project_id', projectIds)
        .neq('sender_id', userId)
        .order('created_at', { ascending: false })
        .limit(80)
    : { data: [] as Array<{ id: string; project_id: string; sender_id: string; body: string | null; created_at: string }> }

  const messageRows: NotificationRow[] = (projectMessages ?? []).map((m) => ({
    id: `project-msg-${m.id}`,
    kind: 'project_message' as const,
    projectId: String(m.project_id),
    title: projectTitle.get(String(m.project_id)) ?? 'Project',
    body: 'New message in project chat.',
    at: String(m.created_at),
  }))

  let companyRows: NotificationRow[] = []
  if (myRole === 'company') {
    const { data: myJobs } = await supabase.from('jobs').select('id, title').eq('company_id', userId).limit(200)
    const jobIds = [...new Set((myJobs ?? []).map((j) => String(j.id)))]
    const jobTitle = new Map<string, string>()
    for (const j of myJobs ?? []) jobTitle.set(String(j.id), String(j.title || 'Project'))

    const { data: apps } = jobIds.length
      ? await supabase
          .from('job_applications')
          .select('id, job_id, created_at')
          .in('job_id', jobIds)
          .order('created_at', { ascending: false })
          .limit(60)
      : { data: [] as Array<{ id: string; job_id: string; created_at: string }> }

    const applicationRows: NotificationRow[] = (apps ?? []).map((a) => ({
      id: `job-app-${a.id}`,
      kind: 'job_application' as const,
      projectId: '',
      targetId: String(a.job_id),
      title: jobTitle.get(String(a.job_id)) ?? 'Project',
      body: 'New freelancer application received for your project.',
      at: String(a.created_at),
    }))

    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, title, invoice_number, created_at')
      .eq('company_id', userId)
      .order('created_at', { ascending: false })
      .limit(60)

    const invoiceRows: NotificationRow[] = (invoices ?? []).map((inv) => ({
      id: `invoice-${inv.id}`,
      kind: 'invoice_incoming' as const,
      projectId: '',
      targetId: String(inv.id),
      title: String(inv.title || inv.invoice_number || 'Invoice'),
      body: 'Incoming invoice received.',
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
      .order('created_at', { ascending: false })
      .limit(80)

    const invoiceFreelancerRows: NotificationRow[] = (finv ?? []).map((inv) => {
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

    const { data: crewProjects } = await supabase
      .from('projects')
      .select('id, title, freelancer_id, created_at, job_id')
      .eq('freelancer_id', userId)
      .order('created_at', { ascending: false })
      .limit(40)

    const workspaceRows: NotificationRow[] = (crewProjects ?? [])
      .filter((p) => p.job_id)
      .map((p) => ({
        id: `workspace-${p.id}`,
        kind: 'workspace_ready' as const,
        projectId: String(p.id),
        title: String(p.title || 'Project'),
        body: 'Your project workspace is available.',
        at: String(p.created_at ?? new Date().toISOString()),
      }))

    freelancerRows = [...invoiceFreelancerRows, ...workspaceRows]
  }

  const next = [
    ...inviteRows,
    ...messageRows,
    ...updateRows,
    ...companyRows,
    ...freelancerRows,
  ]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 100)

  return next
}

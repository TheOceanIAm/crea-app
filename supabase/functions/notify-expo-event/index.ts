/**
 * Consolidated Expo push for non-DM events (DMs use notify-message-push).
 * Requires authenticated caller; verifies the caller caused or owns the event before notifying recipients.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type NotifSettings = {
  pushEnabled?: boolean
  pushNewApplication?: boolean
  pushInvoiceReceived?: boolean
  pushInvoicePaid?: boolean
  /** Freelancer; default-on when omitted. */
  pushInvoiceReceiptConfirmed?: boolean
  pushProjectChat?: boolean
  pushJobMatch?: boolean
  expoPushToken?: string | null
}

function parseNotif(raw: unknown): NotifSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  /** Treat missing pushEnabled as true so rows with only a stored Expo token still receive pushes. */
  return {
    ...(o as NotifSettings),
    pushEnabled: o.pushEnabled !== false,
  }
}

async function workspaceRecipientIds(
  admin: ReturnType<typeof createClient>,
  opts: { projectId?: string; jobId?: string; excludeUserId: string },
): Promise<{ recipientIds: string[]; projectTitle: string; projectId: string | null; jobId: string | null }> {
  const ids = new Set<string>()
  let projectId = opts.projectId?.trim() || null
  let jobId = opts.jobId?.trim() || null
  let title = 'Project'

  if (jobId && !projectId) {
    const { data: proj } = await admin
      .from('projects')
      .select('id, title, company_id, freelancer_id')
      .eq('job_id', jobId)
      .maybeSingle()
    if (proj) {
      projectId = String(proj.id)
      title = String(proj.title ?? title).trim() || title
      if (proj.company_id) ids.add(String(proj.company_id))
      if (proj.freelancer_id) ids.add(String(proj.freelancer_id))
    } else {
      const { data: job } = await admin.from('jobs').select('company_id, title').eq('id', jobId).maybeSingle()
      if (job) {
        title = String(job.title ?? title).trim() || title
        if (job.company_id) ids.add(String(job.company_id))
      }
    }
    const { data: apps } = await admin
      .from('job_applications')
      .select('freelancer_id')
      .eq('job_id', jobId)
      .eq('status', 'accepted')
    for (const a of apps ?? []) {
      if (a.freelancer_id) ids.add(String(a.freelancer_id))
    }
  }

  if (projectId) {
    const { data: proj } = await admin
      .from('projects')
      .select('title, company_id, freelancer_id, job_id')
      .eq('id', projectId)
      .maybeSingle()
    if (proj) {
      title = String(proj.title ?? title).trim() || title
      if (proj.company_id) ids.add(String(proj.company_id))
      if (proj.freelancer_id) ids.add(String(proj.freelancer_id))
      if (proj.job_id) jobId = String(proj.job_id)
    }
    const { data: members } = await admin.from('project_members').select('profile_id').eq('project_id', projectId)
    for (const m of members ?? []) {
      if (m.profile_id) ids.add(String(m.profile_id))
    }
    if (jobId) {
      const { data: apps } = await admin
        .from('job_applications')
        .select('freelancer_id')
        .eq('job_id', jobId)
        .eq('status', 'accepted')
      for (const a of apps ?? []) {
        if (a.freelancer_id) ids.add(String(a.freelancer_id))
      }
    }
  }

  ids.delete(opts.excludeUserId)
  return { recipientIds: [...ids], projectTitle: title, projectId, jobId }
}

async function sendExpoPush(opts: {
  recipientId: string
  admin: ReturnType<typeof createClient>
  title: string
  body: string
  data: Record<string, unknown>
  allow: (s: NotifSettings) => boolean
}): Promise<{ ok: boolean; skipped?: string }> {
  const { recipientId, admin, title, body, data, allow } = opts
  const expoTokenEnv = Deno.env.get('EXPO_ACCESS_TOKEN') ?? ''

  const { data: profile } = await admin.from('profiles').select('notification_settings').eq('id', recipientId).maybeSingle()
  const settings = parseNotif(profile?.notification_settings)
  const rawTok = typeof settings.expoPushToken === 'string' ? settings.expoPushToken.trim() : ''
  const pushToken =
    rawTok.length > 0 &&
    (rawTok.includes('ExponentPushToken') || rawTok.includes('ExpoPushToken'))
      ? rawTok
      : null

  if (!settings.pushEnabled || !allow(settings) || !pushToken) {
    return { ok: true, skipped: 'push_disabled_or_no_token' }
  }

  const pushHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (expoTokenEnv) pushHeaders.Authorization = `Bearer ${expoTokenEnv}`

  const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: pushHeaders,
    body: JSON.stringify({
      to: pushToken,
      title,
      body: body || 'Crea',
      sound: 'default',
      priority: 'high',
      data,
    }),
  })
  const pushJson = (await pushRes.json().catch(() => ({}))) as { errors?: unknown[] }
  if (!pushRes.ok) {
    return { ok: false, skipped: JSON.stringify(pushJson) }
  }
  return { ok: true }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: uerr,
  } = await userClient.auth.getUser()
  if (uerr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
  const admin = createClient(supabaseUrl, serviceKey)

  if (kind === 'job_application') {
    const applicationId = typeof body.applicationId === 'string' ? body.applicationId.trim() : ''
    if (!applicationId) {
      return new Response(JSON.stringify({ error: 'applicationId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: app } = await admin.from('job_applications').select('job_id, freelancer_id').eq('id', applicationId).maybeSingle()
    if (!app || app.freelancer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: job } = await admin.from('jobs').select('company_id, title').eq('id', app.job_id).maybeSingle()
    if (!job?.company_id) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: fp } = await admin.from('profiles').select('name').eq('id', user.id).maybeSingle()
    const applicantName = String(fp?.name ?? 'Freelancer').trim() || 'Freelancer'
    const title = String(job.title ?? 'Project').trim() || 'Project'
    const res = await sendExpoPush({
      recipientId: job.company_id as string,
      admin,
      title: 'New application',
      body: `${applicantName} applied to «${title}».`,
      data: { type: 'job_application', jobId: String(app.job_id), applicationId },
      allow: (s) => Boolean(s.pushNewApplication),
    })
    return new Response(JSON.stringify(res), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (kind === 'invoice') {
    const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId.trim() : ''
    const event = typeof body.event === 'string' ? body.event.trim() : ''
    const invoiceEventsOk = ['received', 'paid', 'receipt_confirmed'] as const
    if (
      !invoiceId ||
      !invoiceEventsOk.includes(event as (typeof invoiceEventsOk)[number])
    ) {
      return new Response(
        JSON.stringify({ error: 'invoiceId and event (received|paid|receipt_confirmed) required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    const { data: inv } = await admin
      .from('invoices')
      .select('company_id, freelancer_id, title, invoice_number')
      .eq('id', invoiceId)
      .maybeSingle()
    if (!inv) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (event === 'received') {
      if (inv.freelancer_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const res = await sendExpoPush({
        recipientId: inv.company_id as string,
        admin,
        title: 'Incoming invoice',
        body: String(inv.title || inv.invoice_number || 'New invoice'),
        data: { type: 'invoice', invoiceId, event: 'received' },
        allow: (s) => Boolean(s.pushInvoiceReceived),
      })
      return new Response(JSON.stringify(res), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    /** Company confirms on-platform receipt (sets `received_at`); freelancer gets transparency before payment. */
    if (event === 'receipt_confirmed') {
      if (inv.company_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const label = String(inv.invoice_number ?? inv.title ?? 'Invoice').trim() || 'Invoice'
      const res = await sendExpoPush({
        recipientId: inv.freelancer_id as string,
        admin,
        title: 'Invoice receipt confirmed',
        body: `${label} — your client confirmed receipt on CREA.`,
        data: { type: 'invoice', invoiceId, event: 'receipt_confirmed' },
        allow: (s) => s.pushInvoiceReceiptConfirmed !== false,
      })
      return new Response(JSON.stringify(res), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    /** paid → notify freelancer */
    if (inv.company_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const res = await sendExpoPush({
      recipientId: inv.freelancer_id as string,
      admin,
      title: 'Invoice paid',
      body: String(inv.title || inv.invoice_number || 'Payment received'),
      data: { type: 'invoice', invoiceId, event: 'paid' },
      allow: (s) => Boolean(s.pushInvoicePaid),
    })
    return new Response(JSON.stringify(res), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (kind === 'project_message') {
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : ''
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: msg } = await admin
      .from('project_messages')
      .select('project_id, sender_id, body')
      .eq('id', messageId)
      .maybeSingle()
    if (!msg || msg.sender_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const projectId = String(msg.project_id)
    const { recipientIds, projectTitle: pt, jobId } = await workspaceRecipientIds(admin, {
      projectId,
      excludeUserId: user.id,
    })
    const preview =
      typeof msg.body === 'string' && msg.body.trim()
        ? msg.body.trim().length > 120
          ? `${msg.body.trim().slice(0, 117)}…`
          : msg.body.trim()
        : 'New project message'
    const results: unknown[] = []
    for (const rid of recipientIds) {
      const r = await sendExpoPush({
        recipientId: rid,
        admin,
        title: pt,
        body: preview,
        data: { type: 'project_message', projectId, messageId, jobId: jobId ?? undefined },
        allow: (s) => Boolean(s.pushProjectChat ?? true),
      })
      results.push(r)
    }
    return new Response(JSON.stringify({ ok: true, notified: recipientIds.length, results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (kind === 'job_message') {
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : ''
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: msg } = await admin
      .from('job_messages')
      .select('job_id, sender_id, content')
      .eq('id', messageId)
      .maybeSingle()
    if (!msg || msg.sender_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const jobId = String(msg.job_id)
    const { recipientIds, projectTitle: pt, projectId } = await workspaceRecipientIds(admin, {
      jobId,
      excludeUserId: user.id,
    })
    const preview =
      typeof msg.content === 'string' && msg.content.trim()
        ? msg.content.trim().length > 120
          ? `${msg.content.trim().slice(0, 117)}…`
          : msg.content.trim()
        : 'New workspace message'
    const results: unknown[] = []
    for (const rid of recipientIds) {
      const r = await sendExpoPush({
        recipientId: rid,
        admin,
        title: pt,
        body: preview,
        data: { type: 'project_message', projectId: projectId ?? undefined, jobId, messageId },
        allow: (s) => Boolean(s.pushProjectChat ?? true),
      })
      results.push(r)
    }
    return new Response(JSON.stringify({ ok: true, notified: recipientIds.length, results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (kind === 'workspace_activity') {
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : ''
    const activity = typeof body.activity === 'string' ? body.activity.trim() : 'update'
    const detail = typeof body.detail === 'string' ? body.detail.trim() : ''
    if (!projectId && !jobId) {
      return new Response(JSON.stringify({ error: 'projectId or jobId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { recipientIds: allMembers, projectTitle: pt, projectId: resolvedProjectId, jobId: resolvedJobId } =
      await workspaceRecipientIds(admin, {
        projectId: projectId || undefined,
        jobId: jobId || undefined,
        excludeUserId: '',
      })
    if (!allMembers.includes(user.id)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const recipientIds = allMembers.filter((id) => id !== user.id)
    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, notified: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const activityLabels: Record<string, string> = {
      milestone: 'New milestone',
      file: 'New file in workspace',
      report: 'Production report posted',
      completed: 'Project completed',
    }
    const pushTitle = activityLabels[activity] ?? 'Workspace update'
    const pushBody = detail || `«${pt}» was updated`
    const results: unknown[] = []
    for (const rid of recipientIds) {
      const r = await sendExpoPush({
        recipientId: rid,
        admin,
        title: pushTitle,
        body: pushBody.length > 120 ? `${pushBody.slice(0, 117)}…` : pushBody,
        data: {
          type: 'workspace_activity',
          activity,
          projectId: resolvedProjectId ?? undefined,
          jobId: resolvedJobId ?? undefined,
        },
        allow: (s) => Boolean(s.pushProjectChat ?? true),
      })
      results.push(r)
    }
    return new Response(JSON.stringify({ ok: true, notified: recipientIds.length, results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (kind === 'project_crew_invite') {
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    const crewProfileId = typeof body.crewProfileId === 'string' ? body.crewProfileId.trim() : ''
    if (!projectId || !crewProfileId) {
      return new Response(JSON.stringify({ error: 'projectId and crewProfileId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: proj } = await admin
      .from('projects')
      .select('company_id, freelancer_id, title, job_id')
      .eq('id', projectId)
      .maybeSingle()
    if (!proj) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (proj.company_id !== user.id && proj.freelancer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // Crew adds now create a PENDING invite (project_crew_invites). Accept either
    // a pending invite or an already-active membership (back-compat / direct adds).
    let hasInvite = false
    const { data: inviteRow } = await admin
      .from('project_crew_invites')
      .select('id')
      .eq('project_id', projectId)
      .eq('profile_id', crewProfileId)
      .eq('status', 'pending')
      .maybeSingle()
    if (inviteRow) {
      hasInvite = true
    } else {
      const { data: mem } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('profile_id', crewProfileId)
        .eq('member_role', 'crew')
        .maybeSingle()
      if (!mem) {
        return new Response(JSON.stringify({ error: 'Crew invite not found' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }
    const titleStr = String(proj.title ?? 'Project').trim() || 'Project'
    const bodyStr = hasInvite
      ? `You've been invited to join «${titleStr}». Open Alerts to accept.`
      : `You were added to «${titleStr}».`
    const res = await sendExpoPush({
      recipientId: crewProfileId,
      admin,
      title: hasInvite ? 'Project invitation' : 'Project crew',
      body: bodyStr,
      data: { type: 'project_crew_invite', projectId },
      allow: (s) => Boolean(s.pushProjectChat ?? true),
    })
    return new Response(JSON.stringify(res), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (kind === 'workspace_ready') {
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    if (!projectId) {
      return new Response(JSON.stringify({ error: 'projectId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: proj } = await admin
      .from('projects')
      .select('company_id, freelancer_id, title')
      .eq('id', projectId)
      .maybeSingle()
    if (!proj || proj.company_id !== user.id || !proj.freelancer_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const title = String(proj.title ?? 'Project').trim() || 'Project'
    const res = await sendExpoPush({
      recipientId: proj.freelancer_id as string,
      admin,
      title: 'Workspace ready',
      body: `«${title}» — your workspace is unlocked.`,
      data: { type: 'workspace_ready', projectId },
      allow: (s) => Boolean(s.pushJobMatch ?? true),
    })
    return new Response(JSON.stringify(res), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Unknown kind' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

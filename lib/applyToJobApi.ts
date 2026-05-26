import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

export type JobApplicationStatus = 'none' | 'pending' | 'accepted' | 'declined'

const APPLY_FETCH_TIMEOUT_MS = 12_000

const RPC_APPLY_ERRORS = new Set([
  'already_applied',
  'job_not_found',
  'cannot_apply_to_own_job',
  'job_not_active',
  'authentication required',
  'freelancer_profile_required',
  'pro_plan_required',
])

function webBases(): string[] {
  const base = getCreaWebBaseUrl()
  if (!base) return []
  const candidates = [base]
  if (base === 'https://www.creaservices.de') candidates.push('https://creaservices.de')
  if (base === 'https://creaservices.de') candidates.push('https://www.creaservices.de')
  return candidates
}

async function authHeaders(): Promise<{ headers: Record<string, string>; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { headers: {}, error: 'no_session' }
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }
}

function normalizeApplicationStatus(raw: unknown): JobApplicationStatus {
  if (raw === 'pending' || raw === 'accepted' || raw === 'declined') return raw
  return 'none'
}

function parseApplyErrorMessage(error: {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
}): string {
  const blob = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase()
  if (blob.includes('already_applied')) return 'already_applied'
  if (blob.includes('job_not_found')) return 'job_not_found'
  if (blob.includes('cannot_apply_to_own_job')) return 'cannot_apply_to_own_job'
  if (blob.includes('job_not_active')) return 'job_not_active'
  if (blob.includes('authentication required')) return 'no_session'
  if (blob.includes('freelancer_profile_required')) return 'freelancer_profile_required'
  if (blob.includes('pro_plan_required')) return 'pro_plan_required'
  if (blob.includes('beta_trial_ended')) return 'beta_trial_ended_new_job_work_not_allowed'
  if (error.code === '42883' || blob.includes('does not exist')) return 'rpc_unavailable'
  return error.message?.trim() || 'apply_failed'
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APPLY_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Read application + workspace access via Supabase (RLS), not the web API — reliable in dev/offline web. */
export async function fetchJobApplicationStatus(jobId: string): Promise<{
  applied: boolean
  status: JobApplicationStatus
  applicationId: string | null
  applicantCount: number
  projectId: string | null
  hasWorkspaceAccess: boolean
  error?: string
}> {
  const empty = {
    applied: false,
    status: 'none' as const,
    applicationId: null,
    applicantCount: 0,
    projectId: null,
    hasWorkspaceAccess: false,
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ...empty, error: 'no_session' }

  const [{ data: app }, { data: proj }, { count: applicantCount }] = await Promise.all([
    supabase
      .from('job_applications')
      .select('id, status')
      .eq('job_id', jobId)
      .eq('freelancer_id', user.id)
      .maybeSingle(),
    supabase.from('projects').select('id').eq('job_id', jobId).maybeSingle(),
    supabase.from('job_applications').select('id', { count: 'exact', head: true }).eq('job_id', jobId),
  ])

  let projectId = typeof proj?.id === 'string' ? proj.id : null
  if (!projectId) {
    const { data: projById } = await supabase.from('projects').select('id').eq('id', jobId).maybeSingle()
    projectId = typeof projById?.id === 'string' ? projById.id : null
  }

  let hasWorkspaceAccess = false
  if (projectId) {
    const { data: inProject, error: rpcErr } = await supabase.rpc('user_in_project', {
      p_project_id: projectId,
      p_user: user.id,
    })
    hasWorkspaceAccess = !rpcErr && Boolean(inProject)
  }

  const status = normalizeApplicationStatus(app?.status)
  const applied = status !== 'none'

  return {
    applied,
    status,
    applicationId: typeof app?.id === 'string' ? app.id : null,
    applicantCount: applicantCount ?? 0,
    projectId,
    hasWorkspaceAccess,
  }
}

async function applyToJobViaSupabaseRpc(
  jobId: string,
  appliedRole?: string | null
): Promise<{
  ok: boolean
  applicationId?: string
  error?: string
  alreadyApplied?: boolean
  fallback?: boolean
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'no_session' }

  const roleParam = appliedRole && String(appliedRole).trim() ? String(appliedRole).trim() : null
  const { data, error } = await supabase.rpc('freelancer_apply_to_job', {
    p_job_id: jobId,
    p_applied_role: roleParam,
  })

  if (!error) {
    const applicationId = typeof data === 'string' ? data : data != null ? String(data) : undefined
    return { ok: true, applicationId }
  }

  const code = parseApplyErrorMessage(error)
  if (code === 'already_applied') {
    const { data: existing } = await supabase
      .from('job_applications')
      .select('id')
      .eq('job_id', jobId)
      .eq('freelancer_id', user.id)
      .maybeSingle()
    return {
      ok: true,
      alreadyApplied: true,
      applicationId: typeof existing?.id === 'string' ? existing.id : undefined,
    }
  }

  if (RPC_APPLY_ERRORS.has(code)) {
    return { ok: false, error: code }
  }

  return { ok: false, error: code, fallback: true }
}

async function applyToJobViaWebApiInternal(
  jobId: string,
  appliedRole?: string | null
): Promise<{
  ok: boolean
  applicationId?: string
  error?: string
  alreadyApplied?: boolean
}> {
  const bases = webBases()
  if (!bases.length) return { ok: false, error: 'missing_web_url' }
  const { headers, error: authError } = await authHeaders()
  if (authError) return { ok: false, error: authError }

  let lastError = 'network_error'

  for (const base of bases) {
    try {
      const res = await fetchWithTimeout(`${base}/api/freelancer/apply-to-job`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jobId,
          ...(appliedRole ? { appliedRole } : {}),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        applicationId?: string
        error?: string
      }
      if (res.status === 409 || j.error === 'already_applied') {
        return { ok: true, alreadyApplied: true, applicationId: j.applicationId }
      }
      if (!res.ok) {
        lastError = j.error || `HTTP ${res.status}`
        continue
      }
      return { ok: true, applicationId: j.applicationId }
    } catch (e) {
      lastError = e instanceof Error && e.name === 'AbortError' ? 'network_timeout' : 'network_error'
      continue
    }
  }

  return { ok: false, error: lastError }
}

/** Apply via Supabase RPC first; web API is fallback when RPC is unavailable. */
export async function applyToJobViaWebApi(
  jobId: string,
  appliedRole?: string | null
): Promise<{
  ok: boolean
  applicationId?: string
  error?: string
  alreadyApplied?: boolean
}> {
  const rpc = await applyToJobViaSupabaseRpc(jobId, appliedRole)
  if (rpc.ok || !rpc.fallback) {
    return rpc
  }

  const web = await applyToJobViaWebApiInternal(jobId, appliedRole)
  if (web.ok) return web

  return {
    ok: false,
    error: web.error === 'missing_web_url' ? rpc.error ?? web.error : web.error ?? rpc.error,
  }
}

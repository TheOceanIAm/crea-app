import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

export type JobApplicationStatus = 'none' | 'pending' | 'accepted' | 'declined'

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

export async function applyToJobViaWebApi(
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

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/freelancer/apply-to-job`, {
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
        return { ok: false, error: j.error || `HTTP ${res.status}` }
      }
      return { ok: true, applicationId: j.applicationId }
    } catch {
      continue
    }
  }
  return { ok: false, error: 'network_error' }
}

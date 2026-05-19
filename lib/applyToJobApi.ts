import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

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

export async function fetchJobApplicationStatus(jobId: string): Promise<{
  applied: boolean
  applicationId: string | null
  applicantCount: number
  error?: string
}> {
  const bases = webBases()
  if (!bases.length) {
    return { applied: false, applicationId: null, applicantCount: 0, error: 'missing_web_url' }
  }
  const { headers, error: authError } = await authHeaders()
  if (authError) {
    return { applied: false, applicationId: null, applicantCount: 0, error: authError }
  }

  for (const base of bases) {
    try {
      const res = await fetch(
        `${base}/api/freelancer/job-application-status?jobId=${encodeURIComponent(jobId)}`,
        { headers, method: 'GET' }
      )
      const j = (await res.json().catch(() => ({}))) as {
        applied?: boolean
        applicationId?: string | null
        applicantCount?: number
        error?: string
      }
      if (!res.ok) {
        return {
          applied: false,
          applicationId: null,
          applicantCount: 0,
          error: j.error || `HTTP ${res.status}`,
        }
      }
      return {
        applied: Boolean(j.applied),
        applicationId: j.applicationId ?? null,
        applicantCount: typeof j.applicantCount === 'number' ? j.applicantCount : 0,
      }
    } catch {
      continue
    }
  }
  return { applied: false, applicationId: null, applicantCount: 0, error: 'network_error' }
}

export async function applyToJobViaWebApi(jobId: string): Promise<{
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
        body: JSON.stringify({ jobId }),
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

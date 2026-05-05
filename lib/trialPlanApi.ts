import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

/** Calls crea-services POST /api/me/trial-plan with the mobile session JWT. */
export async function postTrialPlan(body: { freelancer_plan?: string; company_plan?: string }): Promise<{
  ok: boolean
  error?: string
}> {
  const base = getCreaWebBaseUrl()
  if (!base) return { ok: false, error: 'missing_web_url' }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, error: 'no_session' }

  const res = await fetch(`${base}/api/me/trial-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: typeof j.error === 'string' ? j.error : `HTTP ${res.status}` }
  }

  return { ok: true }
}

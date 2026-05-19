import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

export type SyncFreelancerProfileApiResult = {
  ok: boolean
  error?: string
  portfolioSynced?: number
  portfolioSkipped?: number
}

/**
 * Server-side mirror (service role): `profiles` → `freelancer_profiles` + `freelancer_portfolio_projects`.
 * Prefer this over client-only sync — reliable for portfolio Work grid on web.
 */
export async function postSyncFreelancerProfileToWeb(): Promise<SyncFreelancerProfileApiResult> {
  const base = getCreaWebBaseUrl()
  if (!base) return { ok: false, error: 'missing_web_url' }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, error: 'no_session' }

  const candidates = [base]
  if (base === 'https://www.creaservices.de') candidates.push('https://creaservices.de')
  if (base === 'https://creaservices.de') candidates.push('https://www.creaservices.de')

  let lastError: string | undefined
  for (const candidateBase of candidates) {
    try {
      const res = (await Promise.race([
        fetch(`${candidateBase}/api/me/sync-freelancer-profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 25000)),
      ])) as Response | null

      if (!res) {
        lastError = 'timeout'
        continue
      }
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        portfolioSynced?: number
        portfolioSkipped?: number
      }
      if (!res.ok || j.ok === false) {
        return {
          ok: false,
          error: typeof j.error === 'string' ? j.error : `HTTP ${res.status}`,
          portfolioSynced: j.portfolioSynced,
          portfolioSkipped: j.portfolioSkipped,
        }
      }
      return {
        ok: true,
        portfolioSynced: j.portfolioSynced,
        portfolioSkipped: j.portfolioSkipped,
      }
    } catch {
      lastError = 'network_error'
    }
  }
  return { ok: false, error: lastError ?? 'network_error' }
}

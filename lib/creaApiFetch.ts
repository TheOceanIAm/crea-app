import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

const API_TIMEOUT_MS = 20_000

export function creaApiBaseCandidates(): string[] {
  const base = getCreaWebBaseUrl()
  if (!base) return []
  const candidates = [base]
  if (base === 'https://www.creaservices.de') candidates.push('https://creaservices.de')
  if (base === 'https://creaservices.de') candidates.push('https://www.creaservices.de')
  return candidates
}

export async function getSessionAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/** Authenticated fetch against crea-services (mobile Bearer). */
export async function fetchCreaApi<T>(
  path: string,
  init?: RequestInit
): Promise<{ data: T | null; error: string | null; status: number }> {
  const token = await getSessionAccessToken()
  if (!token) return { data: null, error: 'no_session', status: 0 }

  const candidates = creaApiBaseCandidates()
  if (!candidates.length) return { data: null, error: 'missing_web_url', status: 0 }

  let lastError = 'network_error'
  for (const base of candidates) {
    try {
      const res = (await Promise.race([
        fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
          ...init,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init?.headers ?? {}),
          },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), API_TIMEOUT_MS)),
      ])) as Response | null

      if (!res) {
        lastError = 'timeout'
        continue
      }

      const json = (await res.json().catch(() => ({}))) as T & { error?: string }
      if (!res.ok) {
        return {
          data: null,
          error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}`,
          status: res.status,
        }
      }
      return { data: json, error: null, status: res.status }
    } catch {
      lastError = 'network_error'
    }
  }

  return { data: null, error: lastError, status: 0 }
}

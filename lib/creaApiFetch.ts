import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

const API_TIMEOUT_MS = 20_000
/**
 * Tab/workspace aggregate budget. Was 4s — cold serverless often forced the heavier
 * local multi-query fallback. 8s still fails closed, but keeps the aggregate path primary.
 */
export const CREA_API_TAB_TIMEOUT_MS = 8_000
/** Slightly longer for heavy workspace shell (Manage Job / project open). */
export const CREA_API_WORKSPACE_TIMEOUT_MS = 12_000

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
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ data: T | null; error: string | null; status: number }> {
  const token = await getSessionAccessToken()
  if (!token) return { data: null, error: 'no_session', status: 0 }

  const candidates = creaApiBaseCandidates()
  if (!candidates.length) return { data: null, error: 'missing_web_url', status: 0 }

  const timeoutMs = typeof init?.timeoutMs === 'number' ? init.timeoutMs : API_TIMEOUT_MS
  const { timeoutMs: _omit, ...fetchInit } = init ?? {}

  let lastError = 'network_error'
  for (const base of candidates) {
    try {
      const res = (await Promise.race([
        fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
          ...fetchInit,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(fetchInit.headers ?? {}),
          },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
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

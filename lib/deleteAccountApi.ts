import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Calls crea-services with the current session JWT. Server purges DB rows then deletes the auth user.
 */
export async function deleteAccountViaApi(): Promise<DeleteAccountResult> {
  const base = getCreaWebBaseUrl()
  if (!base) {
    return { ok: false, error: 'Web-URL fehlt (EXPO_PUBLIC_CREA_WEB_URL).' }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token?.trim()
  if (!token) {
    return { ok: false, error: 'Nicht angemeldet.' }
  }

  try {
    const res = await fetch(`${base}/api/account/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })

    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      return { ok: false, error: json.error || `Serverfehler (${res.status})` }
    }
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Netzwerkfehler',
    }
  }
}

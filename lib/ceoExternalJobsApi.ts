import { supabase } from '@/lib/supabase'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'

export type PublishCeoExternalJobInput = {
  title: string
  company?: string
  location?: string
  role?: string
  rate?: string
  needed_when?: string
  intel_brief?: string
  contact_name?: string
  contact_email: string
  contact_linkedin?: string
  contact_instagram?: string
}

/**
 * CEOs publish manual external pool listings via CREA Services (`/api/ceo/external-jobs`),
 * authenticated with the same Supabase access token used in-app.
 */
export async function publishCeoExternalJob(
  payload: PublishCeoExternalJobInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const base = getCreaWebBaseUrl().trim().replace(/\/$/, '')
  if (!base) {
    return { ok: false, message: 'Set EXPO_PUBLIC_CREA_WEB_URL to your CREA web app URL.' }
  }
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) {
    return { ok: false, message: 'No session.' }
  }
  try {
    const res = await fetch(`${base}/api/ceo/external-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    const j = (await res.json()) as { error?: string }
    if (!res.ok) {
      return { ok: false, message: j.error || `Request failed (${res.status})` }
    }
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Network error',
    }
  }
}

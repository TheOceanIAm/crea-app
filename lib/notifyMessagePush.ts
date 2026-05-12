import { supabase } from '@/lib/supabase'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'

/**
 * Delivers a remote Expo push to the DM recipient (works when their app is closed).
 *
 * Prefer relay via crea-services `/api/push/notify-dm` when EXPO_PUBLIC_CREA_WEB_URL is set —
 * same path as the web app (reliable JWT relay). Fallback: direct Edge Function invoke.
 */
export async function requestNotifyRecipientPush(messageId: string): Promise<void> {
  if (!messageId) return
  try {
    const base = getCreaWebBaseUrl().trim().replace(/\/$/, '')
    if (base) {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (token) {
        const res = await fetch(`${base}/api/push/notify-dm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messageId }),
        })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          console.warn('[notify-dm]', res.status, detail)
        }
        return
      }
    }

    const { error } = await supabase.functions.invoke('notify-message-push', {
      body: { messageId },
    })
    if (error) {
      console.warn('[notify-message-push]', error.message)
    }
  } catch (e) {
    console.warn('[notify-message-push]', e)
  }
}

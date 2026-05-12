import { Alert, Linking } from 'react-native'
import { supabase } from '@/lib/supabase'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'

type StripeApiPath = '/api/stripe/checkout' | '/api/stripe/checkout-company' | '/api/stripe/portal'

/**
 * Opens a Stripe-hosted flow (Checkout or Billing Portal) returned by crea-services.
 * Passes the Supabase access token so mobile works without browser cookies.
 */
export async function openCreaServicesStripeUrl(opts: {
  apiPath: StripeApiPath
  body?: Record<string, unknown>
}): Promise<boolean> {
  const base = getCreaWebBaseUrl()
  if (!base) {
    Alert.alert('Configuration', 'Set EXPO_PUBLIC_CREA_WEB_URL to your CREA web origin (e.g. https://creaservices.de).')
    return false
  }
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    Alert.alert('Session', 'Please sign in again.')
    return false
  }
  const res = await fetch(`${base}${opts.apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(opts.body ?? {}),
  })
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !json.url) {
    Alert.alert('Stripe', json.error || 'Could not start Stripe.')
    return false
  }
  await Linking.openURL(json.url)
  return true
}

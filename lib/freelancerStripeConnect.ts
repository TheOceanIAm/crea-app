import { Alert, Linking } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'

export type FreelancerStripeConnectStatus = {
  connected: boolean
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
}

export type FreelancerStripeConnectFetchResult =
  | { ok: true; status: FreelancerStripeConnectStatus }
  | { ok: false; errorMessage: string }

const EMPTY_CONNECT: FreelancerStripeConnectStatus = {
  connected: false,
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
}

function stripeConnectRowToStatus(fp: Record<string, unknown> | null | undefined): FreelancerStripeConnectStatus {
  const idRaw = fp?.stripe_connect_account_id
  const id = typeof idRaw === 'string' ? idRaw.trim() : ''
  return {
    connected: id.length > 0,
    detailsSubmitted: fp?.stripe_connect_details_submitted === true,
    chargesEnabled: fp?.stripe_connect_charges_enabled === true,
    payoutsEnabled: fp?.stripe_connect_payouts_enabled === true,
  }
}

/** Supabase mirror of Connect flags (same row the web onboarding updates). */
export async function fetchFreelancerStripeConnectFromSupabase(
  session?: Session | null
): Promise<FreelancerStripeConnectStatus> {
  let id = session?.user?.id ?? null
  if (!id) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    id = user?.id ?? null
  }
  if (!id) return { ...EMPTY_CONNECT }

  const { data: fp } = await supabase
    .from('freelancer_profiles')
    .select(
      'stripe_connect_account_id, stripe_connect_details_submitted, stripe_connect_charges_enabled, stripe_connect_payouts_enabled'
    )
    .eq('id', id)
    .maybeSingle()

  return stripeConnectRowToStatus(fp as Record<string, unknown> | null)
}

/** Prefer true from either source so the UI matches web + DB if the API payload is sparse. */
export function mergeFreelancerStripeConnectStatus(
  api: FreelancerStripeConnectStatus,
  db: FreelancerStripeConnectStatus
): FreelancerStripeConnectStatus {
  return {
    connected: api.connected || db.connected,
    detailsSubmitted: api.detailsSubmitted || db.detailsSubmitted,
    chargesEnabled: api.chargesEnabled || db.chargesEnabled,
    payoutsEnabled: api.payoutsEnabled || db.payoutsEnabled,
  }
}

/**
 * Freelancer Stripe Connect payout status from crea-services (same payload as web).
 * Uses Supabase access token — matches cookie session behaviour on the website.
 */
export async function fetchFreelancerStripeConnectStatus(): Promise<FreelancerStripeConnectFetchResult> {
  const base = getCreaWebBaseUrl()
  if (!base) {
    return { ok: false, errorMessage: 'EXPO_PUBLIC_CREA_WEB_URL is not set.' }
  }
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token?.trim()
  if (!token) {
    return { ok: false, errorMessage: 'Not signed in.' }
  }

  const res = await fetch(`${base}/api/stripe/connect/status`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })

  const json = (await res.json().catch(() => ({}))) as {
    connected?: boolean
    detailsSubmitted?: boolean
    chargesEnabled?: boolean
    payoutsEnabled?: boolean
    error?: string
  }

  if (!res.ok) {
    const msg =
      json.error ||
      (res.status === 403 ? 'Freelancer access only.' : `Request failed (${res.status}).`)
    return { ok: false, errorMessage: msg }
  }

  return {
    ok: true,
    status: {
      connected: !!json.connected,
      detailsSubmitted: !!json.detailsSubmitted,
      chargesEnabled: !!json.chargesEnabled,
      payoutsEnabled: !!json.payoutsEnabled,
    },
  }
}

/** Opens Stripe-hosted Express onboarding for Connect; return URL lands on crea-services settings. */
export async function openFreelancerStripeConnectOnboarding(): Promise<boolean> {
  const base = getCreaWebBaseUrl()
  if (!base) {
    Alert.alert(
      'Configuration',
      'Set EXPO_PUBLIC_CREA_WEB_URL to your CREA web origin (e.g. https://www.creaservices.de).'
    )
    return false
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token?.trim()
  if (!token) {
    Alert.alert('Session', 'Please sign in again.')
    return false
  }

  const res = await fetch(`${base}/api/stripe/connect/onboarding`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: '{}',
  })

  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }

  if (!res.ok || typeof json.url !== 'string' || !json.url.trim()) {
    Alert.alert('Stripe Connect', json.error || 'Could not start Stripe onboarding.')
    return false
  }

  await Linking.openURL(json.url)
  return true
}

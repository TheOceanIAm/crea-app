import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Device from 'expo-device'
import { useFocusEffect } from '@react-navigation/native'
import { ChevronLeft } from 'lucide-react-native'
import { useStripe, PlatformPay } from '@stripe/stripe-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isCeoProfile, resolveAppRole } from '@/lib/profileRole'
import {
  getCreaPayBaseUrl,
  getCreaWebBaseUrl,
  openInvoiceApplePayOnWeb,
  openInvoicePayOnWeb,
} from '@/lib/creaWeb'
import {
  formatDate,
  formatDateTime,
  money,
  invoiceStatusLabel,
  statusVariant,
} from '@/lib/invoiceFormatting'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { invoiceBadgeStyles, statusBadgeFor } from '@/lib/invoiceStyles'

/** Matches StripeProvider urlScheme (`crea` in app.json); required on iOS for redirect-capable Payment Sheet methods / 3DS. */
const STRIPE_IOS_RETURN_URL = 'crea://stripe-redirect'

const CREA_API_FETCH_MS = 38_000
const STRIPE_APPLE_PAY_CHECK_MS = 12_000
const STRIPE_INIT_SHEET_MS = 45_000
const STRIPE_PRESENT_SHEET_MS = 120_000
const STRIPE_APPLE_PAY_CONFIRM_MS = 120_000

/** Prevents a stuck Pay button when network / native Stripe calls never settle. */
async function fetchWithTimeoutMs(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController()
  const tid = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(tid)
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let tid: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<T>((_, reject) => {
    tid = setTimeout(
      () =>
        reject(new Error(`${label} timed out (${Math.round(ms / 1000)}s). Try again or use browser checkout.`)),
      ms
    )
  })
  return Promise.race([
    promise.finally(() => {
      if (tid !== undefined) clearTimeout(tid)
    }),
    expired,
  ])
}

/**
 * Prefer Stripe Checkout (browser) instead of native Payment Sheet on simulators/emulators where
 * `Device.isDevice` can be unreliable and Apple Pay / the sheet often fail or hang.
 */
function prefersHostedCreaPayOverNativeSheet(): boolean {
  if (!Device.isDevice) return true
  const model = `${Device.modelName ?? ''} ${Device.designName ?? ''}`.toLowerCase()
  const product = `${Device.productName ?? ''}`.toLowerCase()
  return /simulator|emulator|sdk_gphone|sdk_phone|generic_x86|genymotion/.test(
    `${model} ${product}`
  )
}

/** Stripe Hosted Checkout session URLs — reject accidental non-Stripe redirects. */
function isStripeHostedCheckoutUrl(candidate: string): boolean {
  try {
    const u = new URL(candidate.trim())
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return host === 'checkout.stripe.com' || host.endsWith('.checkout.stripe.com')
  } catch {
    return false
  }
}

type InvoiceRecord = Record<string, unknown> & { id: string; status?: string }

function str(v: unknown) {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  return null
}

function derivedInvoiceNumber(row: InvoiceRecord | null): string {
  if (!row) return '—'
  const explicit =
    str(row.invoice_number) ||
    str(row.invoice_no) ||
    str(row.number) ||
    str(row.payment_reference)
  if (explicit && explicit.trim()) return explicit.trim()
  const rawId = str(row.id)?.replace(/-/g, '').toUpperCase() ?? ''
  return rawId ? `CR-${rawId.slice(0, 8)}` : '—'
}

function derivedInvoiceTitle(row: InvoiceRecord | null): string {
  if (!row) return '—'
  const t =
    str(row.invoice_project_title) ||
    str(row.title) ||
    str(row.project_title) ||
    str(row.job_title)
  return t?.trim() || '—'
}

function hasConfirmedReceipt(inv: InvoiceRecord | null): boolean {
  const r = inv ? str(inv.received_at) : null
  return !!(r && r.trim())
}

export default function InvoiceDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const id =
    typeof params.id === 'string'
      ? params.id
      : Array.isArray(params.id) && params.id[0]
        ? params.id[0]
        : undefined
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [viewerRole, setViewerRole] = useState<'company' | 'freelancer' | 'ceo' | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [receivedBusy, setReceivedBusy] = useState(false)
  const [paymentSyncPending, setPaymentSyncPending] = useState(false)
  const [paymentSyncTimedOut, setPaymentSyncTimedOut] = useState(false)
  const [lastPaymentCheckAt, setLastPaymentCheckAt] = useState<Date | null>(null)
  const pollAttemptsRef = useRef(0)
  const MAX_PAYMENT_SYNC_POLLS = 20
  const { initPaymentSheet, presentPaymentSheet, isPlatformPaySupported, confirmPlatformPayPayment } = useStripe()
  type PlatformPaySupportArg = Parameters<typeof isPlatformPaySupported>[0]

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') {
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const resolved = resolveAppRole(profile?.role, user)
    const ceo = isCeoProfile(resolved)

    if (ceo) {
      setViewerRole('ceo')
      const { data: rpcRow, error: rpcErr } = await supabase.rpc('ceo_get_invoice', { p_id: id })
      let row: InvoiceRecord | null = null
      if (!rpcErr && rpcRow && typeof rpcRow === 'object' && rpcRow !== null && 'id' in (rpcRow as object)) {
        row = rpcRow as InvoiceRecord
      }
      if (!row) {
        const { data: d } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle()
        if (d) row = d as InvoiceRecord
      }
      if (row) {
        setInvoice(row)
        setForbidden(false)
      } else {
        setInvoice(null)
        setForbidden(false)
      }
      setLoading(false)
      return
    }

    const role = profile?.role === 'company' ? 'company' : 'freelancer'
    setViewerRole(role)

    const { data, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle()

    if (error || !data) {
      setInvoice(null)
      setForbidden(false)
      setLoading(false)
      return
    }

    const row = data as InvoiceRecord
    const companyId = str(row.company_id)
    const freelancerId = str(row.freelancer_id)
    const allowed =
      (role === 'company' && companyId === user.id) ||
      (role === 'freelancer' && freelancerId === user.id)

    if (!allowed) {
      setForbidden(true)
      setInvoice(null)
    } else {
      setInvoice(row)
      setForbidden(false)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const goBack = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)/invoices')
    }
  }

  const setInvoiceStatus = async (next: string) => {
    if (!id || typeof id !== 'string') return
    if (viewerRole === 'ceo') return
    setStatusBusy(true)
    const { error } = await supabase.from('invoices').update({ status: next }).eq('id', id)
    setStatusBusy(false)
    if (error) {
      Alert.alert('Update failed', error.message)
      return
    }
    setInvoice((prev) => (prev ? { ...prev, status: next } : prev))
    if (viewerRole === 'company' && next === 'paid' && typeof id === 'string') {
      void notifyExpoEvent({ kind: 'invoice', invoiceId: id, event: 'paid' })
    }
  }

  const deleteInvoice = () => {
    if (!id || typeof id !== 'string') return
    if (viewerRole === 'ceo') return
    if (deleteBusy) return
    Alert.alert(
      'Delete invoice',
      'Delete this invoice permanently? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeleteBusy(true)
              const { error } = await supabase.from('invoices').delete().eq('id', id)
              setDeleteBusy(false)
              if (error) {
                Alert.alert('Delete failed', error.message)
                return
              }
              Alert.alert('Deleted', 'Invoice was removed.')
              router.replace('/(tabs)/invoices')
            })()
          },
        },
      ]
    )
  }

  const refreshInvoiceStatusOnce = useCallback(async (): Promise<string | null> => {
    if (!id || typeof id !== 'string') return null
    const { data, error } = await supabase
      .from('invoices')
      .select('status, received_at')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    const row = data as { status?: string; received_at?: unknown }
    const nextStatus = String(row.status ?? '').toLowerCase() || null
    const nextReceived = row.received_at != null ? String(row.received_at).trim() : ''
    setInvoice((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextReceived ? { received_at: nextReceived } : {}),
      }
    })
    setLastPaymentCheckAt(new Date())
    return nextStatus
  }, [id])

  const markInvoiceReceived = () => {
    if (!id || typeof id !== 'string') return
    void (async () => {
      setReceivedBusy(true)
      try {
        const base = getCreaWebBaseUrl() || getCreaPayBaseUrl()
        if (!base) {
          Alert.alert(
            'Missing CREA web URL',
            'Set EXPO_PUBLIC_CREA_WEB_URL in crea-app/.env.local, restart Expo with npx expo start --clear.'
          )
          return
        }
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          Alert.alert('Session expired', 'Please sign in again.')
          return
        }
        const res = await fetch(`${base}/api/invoices/mark-received`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ invoiceId: id }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          received_at?: string
          duplicate?: boolean
          ok?: boolean
        }
        if (!res.ok) {
          Alert.alert('Could not confirm receipt', json.error?.trim() || `Request failed (${res.status}).`)
          return
        }
        const ra = json.received_at?.trim()
        if (ra) {
          setInvoice((prev) => (prev ? { ...prev, received_at: ra } : prev))
        } else {
          await load()
        }
        if (json.duplicate !== true) {
          void notifyExpoEvent({ kind: 'invoice', invoiceId: id, event: 'receipt_confirmed' })
        }
      } catch (e) {
        Alert.alert('Receipt', e instanceof Error ? e.message : 'Something went wrong.')
      } finally {
        setReceivedBusy(false)
      }
    })()
  }

  /** Hosted Stripe Checkout — primary on simulator/emulator where native Payment Sheet is unreliable. */
  const runHostedStripeCheckout = async (preferApplePay: boolean): Promise<void> => {
    if (!id || typeof id !== 'string') return

    const fallbackOpen = async (): Promise<boolean> => {
      const ok = preferApplePay ? await openInvoiceApplePayOnWeb(id) : await openInvoicePayOnWeb(id)
      if (!ok) {
        Alert.alert(
          'Payment unavailable',
          'Could not open the payment page (browser). Check EXPO_PUBLIC_CREA_WEB_URL, or try again.'
        )
        return false
      }
      setPaymentSyncPending(true)
      setPaymentSyncTimedOut(false)
      pollAttemptsRef.current = 0
      return true
    }

    /** Never auto-open CREA invoice in Safari (no cookie): that often redirects to the homepage — user must tap to open and sign in. */
    const offerOpenInvoiceOnWebsite = (title: string, message: string) => {
      Alert.alert(title, message, [
        { text: 'OK', style: 'cancel' },
        {
          text: 'Open invoice on website',
          onPress: () => {
            void (async () => {
              await fallbackOpen()
            })()
          },
        },
      ])
    }

    try {
      const base = getCreaWebBaseUrl() || getCreaPayBaseUrl()
      if (!base) {
        Alert.alert(
          'Configuration',
          'Set EXPO_PUBLIC_CREA_WEB_URL in crea-app/.env.local (e.g. https://www.creaservices.de), restart Expo.'
        )
        return
      }
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        offerOpenInvoiceOnWebsite(
          'Session expired',
          'Please sign in again in the app. To pay on the website, tap below and log in — then Pay on the invoice page.'
        )
        return
      }
      let res: Response
      try {
        res = await fetchWithTimeoutMs(
          `${base}/api/stripe/crea-pay/checkout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              invoiceId: id,
              paymentMethodHint: preferApplePay ? 'apple_pay' : 'card',
            }),
          },
          CREA_API_FETCH_MS
        )
      } catch (fe) {
        const aborted =
          fe instanceof Error && /aborted|abort/i.test(fe.message + (fe as Error).name)
        offerOpenInvoiceOnWebsite(
          'CREA Pay (checkout)',
          aborted
            ? 'Request to CREA Pay timed out. Check your internet and that your EXPO_PUBLIC_CREA_WEB_URL is correct. We do not open the site automatically—you can open the invoice on the web after signing in there.'
            : fe instanceof Error
              ? fe.message
              : 'Network error.'
        )
        return
      }
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string }
      if (!res.ok || !json.url) {
        const msg =
          (typeof json.error === 'string' && json.error.trim()) ||
          `Could not start Stripe checkout (${res.status}).`
        Alert.alert('CREA Pay (checkout)', msg, [
          { text: 'OK', style: 'cancel' },
          {
            text: 'Open invoice on website',
            onPress: () => {
              void (async () => {
                await fallbackOpen()
              })()
            },
          },
        ])
        return
      }
      const url = String(json.url || '').trim()
      if (!url || !isStripeHostedCheckoutUrl(url)) {
        offerOpenInvoiceOnWebsite(
          'Checkout link unavailable',
          'Expected a Stripe Checkout link but got something else. Try Pay now again after a moment or pay signed in on the website.'
        )
        return
      }
      try {
        await Linking.openURL(url)
        setPaymentSyncPending(true)
        setPaymentSyncTimedOut(false)
        pollAttemptsRef.current = 0
      } catch (linkErr) {
        Alert.alert(
          'Could not open Stripe',
          linkErr instanceof Error
            ? linkErr.message
            : 'Safari/checkout did not open. Try again or pay on creaservices.de in your browser.',
          [
            { text: 'OK', style: 'cancel' },
            {
              text: 'Open invoice on website',
              onPress: () => {
                void (async () => {
                  await fallbackOpen()
                })()
              },
            },
          ]
        )
      }
    } catch (e) {
      offerOpenInvoiceOnWebsite(
        'Payment failed',
        e instanceof Error ? e.message : 'Could not open Stripe checkout.'
      )
    }
  }

  const startCheckout = (preferApplePay: boolean) => {
    void runHostedStripeCheckout(preferApplePay)
  }

  const openCreaPay = () => {
    if (!id || typeof id !== 'string') return
    void (async () => {
      setPayBusy(true)
      try {
        if (prefersHostedCreaPayOverNativeSheet()) {
          await runHostedStripeCheckout(false)
          return
        }
        const pk = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim()
        if (!pk) {
          Alert.alert(
            'Stripe not configured',
            'Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to crea-app/.env.local (your pk_live_… from Stripe), restart Expo (stop + npx expo start --clear), then try again. Opening browser checkout instead…'
          )
          startCheckout(false)
          return
        }

        const base = getCreaWebBaseUrl() || getCreaPayBaseUrl()
        if (!base) {
          Alert.alert(
            'Missing CREA web URL',
            'Set EXPO_PUBLIC_CREA_WEB_URL in crea-app/.env.local (e.g. https://www.creaservices.de), restart Expo with npx expo start --clear.'
          )
          return
        }
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          Alert.alert('Session expired', 'Please sign in again to continue payment.')
          return
        }
        let createRes: Response
        try {
          createRes = await fetchWithTimeoutMs(
            `${base}/api/stripe/crea-pay/mobile-intent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ invoiceId: id }),
            },
            CREA_API_FETCH_MS
          )
        } catch (fe) {
          const aborted =
            fe instanceof Error && /aborted|abort/i.test(fe.message + (fe as Error).name)
          if (aborted) {
            await runHostedStripeCheckout(false)
            return
          }
          throw new Error(fe instanceof Error ? fe.message : 'Network error')
        }
        const createJson = (await createRes.json().catch(() => ({}))) as {
          clientSecret?: string
          customerName?: string
          amountCents?: number
          currency?: string
          error?: string
          code?: string
        }
        if (!createRes.ok || !createJson.clientSecret) {
          Alert.alert(
            'CREA Pay (app)',
            createJson.error?.trim()
              ? createJson.error
              : `Could not start payment in the app (${createRes.status}). Opening browser checkout if possible…`
          )
          startCheckout(false)
          return
        }

        let appleOk = false
        if (Platform.OS === 'ios') {
          try {
            appleOk = await withTimeout(
              isPlatformPaySupported({
                applePay: { merchantCountryCode: 'DE' },
              } as PlatformPaySupportArg),
              STRIPE_APPLE_PAY_CHECK_MS,
              'Apple Pay check'
            )
          } catch {
            appleOk = false
          }
        }
        const init = await withTimeout(
          initPaymentSheet({
            merchantDisplayName: 'CREA',
            paymentIntentClientSecret: createJson.clientSecret,
            ...(Platform.OS === 'ios' ? { returnURL: STRIPE_IOS_RETURN_URL } : {}),
            ...(appleOk ? { applePay: { merchantCountryCode: 'DE' } } : {}),
            defaultBillingDetails: createJson.customerName
              ? {
                  name: createJson.customerName,
                }
              : undefined,
          }),
          STRIPE_INIT_SHEET_MS,
          'Stripe payment sheet'
        )
        if (init.error) {
          Alert.alert(
            'Stripe Payment Sheet',
            `${init.error.message ?? 'Could not initialize payment sheet.'}\n\nOpening browser checkout instead…`
          )
          startCheckout(false)
          return
        }

        const present = await withTimeout(presentPaymentSheet(), STRIPE_PRESENT_SHEET_MS, 'Payment confirmation')
        if (present.error) {
          // User cancel should not throw a hard error.
          if (present.error.code && String(present.error.code).toLowerCase().includes('canceled')) return
          Alert.alert(
            'Payment',
            `${present.error.message ?? 'Payment sheet closed.'}\n\nYou can try again or use browser checkout.`
          )
          startCheckout(false)
          return
        }
        setPaymentSyncPending(true)
        setPaymentSyncTimedOut(false)
        pollAttemptsRef.current = 0
      } catch (e) {
        await runHostedStripeCheckout(false)
      } finally {
        setPayBusy(false)
      }
    })()
  }

  const openApplePayQuick = () => {
    if (!id || typeof id !== 'string') return
    void (async () => {
      setPayBusy(true)
      try {
        if (prefersHostedCreaPayOverNativeSheet()) {
          await runHostedStripeCheckout(true)
          return
        }
        const pk = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim()
        if (!pk) {
          Alert.alert(
            'Stripe not configured',
            'Apple Pay uses the same native Stripe setup as Pay now. Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to .env.local and restart Expo. Opening browser checkout…'
          )
          startCheckout(true)
          return
        }

        try {
        const base = getCreaWebBaseUrl() || getCreaPayBaseUrl()
        if (!base) {
          Alert.alert(
            'Configuration',
            'Set EXPO_PUBLIC_CREA_WEB_URL so we can reach creaservices.de for CREA Pay.'
          )
          return
        }
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          Alert.alert('Session expired', 'Please sign in again to continue payment.')
          return
        }
        let createRes: Response
        try {
          createRes = await fetchWithTimeoutMs(
            `${base}/api/stripe/crea-pay/mobile-intent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ invoiceId: id }),
            },
            CREA_API_FETCH_MS
          )
        } catch (fe) {
          const aborted =
            fe instanceof Error && /aborted|abort/i.test(fe.message + (fe as Error).name)
          if (aborted) {
            await runHostedStripeCheckout(true)
            return
          }
          throw new Error(fe instanceof Error ? fe.message : 'Network error')
        }
        const createJson = (await createRes.json().catch(() => ({}))) as {
          clientSecret?: string
          amountCents?: number
          currency?: string
          error?: string
        }
        if (!createRes.ok || !createJson.clientSecret) {
          Alert.alert(
            'CREA Pay (Apple Pay)',
            createJson.error?.trim()
              ? createJson.error
              : `Could not start Apple Pay (${createRes.status}). Trying browser checkout…`
          )
          startCheckout(true)
          return
        }

        let platformSupported = false
        try {
          platformSupported = await withTimeout(
            isPlatformPaySupported({
              applePay: { merchantCountryCode: 'DE' },
            } as PlatformPaySupportArg),
            STRIPE_APPLE_PAY_CHECK_MS,
            'Apple Pay check'
          )
        } catch {
          platformSupported = false
        }
        if (!platformSupported) {
          const hint =
            Platform.OS === 'ios'
              ? 'The iOS Simulator usually has no usable Apple Wallet for Apple Pay. On a real iPhone, add a card to Wallet — or use Pay now below for cards.'
              : 'Apple Pay is not supported on this device. Use Pay now (card payment sheet) or checkout in your browser.'
          Alert.alert('Apple Pay not available', `${hint}`, [
            { text: 'Use card sheet', style: 'default', onPress: () => openCreaPay() },
            {
              text: 'Browser checkout',
              style: 'cancel',
              onPress: () => startCheckout(false),
            },
          ])
          return
        }

        const amount = ((createJson.amountCents ?? 0) / 100).toFixed(2)
        const confirm = await withTimeout(
          confirmPlatformPayPayment(createJson.clientSecret, {
            applePay: {
              merchantCountryCode: 'DE',
              currencyCode: (createJson.currency || 'EUR').toUpperCase(),
              cartItems: [{ label: 'CREA invoice', amount, paymentType: PlatformPay.PaymentType.Immediate }],
            },
          }),
          STRIPE_APPLE_PAY_CONFIRM_MS,
          'Apple Pay'
        )
        if (confirm.error) {
          if (confirm.error.code && String(confirm.error.code).toLowerCase().includes('canceled')) return
          Alert.alert(
            confirm.error.localizedMessage || 'Apple Pay',
            confirm.error.message ?? 'Apple Pay could not finish. You can pay with card or in the browser.',
            [
              { text: 'Card sheet', onPress: () => openCreaPay() },
              { text: 'Browser', style: 'cancel', onPress: () => startCheckout(false) },
            ]
          )
          return
        }

        setPaymentSyncPending(true)
        setPaymentSyncTimedOut(false)
        pollAttemptsRef.current = 0
      } catch (e) {
        await runHostedStripeCheckout(true)
      }
      } finally {
        setPayBusy(false)
      }
    })()
  }

  useEffect(() => {
    if (!paymentSyncPending) return
    const timer = setInterval(() => {
      void (async () => {
        pollAttemptsRef.current += 1
        const status = await refreshInvoiceStatusOnce()
        if (status === 'paid') {
          setPaymentSyncPending(false)
          setPaymentSyncTimedOut(false)
          Alert.alert('Payment confirmed', 'Invoice status is now paid.')
          return
        }
        if (pollAttemptsRef.current >= MAX_PAYMENT_SYNC_POLLS) {
          setPaymentSyncPending(false)
          setPaymentSyncTimedOut(true)
        }
      })()
    }, 5000)
    return () => clearInterval(timer)
  }, [paymentSyncPending, refreshInvoiceStatusOnce])

  useEffect(() => {
    if (!paymentSyncPending) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      void (async () => {
        const status = await refreshInvoiceStatusOnce()
        if (status === 'paid') {
          setPaymentSyncPending(false)
          setPaymentSyncTimedOut(false)
          Alert.alert('Payment confirmed', 'Invoice status is now paid.')
        }
      })()
    })
    return () => sub.remove()
  }, [paymentSyncPending, refreshInvoiceStatusOnce])

  useEffect(() => {
    const current = String(invoice?.status ?? '').toLowerCase()
    if (current === 'paid') {
      if (paymentSyncPending) setPaymentSyncPending(false)
      if (paymentSyncTimedOut) setPaymentSyncTimedOut(false)
    }
  }, [invoice?.status, paymentSyncPending, paymentSyncTimedOut])

  const manualRefreshPaymentStatus = async () => {
    const next = await refreshInvoiceStatusOnce()
    if (next === 'paid') {
      setPaymentSyncTimedOut(false)
      Alert.alert('Payment confirmed', 'Invoice status is now paid.')
      return
    }
    Alert.alert('Still pending', 'Payment is still pending. Please check again shortly.')
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (forbidden || !invoice) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} hitSlop={12}>
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.missingWrap}>
          <Text style={styles.missingTitle}>
            {forbidden ? 'No access' : 'Invoice not found'}
          </Text>
          <Text style={styles.missingSub}>
            {forbidden
              ? 'This invoice isn’t linked to your account.'
              : 'This invoice doesn’t exist or was removed.'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  const status = String(invoice.status ?? '').toLowerCase()
  const sb = statusBadgeFor(statusVariant(status))
  const invoiceNumber = derivedInvoiceNumber(invoice)
  const invoiceTitle = derivedInvoiceTitle(invoice)
  const versionNo = num(invoice.version_no) ?? 1
  const isLatest = invoice.is_latest !== false
  const receiptConfirmed = hasConfirmedReceipt(invoice)
  const creaPayReady = isLatest && receiptConfirmed

  const detailRows: { label: string; value: string }[] = [
    { label: 'Invoice no.', value: invoiceNumber },
    { label: 'Version', value: `v${versionNo}${isLatest ? ' (latest)' : ''}` },
    { label: 'Title', value: invoiceTitle },
    { label: 'Description', value: str(invoice.description) || '—' },
    { label: 'Due date', value: formatDate(str(invoice.due_date)) },
    { label: 'Created', value: formatDateTime(str(invoice.created_at)) },
    { label: 'Updated', value: formatDateTime(str(invoice.updated_at)) },
    ...(receiptConfirmed
      ? [{ label: 'Receipt confirmed', value: formatDateTime(str(invoice.received_at)) }]
      : []),
  ].filter((row) => row.value !== '—' || ['Title', 'Description', 'Invoice no.'].includes(row.label))

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Invoices</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <Text style={styles.headline} numberOfLines={3}>
            {invoiceTitle !== '—' ? invoiceTitle : invoiceNumber !== '—' ? invoiceNumber : 'Invoice'}
          </Text>
          <View style={[styles.statusBadge, sb.wrap]}>
            <Text style={[invoiceBadgeStyles.statusText, sb.text]}>{invoiceStatusLabel(status)}</Text>
          </View>
        </View>

        <Text style={styles.bigAmount}>{money(num(invoice.amount), str(invoice.currency))}</Text>
        {!isLatest ? (
          <Text style={styles.versionNotice}>
            This is an older invoice revision. A newer version exists and is used for payment.
          </Text>
        ) : null}

        {detailRows.map((row) => (
          <View key={row.label} style={styles.row}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={styles.rowValue}>{row.value}</Text>
          </View>
        ))}

        {viewerRole === 'ceo' ? (
          <Text style={styles.ceoReadOnly}>CEO view — read only. Status changes stay with the company account.</Text>
        ) : null}

        {viewerRole === 'company' && (
          <View style={styles.actions}>
            {status === 'draft' && (
              <TouchableOpacity
                style={[styles.actionBtn, statusBusy && styles.dim]}
                disabled={statusBusy}
                onPress={() => setInvoiceStatus('pending')}
              >
                <Text style={styles.actionBtnText}>Send invoice (mark pending)</Text>
              </TouchableOpacity>
            )}
            {(status === 'pending' || status === 'overdue') && (
              <>
                {isLatest && !receiptConfirmed ? (
                  <>
                    <TouchableOpacity
                      style={[styles.actionBtnPrimary, (receivedBusy || statusBusy) && styles.dim]}
                      disabled={receivedBusy || statusBusy}
                      onPress={markInvoiceReceived}
                    >
                      {receivedBusy ? (
                        <ActivityIndicator color="#0a0a0a" />
                      ) : (
                        <Text style={styles.actionBtnPrimaryText}>Confirm receipt</Text>
                      )}
                    </TouchableOpacity>
                    <Text style={styles.receiptHint}>
                      Confirm on CREA that you received this invoice. CREA Pay card and Apple Pay unlock after this
                      step (same rule as on the website).
                    </Text>
                  </>
                ) : null}
                {isLatest && receiptConfirmed ? (
                  <Text style={styles.receiptOkHint}>Receipt confirmed — you can pay with CREA Pay below.</Text>
                ) : null}
                {!isLatest ? (
                  <Text style={styles.receiptHint}>
                    This is not the latest invoice version. Open the current version to confirm receipt and pay.
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.actionBtnPrimary,
                    (payBusy || statusBusy || !creaPayReady) && styles.dim,
                  ]}
                  disabled={payBusy || statusBusy || !creaPayReady}
                  onPress={openCreaPay}
                >
                  {payBusy ? (
                    <ActivityIndicator color="#0a0a0a" />
                  ) : (
                    <Text style={styles.actionBtnPrimaryText}>Pay now (recommended)</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, (payBusy || statusBusy || !creaPayReady) && styles.dim]}
                  disabled={payBusy || statusBusy || !creaPayReady}
                  onPress={openApplePayQuick}
                >
                  <Text style={styles.actionBtnText}>Quick pay with Apple Pay</Text>
                </TouchableOpacity>
                <Text style={styles.flowHint}>
                  Pay now takes you to Stripe to finish payment: on a real phone or tablet you get the in-app payment
                  sheet (cards and more). On a simulator or emulator we open Stripe Checkout in the system browser
                  instead. Quick pay with Apple Pay only works where Wallet supports Apple Pay; otherwise use Pay now.
                </Text>
                {paymentSyncPending ? (
                  <Text style={styles.syncHint}>Waiting for CREA Pay confirmation…</Text>
                ) : null}
                {paymentSyncTimedOut ? (
                  <View style={styles.syncCard}>
                    <Text style={styles.syncWarnTitle}>Payment still pending</Text>
                    <Text style={styles.syncWarnText}>
                      We could not confirm payment automatically yet. You can refresh status manually.
                    </Text>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.syncRefreshBtn]}
                      onPress={manualRefreshPaymentStatus}
                      disabled={statusBusy}
                    >
                      <Text style={styles.actionBtnText}>Refresh payment status</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {lastPaymentCheckAt ? (
                  <Text style={styles.syncMeta}>
                    Last checked: {lastPaymentCheckAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.actionBtn, statusBusy && styles.dim]}
                  disabled={statusBusy}
                  onPress={() => setInvoiceStatus('paid')}
                >
                  <Text style={styles.actionBtnText}>Mark as paid (manual)</Text>
                </TouchableOpacity>
              </>
            )}
            {status === 'paid' ? (
              <Text style={styles.paidHint}>Paid via CREA Pay or manual confirmation.</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.deleteBtn, deleteBusy && styles.dim]}
              disabled={deleteBusy}
              onPress={deleteInvoice}
            >
              <Text style={styles.deleteBtnText}>{deleteBusy ? 'Deleting…' : 'Delete invoice'}</Text>
            </TouchableOpacity>
          </View>
        )}
        {viewerRole === 'freelancer' ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.deleteBtn, deleteBusy && styles.dim]}
              disabled={deleteBusy}
              onPress={deleteInvoice}
            >
              <Text style={styles.deleteBtnText}>{deleteBusy ? 'Deleting…' : 'Delete invoice'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  topBar: { paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 8 },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  headline: { flex: 1, fontSize: 22, fontWeight: '800', color: '#ffffff', lineHeight: 28 },
  statusBadge: { borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4, marginTop: 2 },
  bigAmount: { fontSize: 32, fontWeight: '900', color: '#FFDC00', marginBottom: 28 },
  versionNotice: {
    marginTop: -12,
    marginBottom: 16,
    fontSize: 12,
    color: 'rgba(255,220,0,0.8)',
    lineHeight: 18,
  },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowLabel: { fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  rowValue: { fontSize: 15, color: 'rgba(255,255,255,0.88)', lineHeight: 22 },
  missingWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  missingTitle: { fontSize: 20, fontWeight: '800', color: '#ffffff', marginBottom: 10 },
  missingSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 20 },
  actions: { marginTop: 24, gap: 12 },
  actionBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  actionBtnText: { color: '#FFDC00', fontWeight: '700', fontSize: 15 },
  actionBtnPrimary: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#FFDC00',
  },
  actionBtnPrimaryText: { color: '#0a0a0a', fontWeight: '800', fontSize: 15 },
  deleteBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,110,110,0.45)',
    backgroundColor: 'rgba(255,80,80,0.06)',
  },
  deleteBtnText: { color: '#ff8e8e', fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.55 },
  ceoReadOnly: {
    marginTop: 20,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  paidHint: {
    marginTop: 2,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 18,
  },
  syncHint: {
    marginTop: -2,
    fontSize: 12,
    color: 'rgba(255,220,0,0.7)',
    lineHeight: 18,
  },
  syncCard: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    backgroundColor: 'rgba(255,220,0,0.06)',
    padding: 12,
  },
  syncWarnTitle: { color: '#FFDC00', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  syncWarnText: { color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  syncRefreshBtn: { alignSelf: 'flex-start', width: '100%' },
  syncMeta: { marginTop: 2, fontSize: 11, color: 'rgba(255,255,255,0.35)' },
  flowHint: { marginTop: -2, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },
  receiptHint: {
    marginTop: -4,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 18,
  },
  receiptOkHint: {
    fontSize: 12,
    color: 'rgba(255,220,0,0.85)',
    lineHeight: 18,
    fontWeight: '600',
  },
})

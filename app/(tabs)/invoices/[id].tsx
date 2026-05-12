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
          void notifyExpoEvent({ kind: 'invoice', invoiceId: id, event: 'received' })
        }
      } catch (e) {
        Alert.alert('Receipt', e instanceof Error ? e.message : 'Something went wrong.')
      } finally {
        setReceivedBusy(false)
      }
    })()
  }

  const startCheckout = (preferApplePay: boolean) => {
    if (!id || typeof id !== 'string') return
    void (async () => {
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

      try {
        const base = getCreaWebBaseUrl() || getCreaPayBaseUrl()
        if (!base) {
          await fallbackOpen()
          return
        }
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          await fallbackOpen()
          return
        }
        const res = await fetch(`${base}/api/stripe/crea-pay/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            invoiceId: id,
            paymentMethodHint: preferApplePay ? 'apple_pay' : 'card',
          }),
        })
        const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
        if (!res.ok || !json.url) {
          if (!(await fallbackOpen())) {
            Alert.alert('Payment failed', json.error || `Could not start Stripe checkout (${res.status}).`)
          }
          return
        }
        try {
          await Linking.openURL(json.url)
          setPaymentSyncPending(true)
          setPaymentSyncTimedOut(false)
          pollAttemptsRef.current = 0
        } catch (linkErr) {
          Alert.alert(
            'Could not open Stripe',
            linkErr instanceof Error ? linkErr.message : 'Safari/checkout did not open. Try again or pay on creaservices.de in your browser.'
          )
        }
      } catch (e) {
        if (!(await fallbackOpen())) {
          Alert.alert('Payment failed', e instanceof Error ? e.message : 'Could not open Stripe checkout.')
        }
      }
    })()
  }

  const openCreaPay = () => {
    if (!id || typeof id !== 'string') return
    void (async () => {
      setPayBusy(true)
      const pk = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim()
      try {
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
        const createRes = await fetch(`${base}/api/stripe/crea-pay/mobile-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ invoiceId: id }),
        })
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

        const appleOk =
          Platform.OS === 'ios' &&
          (await isPlatformPaySupported({
            applePay: { merchantCountryCode: 'DE' },
          } as PlatformPaySupportArg))
        const init = await initPaymentSheet({
          merchantDisplayName: 'CREA',
          paymentIntentClientSecret: createJson.clientSecret,
          ...(Platform.OS === 'ios' ? { returnURL: STRIPE_IOS_RETURN_URL } : {}),
          ...(appleOk ? { applePay: { merchantCountryCode: 'DE' } } : {}),
          defaultBillingDetails: createJson.customerName
            ? {
                name: createJson.customerName,
              }
            : undefined,
        })
        if (init.error) {
          Alert.alert(
            'Stripe Payment Sheet',
            `${init.error.message ?? 'Could not initialize payment sheet.'}\n\nOpening browser checkout instead…`
          )
          startCheckout(false)
          return
        }

        const present = await presentPaymentSheet()
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
        Alert.alert(
          'CREA Pay',
          e instanceof Error ? e.message : 'Something went wrong. Trying browser checkout…'
        )
        startCheckout(false)
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
        const createRes = await fetch(`${base}/api/stripe/crea-pay/mobile-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ invoiceId: id }),
        })
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

        const platformSupported = await isPlatformPaySupported({
          applePay: { merchantCountryCode: 'DE' },
        } as PlatformPaySupportArg)
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
        const confirm = await confirmPlatformPayPayment(createJson.clientSecret, {
          applePay: {
            merchantCountryCode: 'DE',
            currencyCode: (createJson.currency || 'EUR').toUpperCase(),
            cartItems: [{ label: 'CREA invoice', amount, paymentType: PlatformPay.PaymentType.Immediate }],
          },
        })
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
        Alert.alert('Apple Pay', e instanceof Error ? e.message : 'Something went wrong. Trying browser checkout…')
        startCheckout(true)
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
                  Recommended opens full CREA Pay with payment method selection (incl. company cards). On the iOS
                  Simulator, Apple Pay is usually unavailable—use Pay now or browser checkout.
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

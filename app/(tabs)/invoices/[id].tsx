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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isCeoProfile, resolveAppRole } from '@/lib/profileRole'
import { openInvoiceApplePayOnWeb, openInvoicePayOnWeb } from '@/lib/creaWeb'
import {
  formatDate,
  formatDateTime,
  money,
  invoiceStatusLabel,
  statusVariant,
} from '@/lib/invoiceFormatting'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { invoiceBadgeStyles, statusBadgeFor } from '@/lib/invoiceStyles'

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

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [viewerRole, setViewerRole] = useState<'company' | 'freelancer' | 'ceo' | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [paymentSyncPending, setPaymentSyncPending] = useState(false)
  const [paymentSyncTimedOut, setPaymentSyncTimedOut] = useState(false)
  const [lastPaymentCheckAt, setLastPaymentCheckAt] = useState<Date | null>(null)
  const pollAttemptsRef = useRef(0)
  const MAX_PAYMENT_SYNC_POLLS = 20

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

  const refreshInvoiceStatusOnce = useCallback(async (): Promise<string | null> => {
    if (!id || typeof id !== 'string') return null
    const { data, error } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    const nextStatus = String((data as { status?: string }).status ?? '').toLowerCase() || null
    if (nextStatus) {
      setInvoice((prev) => (prev ? { ...prev, status: nextStatus } : prev))
    }
    setLastPaymentCheckAt(new Date())
    return nextStatus
  }, [id])

  const openCreaPay = () => {
    if (!id || typeof id !== 'string') return
    const ok = openInvoicePayOnWeb(id)
    if (!ok) {
      Alert.alert(
        'CREA Pay not configured',
        'Set EXPO_PUBLIC_CREA_WEB_URL (or EXPO_PUBLIC_CREA_PAY_URL) to open the payment flow.'
      )
      return
    }
    setPaymentSyncPending(true)
    setPaymentSyncTimedOut(false)
    pollAttemptsRef.current = 0
  }

  const openApplePayQuick = () => {
    if (!id || typeof id !== 'string') return
    const ok = openInvoiceApplePayOnWeb(id)
    if (!ok) {
      Alert.alert(
        'CREA Pay not configured',
        'Set EXPO_PUBLIC_CREA_WEB_URL (or EXPO_PUBLIC_CREA_PAY_URL) to open the payment flow.'
      )
      return
    }
    setPaymentSyncPending(true)
    setPaymentSyncTimedOut(false)
    pollAttemptsRef.current = 0
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

  const status = String(invoice.status ?? '')
  const sb = statusBadgeFor(statusVariant(status))

  const detailRows: { label: string; value: string }[] = [
    { label: 'Invoice no.', value: str(invoice.invoice_number) || '—' },
    { label: 'Title', value: str(invoice.title) || '—' },
    { label: 'Description', value: str(invoice.description) || '—' },
    { label: 'Due date', value: formatDate(str(invoice.due_date)) },
    { label: 'Created', value: formatDateTime(str(invoice.created_at)) },
    { label: 'Updated', value: formatDateTime(str(invoice.updated_at)) },
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
            {str(invoice.title) || str(invoice.invoice_number) || 'Invoice'}
          </Text>
          <View style={[styles.statusBadge, sb.wrap]}>
            <Text style={[invoiceBadgeStyles.statusText, sb.text]}>{invoiceStatusLabel(status)}</Text>
          </View>
        </View>

        <Text style={styles.bigAmount}>{money(num(invoice.amount), str(invoice.currency))}</Text>

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
                <TouchableOpacity
                  style={[styles.actionBtnPrimary, statusBusy && styles.dim]}
                  disabled={statusBusy}
                  onPress={openCreaPay}
                >
                  <Text style={styles.actionBtnPrimaryText}>Pay now (recommended)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, statusBusy && styles.dim]}
                  disabled={statusBusy}
                  onPress={openApplePayQuick}
                >
                  <Text style={styles.actionBtnText}>Quick pay with Apple Pay</Text>
                </TouchableOpacity>
                <Text style={styles.flowHint}>
                  Recommended opens full CREA Pay with payment method selection (incl. company cards).
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
          </View>
        )}
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
})

import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isCeoProfile, resolveAppRole } from '@/lib/profileRole'
import {
  formatDate,
  formatDateTime,
  money,
  invoiceStatusLabel,
  statusVariant,
} from '@/lib/invoiceFormatting'
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
              <TouchableOpacity
                style={[styles.actionBtnPrimary, statusBusy && styles.dim]}
                disabled={statusBusy}
                onPress={() => setInvoiceStatus('paid')}
              >
                <Text style={styles.actionBtnPrimaryText}>Mark as paid</Text>
              </TouchableOpacity>
            )}
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
})

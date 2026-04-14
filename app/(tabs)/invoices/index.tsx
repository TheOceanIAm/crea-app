import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatDate, invoiceStatusLabel, money, statusVariant } from '@/lib/invoiceFormatting'
import { invoiceBadgeStyles, statusBadgeFor } from '@/lib/invoiceStyles'

type InvoiceRow = {
  id: string
  status: string
  amount: number | null
  currency?: string | null
  due_date?: string | null
  created_at?: string | null
  title?: string | null
  description?: string | null
  invoice_number?: string | null
}

export default function InvoicesListScreen() {
  const router = useRouter()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [perspective, setPerspective] = useState<'company' | 'freelancer' | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      setRefreshing(false)
      return
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = isCompanyProfile(resolveAppRole(profile?.role, user)) ? 'company' : 'freelancer'
    setPerspective(role)

    let q = supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (role === 'company') {
      q = q.eq('company_id', user.id)
    } else {
      q = q.eq('freelancer_id', user.id)
    }

    const { data, error: err } = await q

    if (err) {
      setError(err.message)
      setRows([])
    } else {
      setRows((data as InvoiceRow[]) ?? [])
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = () => {
    setRefreshing(true)
    load()
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.replace('/(tabs)/dashboard')}
          hitSlop={12}
        >
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Dashboard</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.headerRow}>
        <Text style={styles.title}>Invoices</Text>
        <View style={styles.headerRight}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{rows.length} items</Text>
          </View>
          {perspective === 'freelancer' ? (
            <TouchableOpacity
              style={styles.newBtn}
              onPress={() => router.push('/(tabs)/invoices/new')}
              activeOpacity={0.75}
            >
              <Text style={styles.newBtnText}>+ New</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {perspective && (
        <Text style={styles.hint}>
          {perspective === 'company'
            ? 'Received from freelancers'
            : 'Invoices you send to clients'}
        </Text>
      )}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Couldn’t load invoices</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>
            In Supabase, ensure the invoices table has company_id and freelancer_id columns (depending on role).
          </Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFDC00" />
        }
        renderItem={({ item }) => {
          const sb = statusBadgeFor(statusVariant(item.status))
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => router.push(`/(tabs)/invoices/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.invoiceTitle} numberOfLines={2}>
                  {item.title || item.description || item.invoice_number || 'Invoice'}
                </Text>
                <View style={[styles.statusBadge, sb.wrap]}>
                  <Text style={[invoiceBadgeStyles.statusText, sb.text]}>{invoiceStatusLabel(item.status)}</Text>
                </View>
              </View>
              <Text style={styles.amount}>{money(item.amount, item.currency)}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>Due: {formatDate(item.due_date)}</Text>
                <Text style={styles.meta}>{formatDate(item.created_at)}</Text>
              </View>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No invoices yet</Text>
              <Text style={styles.emptySub}>When rows exist in Supabase, they’ll show up here.</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  topBar: { paddingHorizontal: 12, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 8 },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 28, fontWeight: '900', color: '#ffffff', letterSpacing: 1, flex: 1 },
  badge: { backgroundColor: 'rgba(255,220,0,0.12)', borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  newBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newBtnText: { color: '#0a0a0a', fontSize: 12, fontWeight: '800' },
  badgeText: { color: '#FFDC00', fontSize: 11, fontWeight: '700' },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', paddingHorizontal: 20, marginBottom: 16 },
  errorBox: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,80,80,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.25)',
  },
  errorTitle: { color: '#ff8888', fontWeight: '700', marginBottom: 6 },
  errorText: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginBottom: 8 },
  errorHint: { color: 'rgba(255,255,255,0.35)', fontSize: 11, lineHeight: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  invoiceTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#ffffff' },
  statusBadge: { borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  amount: { fontSize: 22, fontWeight: '800', color: '#FFDC00', marginBottom: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  emptyWrap: { paddingTop: 48, paddingHorizontal: 12, alignItems: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.45)', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySub: { color: 'rgba(255,255,255,0.25)', fontSize: 13, textAlign: 'center', lineHeight: 18 },
})

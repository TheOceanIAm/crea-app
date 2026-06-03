import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useSegments } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatDate, invoiceStatusLabel, money, statusVariant } from '@/lib/invoiceFormatting'
import { invoiceBadgeStyles, statusBadgeFor } from '@/lib/invoiceStyles'
import {
  cacheInvoicesList,
  loadInvoicesListCache,
  readCachedInvoicesList,
  type InvoiceListRow,
  type InvoiceBudgetOverview,
  type InvoiceMonthlyPoint,
  type ReadyInvoiceJob,
} from '@/lib/invoicesListLoad'
import { peekWarmedOverview } from '@/lib/warmAppCaches'

type InvoiceRow = InvoiceListRow
type BudgetOverview = InvoiceBudgetOverview
type MonthlyPoint = InvoiceMonthlyPoint

function readInitialInvoices() {
  const uid = peekWarmedOverview()?.userId
  if (!uid) {
    return {
      loading: true,
      rows: [] as InvoiceRow[],
      perspective: null as 'company' | 'freelancer' | null,
      budgetOverview: null as BudgetOverview | null,
      showBudgetOverview: false,
      monthlyPaid: [] as MonthlyPoint[],
      annualBudgetAmount: '',
      annualBudgetCurrency: 'EUR',
      annualBudgetYear: String(new Date().getFullYear()),
      invoicingAllowed: true,
      readyToInvoice: [] as ReadyInvoiceJob[],
    }
  }
  const cached = readCachedInvoicesList(uid)
  if (!cached) {
    return {
      loading: true,
      rows: [] as InvoiceRow[],
      perspective: null as 'company' | 'freelancer' | null,
      budgetOverview: null as BudgetOverview | null,
      showBudgetOverview: false,
      monthlyPaid: [] as MonthlyPoint[],
      annualBudgetAmount: '',
      annualBudgetCurrency: 'EUR',
      annualBudgetYear: String(new Date().getFullYear()),
      invoicingAllowed: true,
      readyToInvoice: [] as ReadyInvoiceJob[],
    }
  }
  return {
    loading: false,
    rows: cached.rows,
    perspective: cached.perspective,
    budgetOverview: cached.budgetOverview,
    showBudgetOverview: cached.showBudgetOverview,
    monthlyPaid: cached.monthlyPaid,
    annualBudgetAmount: cached.annualBudgetAmount,
    annualBudgetCurrency: cached.annualBudgetCurrency,
    annualBudgetYear: cached.annualBudgetYear,
    invoicingAllowed: cached.invoicingAllowed,
    readyToInvoice: cached.readyToInvoice,
  }
}

function timeAgo(str: string) {
  const t = new Date(str).getTime()
  if (Number.isNaN(t)) return 'now'
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function applyInvoicesCache(
  cached: ReturnType<typeof readInitialInvoices>,
  setters: {
    setRows: (v: InvoiceRow[]) => void
    setPerspective: (v: 'company' | 'freelancer' | null) => void
    setBudgetOverview: (v: BudgetOverview | null) => void
    setShowBudgetOverview: (v: boolean) => void
    setMonthlyPaid: (v: MonthlyPoint[]) => void
    setAnnualBudgetAmount: (v: string) => void
    setAnnualBudgetCurrency: (v: string) => void
    setAnnualBudgetYear: (v: string) => void
    setInvoicingAllowed: (v: boolean) => void
    setReadyToInvoice: (v: ReadyInvoiceJob[]) => void
    setError: (v: string | null) => void
  }
) {
  setters.setRows(cached.rows)
  setters.setPerspective(cached.perspective)
  setters.setBudgetOverview(cached.budgetOverview)
  setters.setShowBudgetOverview(cached.showBudgetOverview)
  setters.setMonthlyPaid(cached.monthlyPaid)
  setters.setAnnualBudgetAmount(cached.annualBudgetAmount)
  setters.setAnnualBudgetCurrency(cached.annualBudgetCurrency)
  setters.setAnnualBudgetYear(cached.annualBudgetYear)
  setters.setInvoicingAllowed(cached.invoicingAllowed)
  setters.setReadyToInvoice(cached.readyToInvoice)
  setters.setError(null)
}

export default function InvoicesListScreen() {
  const router = useRouter()
  const segments = useSegments()
  const boot = useRef(readInitialInvoices()).current
  const lastFetchedAt = useRef(boot.loading ? 0 : Date.now())
  const [rows, setRows] = useState<InvoiceRow[]>(boot.rows)
  const [loading, setLoading] = useState(boot.loading)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [perspective, setPerspective] = useState<'company' | 'freelancer' | null>(boot.perspective)
  const [budgetOverview, setBudgetOverview] = useState<BudgetOverview | null>(boot.budgetOverview)
  const [showBudgetOverview, setShowBudgetOverview] = useState(boot.showBudgetOverview)
  const [monthlyPaid, setMonthlyPaid] = useState<MonthlyPoint[]>(boot.monthlyPaid)
  const [annualBudgetAmount, setAnnualBudgetAmount] = useState(boot.annualBudgetAmount)
  const [annualBudgetCurrency, setAnnualBudgetCurrency] = useState(boot.annualBudgetCurrency)
  const [annualBudgetYear, setAnnualBudgetYear] = useState(boot.annualBudgetYear)
  const [savingAnnualBudget, setSavingAnnualBudget] = useState(false)
  const [invoicingAllowed, setInvoicingAllowed] = useState(boot.invoicingAllowed)
  const [readyToInvoice, setReadyToInvoice] = useState<ReadyInvoiceJob[]>(boot.readyToInvoice)

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && lastFetchedAt.current > 0 && Date.now() - lastFetchedAt.current < 30_000) {
      setLoading(false)
      setRefreshing(false)
      return
    }
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      setRefreshing(false)
      return
    }

    const cached = readCachedInvoicesList(user.id)
    if (cached && loading) {
      applyInvoicesCache(
        {
          loading: false,
          rows: cached.rows,
          perspective: cached.perspective,
          budgetOverview: cached.budgetOverview,
          showBudgetOverview: cached.showBudgetOverview,
          monthlyPaid: cached.monthlyPaid,
          annualBudgetAmount: cached.annualBudgetAmount,
          annualBudgetCurrency: cached.annualBudgetCurrency,
          annualBudgetYear: cached.annualBudgetYear,
          invoicingAllowed: cached.invoicingAllowed,
          readyToInvoice: cached.readyToInvoice,
        },
        {
          setRows,
          setPerspective,
          setBudgetOverview,
          setShowBudgetOverview,
          setMonthlyPaid,
          setAnnualBudgetAmount,
          setAnnualBudgetCurrency,
          setAnnualBudgetYear,
          setInvoicingAllowed,
          setReadyToInvoice,
          setError,
        }
      )
    }

    const data = await loadInvoicesListCache(user)
    applyInvoicesCache(
      {
        loading: false,
        rows: data.rows,
        perspective: data.perspective,
        budgetOverview: data.budgetOverview,
        showBudgetOverview: data.showBudgetOverview,
        monthlyPaid: data.monthlyPaid,
        annualBudgetAmount: data.annualBudgetAmount,
        annualBudgetCurrency: data.annualBudgetCurrency,
        annualBudgetYear: data.annualBudgetYear,
        invoicingAllowed: data.invoicingAllowed,
        readyToInvoice: data.readyToInvoice,
      },
      {
        setRows,
        setPerspective,
        setBudgetOverview,
        setShowBudgetOverview,
        setMonthlyPaid,
        setAnnualBudgetAmount,
        setAnnualBudgetCurrency,
        setAnnualBudgetYear,
        setInvoicingAllowed,
        setReadyToInvoice,
        setError,
      }
    )
    if (data.error) setError(data.error)
    cacheInvoicesList(user.id, data)
    lastFetchedAt.current = Date.now()
    setLoading(false)
    setRefreshing(false)
  }, [loading])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const onChange = () => void load({ force: true })
      channel = supabase
        .channel(`finance-ready-${user.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, onChange)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects' }, onChange)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invoices' }, onChange)
        .subscribe()
    })()
    return () => {
      if (channel) void supabase.removeChannel(channel)
    }
  }, [load])

  const onRefresh = () => {
    setRefreshing(true)
    void load({ force: true })
  }

  const saveAnnualBudget = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const rawAmount = annualBudgetAmount.trim()
    const parsedAmount = rawAmount === '' ? null : Number(rawAmount.replace(',', '.'))
    if (parsedAmount != null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      Alert.alert('Budget', 'Please enter a valid non-negative yearly budget.')
      return
    }
    const parsedYear = Number(annualBudgetYear.trim())
    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 3000) {
      Alert.alert('Budget', 'Please enter a valid budget year (e.g. 2026).')
      return
    }
    const currency = annualBudgetCurrency.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'EUR'
    setSavingAnnualBudget(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        annual_budget_amount: parsedAmount,
        annual_budget_currency: currency,
        annual_budget_year: parsedYear,
      })
      .eq('id', user.id)
    setSavingAnnualBudget(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    Alert.alert('Saved', 'Annual budget was updated.')
    await load()
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (perspective === 'freelancer' && !invoicingAllowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/feed')}
            hitSlop={12}
          >
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backLabel}>Dashboard</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.upgradeCenter}>
          <Text style={styles.upgradeTitle}>Invoicing is a Pro feature</Text>
          <Text style={styles.upgradeSub}>
            Upgrade to Pro to track earnings and see when completed projects are ready to invoice on creaservices.de.
          </Text>
          <TouchableOpacity
            style={styles.upgradeBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/paywall')}
          >
            <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const hideFinanceDashboardBack =
    perspective === 'freelancer' &&
    segments[0] === '(tabs)' &&
    segments.length === 2 &&
    segments[1] === 'invoices'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {hideFinanceDashboardBack ? null : (
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/feed')}
            hitSlop={12}
          >
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backLabel}>Dashboard</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{perspective === 'freelancer' ? 'Finance' : 'Invoices'}</Text>
          {perspective === 'freelancer' ? (
            <Text style={styles.titleSub}>Invoices & earnings</Text>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {rows.length + readyToInvoice.length} {rows.length + readyToInvoice.length === 1 ? 'item' : 'items'}
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {perspective && (
              <Text style={styles.hint}>
                {perspective === 'company'
                  ? 'Received from freelancers'
                  : 'Paid work, pending payouts, and projects ready to bill'}
              </Text>
            )}
            {showBudgetOverview && budgetOverview ? (
              <View style={styles.overviewCard}>
                {perspective === 'company' ? (
                  <>
                    <Text style={styles.overviewTitleCompany}>Budget overview</Text>
                    <Text style={styles.overviewSubCompany}>All invoices and active job listings</Text>
                    <View style={styles.kpiStackCompany}>
                      <View style={[styles.kpiStatRow, styles.kpiStatRowCompany, styles.kpiRowAccentPaid]}>
                        <View style={styles.kpiStatLeft}>
                          <Text style={styles.kpiStatLabel}>Total paid</Text>
                          <Text style={styles.kpiStatMeta}>
                            {rows.filter((r) => String(r.status).toLowerCase() === 'paid').length} invoices
                          </Text>
                        </View>
                        <Text style={[styles.kpiStatValue, styles.kpiStatValuePaid]}>
                          {money(budgetOverview.paidInvoices, budgetOverview.currency)}
                        </Text>
                      </View>
                      <View style={[styles.kpiStatRow, styles.kpiStatRowCompany, styles.kpiRowAccentPending]}>
                        <View style={styles.kpiStatLeft}>
                          <Text style={styles.kpiStatLabel}>Pending</Text>
                          <Text style={styles.kpiStatMeta}>
                            {rows.filter((r) => String(r.status).toLowerCase() === 'pending').length} invoices
                          </Text>
                        </View>
                        <Text style={[styles.kpiStatValue, styles.kpiStatValuePendingMuted]}>
                          {money(budgetOverview.pendingCosts, budgetOverview.currency)}
                        </Text>
                      </View>
                      <View style={[styles.kpiStatRow, styles.kpiStatRowCompany, styles.kpiRowAccentOverdue]}>
                        <View style={styles.kpiStatLeft}>
                          <Text style={styles.kpiStatLabel}>Overdue</Text>
                          <Text style={styles.kpiStatMeta}>
                            {rows.filter((r) => String(r.status).toLowerCase() === 'overdue').length} invoices
                          </Text>
                        </View>
                        <Text style={[styles.kpiStatValue, styles.kpiStatValueOverdue]}>
                          {money(budgetOverview.overdueCosts, budgetOverview.currency)}
                        </Text>
                      </View>
                      <View style={[styles.kpiStatRow, styles.kpiStatRowCompany, styles.kpiStatRowLast, styles.kpiRowAccentActive]}>
                        <View style={styles.kpiStatLeft}>
                          <Text style={styles.kpiStatLabel}>Est. active</Text>
                          <Text style={styles.kpiStatMeta}>{budgetOverview.projects} open jobs/projects</Text>
                        </View>
                        <Text style={[styles.kpiStatValue, styles.kpiStatValueActive]}>
                          {money(budgetOverview.activeProjectCosts, budgetOverview.currency)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.legendBar} />
                    <View style={styles.legendRow}>
                      <Text style={styles.legendItem}>● Paid</Text>
                      <Text style={styles.legendItem}>● Pending</Text>
                      <Text style={styles.legendItem}>● Overdue</Text>
                      <Text style={styles.legendItem}>● Est. Active</Text>
                    </View>
                    <View style={styles.yearBudgetWrap}>
                      <Text style={styles.overviewLabel}>
                        Annual budget {budgetOverview.annualBudgetYear ? `(${budgetOverview.annualBudgetYear})` : ''}
                      </Text>
                      <Text style={styles.yearBudgetValue}>
                        {budgetOverview.annualBudget != null
                          ? money(budgetOverview.annualBudget, budgetOverview.currency)
                          : 'Not set in profile'}
                      </Text>
                      <Text style={styles.overviewMeta}>
                        Caused costs: {money(budgetOverview.causedCosts, budgetOverview.currency)}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.overviewTitleFreelancer}>Earnings</Text>
                    <Text style={styles.overviewSubFreelancer}>
                      {new Date().getFullYear()} · paid invoices
                    </Text>
                    <View style={styles.earningsSimpleCard}>
                      <View style={styles.earningsSimpleCol}>
                        <Text style={styles.earningsSimpleLabel}>Earned</Text>
                        <Text style={[styles.earningsSimpleAmount, styles.earningsSimpleEarned]}>
                          {money(budgetOverview.paidInvoices, budgetOverview.currency)}
                        </Text>
                      </View>
                      <View style={styles.earningsSimpleDivider} />
                      <View style={styles.earningsSimpleCol}>
                        <Text style={styles.earningsSimpleLabel}>Pending</Text>
                        <Text style={[styles.earningsSimpleAmount, styles.earningsSimplePending]}>
                          {money(budgetOverview.pendingCosts, budgetOverview.currency)}
                        </Text>
                        <Text style={styles.earningsSimpleMeta}>
                          {rows.filter((r) => String(r.status).toLowerCase() === 'pending').length} open
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            ) : null}
            {perspective === 'freelancer' && readyToInvoice.length > 0 ? (
              <View style={styles.readyListWrap}>
                {readyToInvoice.map((r) => (
                  <View key={r.jobId} style={[styles.readyAlertCard, styles.readyAlertCardActive]}>
                    <View style={styles.readyKickerRow}>
                      <Text style={styles.readyKicker}>Ready to invoice</Text>
                      <Text style={styles.readyTime}>{timeAgo(r.completedAt)}</Text>
                    </View>
                    <Text style={styles.readyCardTitle} numberOfLines={2}>
                      {r.title}
                    </Text>
                    <Text style={styles.readyCardBody}>Project completed — you can send an invoice.</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {perspective === 'freelancer' && showBudgetOverview ? (
              <Text style={styles.sectionLabel}>Invoice history</Text>
            ) : null}
            {perspective === 'company' ? (
              <View style={styles.annualBudgetCard}>
                <Text style={styles.annualBudgetTitle}>Annual budget</Text>
                <Text style={styles.annualBudgetSub}>
                  Set yearly company budget here (moved from Settings to Invoice and bank).
                </Text>
                <Text style={styles.fieldLabel}>Year</Text>
                <TextInput
                  style={styles.input}
                  value={annualBudgetYear}
                  onChangeText={setAnnualBudgetYear}
                  placeholder="2026"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  keyboardType="number-pad"
                />
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Currency</Text>
                <TextInput
                  style={styles.input}
                  value={annualBudgetCurrency}
                  onChangeText={setAnnualBudgetCurrency}
                  placeholder="EUR"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="characters"
                />
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Amount</Text>
                <TextInput
                  style={styles.input}
                  value={annualBudgetAmount}
                  onChangeText={setAnnualBudgetAmount}
                  placeholder="e.g. 500000"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity
                  style={[styles.saveAnnualBudgetBtn, savingAnnualBudget && styles.btnDisabled]}
                  onPress={saveAnnualBudget}
                  disabled={savingAnnualBudget}
                >
                  {savingAnnualBudget ? (
                    <ActivityIndicator color="#0a0a0a" />
                  ) : (
                    <Text style={styles.saveAnnualBudgetText}>Save annual budget</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>Couldn’t load invoices</Text>
                <Text style={styles.errorText}>{error}</Text>
                <Text style={styles.errorHint}>
                  In Supabase, ensure the invoices table has company_id and freelancer_id columns (depending on role).
                </Text>
              </View>
            ) : null}
          </>
        }
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
                  {item.invoice_project_title || item.title || item.description || item.invoice_number || 'Invoice'}
                </Text>
                {(item.version_no ?? 1) > 1 ? (
                  <Text style={styles.versionTag}>v{item.version_no}</Text>
                ) : null}
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
              <Text style={styles.emptyText}>
                {perspective === 'freelancer' && readyToInvoice.length > 0
                  ? 'No sent invoices yet'
                  : 'No invoices yet'}
              </Text>
              <Text style={styles.emptySub}>
                {perspective === 'freelancer' && readyToInvoice.length > 0
                  ? 'Sent invoices will appear here.'
                  : 'When rows exist in Supabase, they’ll show up here.'}
              </Text>
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
  upgradeCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  upgradeTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 10 },
  upgradeSub: { fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 21, marginBottom: 20 },
  upgradeBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  upgradeBtnText: { fontSize: 14, fontWeight: '800', color: '#0a0a0a' },
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
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: 28, fontWeight: '900', color: '#ffffff', letterSpacing: 1 },
  titleSub: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.38)',
  },
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
  readyListWrap: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  readyAlertCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    padding: 12,
    marginBottom: 10,
  },
  readyAlertCardActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,220,0,0.15)',
  },
  readyKickerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  readyKicker: { color: '#FFDC00', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  readyTime: { color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  readyCardTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  readyCardBody: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 17 },
  overviewCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0f0f10',
  },
  overviewTitleCompany: {
    color: '#FFDC00',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  overviewSubCompany: { color: 'rgba(255,255,255,0.42)', fontSize: 12, marginBottom: 12, lineHeight: 17 },
  overviewTitleFreelancer: {
    color: '#FFDC00',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  overviewSubFreelancer: { color: 'rgba(255,255,255,0.38)', fontSize: 12, marginBottom: 12, lineHeight: 17 },
  earningsSimpleCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  earningsSimpleCol: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'flex-start',
  },
  earningsSimpleDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 12,
  },
  earningsSimpleLabel: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  earningsSimpleAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  earningsSimpleEarned: { color: '#00df6f' },
  earningsSimplePending: { color: '#FFDC00' },
  earningsSimpleMeta: {
    marginTop: 4,
    fontSize: 11,
    color: 'rgba(255,255,255,0.32)',
  },
  sectionLabel: {
    marginHorizontal: 20,
    marginBottom: 10,
    color: 'rgba(255,255,255,0.38)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  kpiStackCompany: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121214',
    marginBottom: 12,
    overflow: 'hidden',
  },
  kpiStackFreelancer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121214',
    marginBottom: 12,
    overflow: 'hidden',
  },
  kpiStatRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  kpiStatRowCompany: { paddingVertical: 11 },
  kpiStatRowLast: { borderBottomWidth: 0 },
  kpiRowAccentPaid: { borderLeftWidth: 3, borderLeftColor: 'rgba(0,230,120,0.5)' },
  kpiRowAccentPending: { borderLeftWidth: 3, borderLeftColor: 'rgba(255,220,0,0.45)' },
  kpiRowAccentOverdue: { borderLeftWidth: 3, borderLeftColor: 'rgba(255,90,90,0.5)' },
  kpiRowAccentActive: { borderLeftWidth: 3, borderLeftColor: 'rgba(120,120,255,0.45)' },
  kpiStatLeft: { flex: 1, minWidth: 0 },
  kpiStatLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  kpiStatMeta: { color: 'rgba(255,255,255,0.32)', fontSize: 11, marginTop: 3 },
  kpiStatValue: { fontSize: 17, fontWeight: '800', color: 'rgba(255,255,255,0.88)' },
  kpiStatValueEarned: { color: '#00df6f' },
  kpiStatValuePaid: { color: '#00df6f' },
  kpiStatValuePendingMuted: { color: '#FFDC00' },
  kpiStatValueOverdue: { color: '#ff6b6b' },
  kpiStatValueActive: { color: '#9b9dff' },
  legendBar: { height: 14, borderRadius: 8, backgroundColor: '#1a1a1b', marginBottom: 10 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 12 },
  legendItem: { color: 'rgba(255,255,255,0.42)', fontSize: 10 },
  monthlyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121214',
    padding: 12,
    marginBottom: 12,
  },
  monthlyTitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 10,
  },
  monthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 6,
    justifyContent: 'space-between',
  },
  monthCell: { width: '23%', maxWidth: 72, alignItems: 'center', gap: 5 },
  monthBar: { width: '100%', maxWidth: 28, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
  monthLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: '700' },
  historyHeaderFreelancer: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 4,
  },
  historyTitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  historyCta: { color: '#FFDC00', fontSize: 12, fontWeight: '600' },
  yearBudgetWrap: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 12,
  },
  overviewLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginBottom: 4 },
  yearBudgetValue: { fontSize: 16, fontWeight: '800', color: '#ffffff', marginBottom: 6 },
  overviewMeta: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
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
  list: { paddingHorizontal: 20, paddingBottom: 160, gap: 10 },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  invoiceTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#ffffff' },
  versionTag: {
    marginRight: 8,
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,220,0,0.85)',
  },
  statusBadge: { borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  amount: { fontSize: 22, fontWeight: '800', color: '#FFDC00', marginBottom: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  emptyWrap: { paddingTop: 48, paddingHorizontal: 12, alignItems: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.45)', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySub: { color: 'rgba(255,255,255,0.25)', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  annualBudgetCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111111',
    padding: 14,
  },
  annualBudgetTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 6 },
  annualBudgetSub: { fontSize: 12, color: 'rgba(255,255,255,0.38)', lineHeight: 18, marginBottom: 14 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  fieldLabelSpaced: { marginTop: 12 },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
  },
  saveAnnualBudgetBtn: {
    marginTop: 14,
    borderRadius: 100,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#FFDC00',
  },
  btnDisabled: { opacity: 0.45 },
  saveAnnualBudgetText: { color: '#0a0a0a', fontSize: 15, fontWeight: '800' },
})

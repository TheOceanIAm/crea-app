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
import { useFocusEffect } from '@react-navigation/native'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatDate, invoiceStatusLabel, money, statusVariant } from '@/lib/invoiceFormatting'
import { invoiceBadgeStyles, statusBadgeFor } from '@/lib/invoiceStyles'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'

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

type ProjectBudgetRow = {
  budget_amount: number | null
  budget_currency?: string | null
  status?: string | null
}

type BudgetOverview = {
  annualBudget: number | null
  annualBudgetYear: number | null
  projects: number
  activeProjectCosts: number
  pendingCosts: number
  paidInvoices: number
  causedCosts: number
  overdueCosts: number
  currency: string
}

type MonthlyPoint = { label: string; value: number }

function computeBudgetOverview(
  projectRows: ProjectBudgetRow[],
  invoiceRows: InvoiceRow[],
  profileBudget: { amount: number | null; year: number | null; currency?: string | null }
): BudgetOverview {
  const out: BudgetOverview = {
    annualBudget: profileBudget.amount,
    annualBudgetYear: profileBudget.year,
    projects: 0,
    activeProjectCosts: 0,
    pendingCosts: 0,
    paidInvoices: 0,
    causedCosts: 0,
    overdueCosts: 0,
    currency: (profileBudget.currency || 'EUR').toUpperCase(),
  }
  for (const row of projectRows) {
    const amount = typeof row.budget_amount === 'number' ? row.budget_amount : 0
    const status = String(row.status ?? '').toLowerCase()
    out.projects += 1
    if (row.budget_currency) out.currency = row.budget_currency.toUpperCase()
    if (status === 'completed' || status === 'done' || status === 'closed' || status === 'archived') {
      // ignore closed projects for "active project costs"
    } else {
      out.activeProjectCosts += amount
    }
  }
  for (const row of invoiceRows) {
    const amount = typeof row.amount === 'number' ? row.amount : 0
    const status = String(row.status ?? '').toLowerCase()
    if (row.currency) out.currency = row.currency.toUpperCase()
    if (status === 'paid') out.paidInvoices += amount
    if (status !== 'draft') out.causedCosts += amount
    if (status === 'pending') out.pendingCosts += amount
    if (status === 'overdue') out.overdueCosts += amount
    if (status === 'pending' && row.due_date) {
      const due = new Date(row.due_date)
      if (!Number.isNaN(due.getTime()) && due.getTime() < Date.now()) out.overdueCosts += amount
    }
  }
  return out
}

function computeMonthlyPaid(invoices: InvoiceRow[]): MonthlyPoint[] {
  const labels = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const totals = new Array(12).fill(0) as number[]
  for (const row of invoices) {
    if (String(row.status ?? '').toLowerCase() !== 'paid') continue
    const amount = typeof row.amount === 'number' ? row.amount : 0
    const created = row.created_at ? new Date(row.created_at) : null
    if (!created || Number.isNaN(created.getTime())) continue
    totals[created.getMonth()] += amount
  }
  return labels.map((label, i) => ({ label, value: totals[i] }))
}

export default function InvoicesListScreen() {
  const router = useRouter()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [perspective, setPerspective] = useState<'company' | 'freelancer' | null>(null)
  const [budgetOverview, setBudgetOverview] = useState<BudgetOverview | null>(null)
  const [showBudgetOverview, setShowBudgetOverview] = useState(false)
  const [monthlyPaid, setMonthlyPaid] = useState<MonthlyPoint[]>([])

  const load = useCallback(async () => {
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      setRefreshing(false)
      return
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const resolvedRole = resolveAppRole(profile?.role, user)
    const role = isCompanyProfile(resolvedRole) ? 'company' : 'freelancer'
    setPerspective(role)
    const freelancerPlan = resolveFreelancerPlanFromUser(user)
    const budgetAllowed = role === 'company' || !isFreelancerWorkspaceOnlyPlan(freelancerPlan)
    setShowBudgetOverview(budgetAllowed)

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
      setMonthlyPaid(computeMonthlyPaid((data as InvoiceRow[]) ?? []))
    }

    if (budgetAllowed) {
      let projectQuery = supabase
        .from('projects')
        .select('budget_amount, budget_currency, status')
        .limit(200)
      if (role === 'company') {
        projectQuery = projectQuery.eq('company_id', user.id)
      } else {
        projectQuery = projectQuery.eq('freelancer_id', user.id)
      }
      const { data: projectRows, error: projectErr } = await projectQuery
      if (!projectErr) {
        const { data: profileBudgetRow } = await supabase
          .from('profiles')
          .select('annual_budget_amount, annual_budget_currency, annual_budget_year')
          .eq('id', user.id)
          .maybeSingle()
        const budgetAmount =
          typeof profileBudgetRow?.annual_budget_amount === 'number'
            ? profileBudgetRow.annual_budget_amount
            : null
        const budgetYear =
          typeof profileBudgetRow?.annual_budget_year === 'number'
            ? profileBudgetRow.annual_budget_year
            : null
        setBudgetOverview(
          computeBudgetOverview((projectRows as ProjectBudgetRow[]) ?? [], (data as InvoiceRow[]) ?? [], {
            amount: budgetAmount,
            year: budgetYear,
            currency:
              typeof profileBudgetRow?.annual_budget_currency === 'string'
                ? profileBudgetRow.annual_budget_currency
                : null,
          })
        )
      } else {
        setBudgetOverview(null)
      }
    } else {
      setBudgetOverview(null)
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

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

      {showBudgetOverview && budgetOverview ? (
        <View style={styles.overviewCard}>
          {perspective === 'company' ? (
            <>
              <Text style={styles.overviewTitle}>Budget overview</Text>
              <Text style={styles.overviewSub}>All invoices and active job listings</Text>

              <View style={styles.kpiGrid}>
                <View style={[styles.kpiCard, styles.kpiPaid]}>
                  <Text style={styles.kpiLabel}>Total paid</Text>
                  <Text style={[styles.kpiValue, styles.kpiValuePaid]}>
                    {money(budgetOverview.paidInvoices, budgetOverview.currency)}
                  </Text>
                  <Text style={styles.kpiMeta}>{rows.filter((r) => String(r.status).toLowerCase() === 'paid').length} invoices</Text>
                </View>
                <View style={[styles.kpiCard, styles.kpiPending]}>
                  <Text style={styles.kpiLabel}>Pending</Text>
                  <Text style={[styles.kpiValue, styles.kpiValuePending]}>
                    {money(budgetOverview.pendingCosts, budgetOverview.currency)}
                  </Text>
                  <Text style={styles.kpiMeta}>
                    {rows.filter((r) => String(r.status).toLowerCase() === 'pending').length} invoices
                  </Text>
                </View>
                <View style={[styles.kpiCard, styles.kpiOverdue]}>
                  <Text style={styles.kpiLabel}>Overdue</Text>
                  <Text style={[styles.kpiValue, styles.kpiValueOverdue]}>
                    {money(budgetOverview.overdueCosts, budgetOverview.currency)}
                  </Text>
                  <Text style={styles.kpiMeta}>
                    {rows.filter((r) => String(r.status).toLowerCase() === 'overdue').length} invoices
                  </Text>
                </View>
                <View style={[styles.kpiCard, styles.kpiActive]}>
                  <Text style={styles.kpiLabel}>Est. active</Text>
                  <Text style={[styles.kpiValue, styles.kpiValueActive]}>
                    {money(budgetOverview.activeProjectCosts, budgetOverview.currency)}
                  </Text>
                  <Text style={styles.kpiMeta}>{budgetOverview.projects} open jobs/projects</Text>
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
              <Text style={styles.overviewTitle}>Earnings overview</Text>
              <Text style={styles.overviewSub}>
                Year to date{budgetOverview.annualBudgetYear ? ` · ${budgetOverview.annualBudgetYear}` : ''}
              </Text>
              <View style={styles.kpiGridFreelancer}>
                <View style={styles.kpiCardFreelancer}>
                  <Text style={styles.kpiLabel}>Total earned</Text>
                  <Text style={[styles.kpiValue, styles.kpiValuePending]}>
                    {money(budgetOverview.paidInvoices, budgetOverview.currency)}
                  </Text>
                  <Text style={styles.kpiMeta}>
                    {budgetOverview.annualBudgetYear ? `${budgetOverview.annualBudgetYear} YTD` : 'YTD'}
                  </Text>
                </View>
                <View style={styles.kpiCardFreelancer}>
                  <Text style={styles.kpiLabel}>Pending</Text>
                  <Text style={styles.kpiValue}>{money(budgetOverview.pendingCosts, budgetOverview.currency)}</Text>
                  <Text style={styles.kpiMeta}>
                    {rows.filter((r) => String(r.status).toLowerCase() === 'pending').length} invoices
                  </Text>
                </View>
                <View style={styles.kpiCardFreelancer}>
                  <Text style={styles.kpiLabel}>Avg per project</Text>
                  <Text style={styles.kpiValue}>
                    {rows.filter((r) => String(r.status).toLowerCase() === 'paid').length > 0
                      ? money(
                          budgetOverview.paidInvoices /
                            rows.filter((r) => String(r.status).toLowerCase() === 'paid').length,
                          budgetOverview.currency
                        )
                      : '—'}
                  </Text>
                  <Text style={styles.kpiMeta}>
                    {rows.filter((r) => String(r.status).toLowerCase() === 'paid').length} paid
                  </Text>
                </View>
              </View>
              <View style={styles.monthlyCard}>
                <Text style={styles.monthlyTitle}>Monthly earnings (paid)</Text>
                <View style={styles.monthsRow}>
                  {monthlyPaid.map((m) => (
                    <View key={m.label} style={styles.monthCol}>
                      <View style={styles.monthBar} />
                      <Text style={styles.monthLabel}>{m.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>Invoice history</Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/invoices/new')}>
                  <Text style={styles.historyCta}>Send invoice (completed projects) →</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
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
  overviewCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0f0f10',
  },
  overviewTitle: {
    color: '#FFDC00',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  overviewSub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginBottom: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  kpiGridFreelancer: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  kpiCard: {
    width: '48%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    backgroundColor: '#121212',
  },
  kpiCardFreelancer: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 12,
    backgroundColor: '#141416',
  },
  kpiPaid: { borderColor: 'rgba(0,230,120,0.35)' },
  kpiPending: { borderColor: 'rgba(255,220,0,0.35)' },
  kpiOverdue: { borderColor: 'rgba(255,90,90,0.35)' },
  kpiActive: { borderColor: 'rgba(120,120,255,0.35)' },
  kpiLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  kpiValue: { fontSize: 27, fontWeight: '900', marginBottom: 4 },
  kpiValuePaid: { color: '#00df6f' },
  kpiValuePending: { color: '#FFDC00' },
  kpiValueOverdue: { color: '#ff5a5a' },
  kpiValueActive: { color: '#888bff' },
  kpiMeta: { color: 'rgba(255,255,255,0.35)', fontSize: 12 },
  legendBar: { height: 14, borderRadius: 8, backgroundColor: '#1a1a1b', marginBottom: 10 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 12 },
  legendItem: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  monthlyCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#141416',
    padding: 12,
    marginBottom: 12,
  },
  monthlyTitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    marginBottom: 10,
  },
  monthsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  monthCol: { alignItems: 'center', gap: 6 },
  monthBar: { width: 22, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)' },
  monthLabel: { color: 'rgba(255,255,255,0.25)', fontSize: 10 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyTitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  historyCta: { color: '#d8bf46', fontSize: 13, fontWeight: '600' },
  yearBudgetWrap: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 12,
  },
  overviewLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginBottom: 4 },
  yearBudgetValue: { fontSize: 20, fontWeight: '900', color: '#ffffff', marginBottom: 6 },
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

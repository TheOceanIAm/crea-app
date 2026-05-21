import { useCallback, useEffect, useState } from 'react'
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
  company_id?: string | null
  freelancer_id?: string | null
  job_id?: string | null
  title?: string | null
  description?: string | null
  invoice_number?: string | null
  invoice_project_title?: string | null
  payment_reference?: string | null
  version_no?: number | null
  version_group_id?: string | null
  is_latest?: boolean | null
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

type ReadyInvoiceJob = {
  jobId: string
  title: string
  clientName: string
  isSolo: boolean
}

function pickNewestInvoice(a: InvoiceRow, b: InvoiceRow): InvoiceRow {
  const av = typeof a.version_no === 'number' ? a.version_no : 1
  const bv = typeof b.version_no === 'number' ? b.version_no : 1
  if (av !== bv) return av > bv ? a : b
  const at = a.created_at ? new Date(a.created_at).getTime() : 0
  const bt = b.created_at ? new Date(b.created_at).getTime() : 0
  return at >= bt ? a : b
}

function collapseToLatestInvoices(rows: InvoiceRow[]): InvoiceRow[] {
  if (rows.length <= 1) return rows
  const map = new Map<string, InvoiceRow>()
  for (const row of rows) {
    const groupId =
      (typeof row.version_group_id === 'string' && row.version_group_id.trim()) ||
      (typeof row.job_id === 'string' && row.job_id.trim()
        ? `job:${row.job_id}|f:${String(row.freelancer_id ?? '')}|c:${String(row.company_id ?? '')}`
        : `id:${row.id}`)
    const prev = map.get(groupId)
    if (!prev) {
      map.set(groupId, row)
      continue
    }
    map.set(groupId, pickNewestInvoice(prev, row))
  }
  return Array.from(map.values()).sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0
    return bt - at
  })
}

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
  const segments = useSegments()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [perspective, setPerspective] = useState<'company' | 'freelancer' | null>(null)
  const [budgetOverview, setBudgetOverview] = useState<BudgetOverview | null>(null)
  const [showBudgetOverview, setShowBudgetOverview] = useState(false)
  const [monthlyPaid, setMonthlyPaid] = useState<MonthlyPoint[]>([])
  const [annualBudgetAmount, setAnnualBudgetAmount] = useState('')
  const [annualBudgetCurrency, setAnnualBudgetCurrency] = useState('EUR')
  const [annualBudgetYear, setAnnualBudgetYear] = useState(String(new Date().getFullYear()))
  const [savingAnnualBudget, setSavingAnnualBudget] = useState(false)
  const [readyToInvoice, setReadyToInvoice] = useState<ReadyInvoiceJob[]>([])

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
      const latestRows = collapseToLatestInvoices((data as InvoiceRow[]) ?? [])
      setRows(latestRows)
      setMonthlyPaid(computeMonthlyPaid(latestRows))
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
        if (role === 'company') {
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
          setAnnualBudgetAmount(budgetAmount != null ? String(budgetAmount) : '')
          setAnnualBudgetCurrency(
            typeof profileBudgetRow?.annual_budget_currency === 'string'
              ? profileBudgetRow.annual_budget_currency.toUpperCase()
              : 'EUR'
          )
          setAnnualBudgetYear(budgetYear != null ? String(budgetYear) : String(new Date().getFullYear()))
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
          /** Freelancers: no annual company budget — earnings overview only (invoice + project totals). */
          setAnnualBudgetAmount('')
          setAnnualBudgetCurrency('EUR')
          setAnnualBudgetYear(String(new Date().getFullYear()))
          setBudgetOverview(
            computeBudgetOverview((projectRows as ProjectBudgetRow[]) ?? [], (data as InvoiceRow[]) ?? [], {
              amount: null,
              year: null,
              currency: null,
            })
          )
        }
      } else {
        setBudgetOverview(null)
      }
    } else {
      setBudgetOverview(null)
    }

    let readyJobs: ReadyInvoiceJob[] = []
    if (!isCompanyProfile(resolvedRole)) {
      const { data: apps } = await supabase
        .from('job_applications')
        .select('job_id')
        .eq('freelancer_id', user.id)
        .eq('status', 'accepted')
      const crewIds = [...new Set((apps ?? []).map((a) => a.job_id).filter(Boolean))] as string[]
      const { data: soloJobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('company_id', user.id)
        .eq('is_solo_workspace', true)
      const soloIds = (soloJobs ?? []).map((j) => j.id)
      const allJobIds = [...new Set([...crewIds, ...soloIds])]
      if (allJobIds.length > 0) {
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id, title, company_id, project_status, status, is_solo_workspace')
          .in('id', allJobIds)
        const completed = (jobs ?? []).filter((j) => {
          const ps = String(j.project_status ?? '').toLowerCase()
          const st = String(j.status ?? '').toLowerCase()
          return ps === 'completed' || st === 'closed'
        })
        const { data: invRows } = await supabase
          .from('invoices')
          .select('job_id')
          .eq('freelancer_id', user.id)
          .not('job_id', 'is', null)
        const invoiced = new Set((invRows ?? []).map((r) => r.job_id).filter(Boolean) as string[])
        const missing = completed.filter((j) => j.id && !invoiced.has(j.id))
        const companyIds = [...new Set(missing.map((j) => j.company_id).filter(Boolean))] as string[]
        let names: Record<string, string> = {}
        if (companyIds.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id, name').in('id', companyIds)
          names = Object.fromEntries((profs ?? []).map((p) => [p.id, (p.name || 'Client').trim()]))
        }
        readyJobs = missing.map((j) => ({
          jobId: j.id,
          title: (j.title || 'Project').trim(),
          clientName: j.company_id ? names[String(j.company_id)] ?? 'Client' : 'Client',
          isSolo: Boolean(j.is_solo_workspace) && j.company_id === user.id,
        }))
      }
    }
    setReadyToInvoice(readyJobs)

    setLoading(false)
    setRefreshing(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const onRefresh = () => {
    setRefreshing(true)
    load()
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
                  : 'Paid work, pending payouts, and invoices you sent'}
              </Text>
            )}
            {perspective === 'freelancer' && readyToInvoice.length > 0 ? (
              <View style={styles.readySection}>
                <Text style={styles.readySectionTitle}>Ready to send</Text>
                <Text style={styles.readySectionSub}>
                  The client marked these projects completed — you can send an invoice now.
                </Text>
                {readyToInvoice.map((r) => (
                  <TouchableOpacity
                    key={r.jobId}
                    style={styles.readyCard}
                    activeOpacity={0.75}
                    onPress={() =>
                      router.push(`/(tabs)/invoices/new?jobId=${encodeURIComponent(r.jobId)}`)
                    }
                  >
                    <Text style={styles.readyCardTitle} numberOfLines={2}>
                      {r.title}
                    </Text>
                    <Text style={styles.readyCardMeta}>
                      {r.isSolo ? 'Private project' : r.clientName}
                    </Text>
                    <Text style={styles.readyCardCta}>Create invoice →</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
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
                    <Text style={styles.overviewTitleFreelancer}>Earnings overview</Text>
                    <Text style={styles.overviewSubFreelancer}>
                      Year to date · {new Date().getFullYear()}
                    </Text>
                    <View style={styles.kpiStackFreelancer}>
                      <View style={styles.kpiStatRow}>
                        <View style={styles.kpiStatLeft}>
                          <Text style={styles.kpiStatLabel}>Total earned</Text>
                          <Text style={styles.kpiStatMeta}>
                            {new Date().getFullYear()} YTD
                          </Text>
                        </View>
                        <Text style={[styles.kpiStatValue, styles.kpiStatValueEarned]}>
                          {money(budgetOverview.paidInvoices, budgetOverview.currency)}
                        </Text>
                      </View>
                      <View style={styles.kpiStatRow}>
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
                      <View style={[styles.kpiStatRow, styles.kpiStatRowLast]}>
                        <View style={styles.kpiStatLeft}>
                          <Text style={styles.kpiStatLabel}>Avg per project</Text>
                          <Text style={styles.kpiStatMeta}>
                            {rows.filter((r) => String(r.status).toLowerCase() === 'paid').length} paid
                          </Text>
                        </View>
                        <Text style={styles.kpiStatValue}>
                          {rows.filter((r) => String(r.status).toLowerCase() === 'paid').length > 0
                            ? money(
                                budgetOverview.paidInvoices /
                                  rows.filter((r) => String(r.status).toLowerCase() === 'paid').length,
                                budgetOverview.currency
                              )
                            : '—'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.monthlyCard}>
                      <Text style={styles.monthlyTitle}>Monthly earnings (paid)</Text>
                      <View style={styles.monthsGrid}>
                        {monthlyPaid.map((m) => (
                          <View key={m.label} style={styles.monthCell}>
                            <View
                              style={[
                                styles.monthBar,
                                m.value > 0 && { backgroundColor: 'rgba(255,220,0,0.45)' },
                              ]}
                            />
                            <Text style={styles.monthLabel}>{m.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                    <View style={styles.historyHeaderFreelancer}>
                      <Text style={styles.historyTitle}>Invoice history</Text>
                      <TouchableOpacity onPress={() => router.push('/(tabs)/invoices/new')}>
                        <Text style={styles.historyCta}>Send invoice (completed projects) →</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
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
  readySection: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
    backgroundColor: 'rgba(255,220,0,0.06)',
  },
  readySectionTitle: {
    color: '#FFDC00',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  readySectionSub: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  readyCard: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 10,
  },
  readyCardTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 4 },
  readyCardMeta: { fontSize: 12, color: 'rgba(255,255,255,0.38)', marginBottom: 8 },
  readyCardCta: { fontSize: 13, fontWeight: '700', color: '#FFDC00' },
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
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  overviewSubFreelancer: { color: 'rgba(255,255,255,0.42)', fontSize: 12, marginBottom: 12, lineHeight: 17 },
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

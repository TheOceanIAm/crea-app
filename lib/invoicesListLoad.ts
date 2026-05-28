import type { User } from '@supabase/supabase-js'
import { getCache, setCache } from '@/lib/appCache'
import { freelancerHasInvoicing, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'
import { getAuthUser } from '@/lib/getAuthUser'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { supabase } from '@/lib/supabase'

export type InvoiceListRow = {
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

export type InvoiceBudgetOverview = {
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

export type InvoiceMonthlyPoint = { label: string; value: number }

export type ReadyInvoiceJob = {
  jobId: string
  title: string
  clientName: string
  isSolo: boolean
}

export type InvoicesListCache = {
  rows: InvoiceListRow[]
  perspective: 'company' | 'freelancer'
  budgetOverview: InvoiceBudgetOverview | null
  showBudgetOverview: boolean
  monthlyPaid: InvoiceMonthlyPoint[]
  annualBudgetAmount: string
  annualBudgetCurrency: string
  annualBudgetYear: string
  invoicingAllowed: boolean
  readyToInvoice: ReadyInvoiceJob[]
  error: string | null
}

const MEM_TTL_MS = 35_000
const DISK_TTL_MS = 24 * 60 * 60 * 1000

export function invoicesListCacheKey(userId: string): string {
  return `invoices-list:${userId}`
}

function invoicesListDiskKey(userId: string): string {
  return `crea:invoices-list:${userId}`
}

export function readCachedInvoicesList(userId: string): InvoicesListCache | null {
  return getCache<InvoicesListCache>(invoicesListCacheKey(userId))
}

export function cacheInvoicesList(userId: string, data: InvoicesListCache): void {
  setCache(invoicesListCacheKey(userId), data, MEM_TTL_MS)
}

export async function hydrateInvoicesListFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<InvoicesListCache>(invoicesListDiskKey(userId))
  if (!hit) return false
  cacheInvoicesList(userId, hit)
  return true
}

async function persistInvoicesListToDisk(userId: string, data: InvoicesListCache): Promise<void> {
  await writePersistedCache(invoicesListDiskKey(userId), data, DISK_TTL_MS)
}

function pickNewestInvoice(a: InvoiceListRow, b: InvoiceListRow): InvoiceListRow {
  const av = typeof a.version_no === 'number' ? a.version_no : 1
  const bv = typeof b.version_no === 'number' ? b.version_no : 1
  if (av !== bv) return av > bv ? a : b
  const at = a.created_at ? new Date(a.created_at).getTime() : 0
  const bt = b.created_at ? new Date(b.created_at).getTime() : 0
  return at >= bt ? a : b
}

function collapseToLatestInvoices(rows: InvoiceListRow[]): InvoiceListRow[] {
  if (rows.length <= 1) return rows
  const map = new Map<string, InvoiceListRow>()
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
  invoiceRows: InvoiceListRow[],
  profileBudget: { amount: number | null; year: number | null; currency?: string | null }
): InvoiceBudgetOverview {
  const out: InvoiceBudgetOverview = {
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
    if (status !== 'completed' && status !== 'done' && status !== 'closed' && status !== 'archived') {
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

function computeMonthlyPaid(invoices: InvoiceListRow[]): InvoiceMonthlyPoint[] {
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

export async function loadInvoicesListCache(user: User): Promise<InvoicesListCache> {
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const resolvedRole = resolveAppRole(profile?.role, user)
  const role = isCompanyProfile(resolvedRole) ? 'company' : 'freelancer'
  const freelancerPlan = resolveFreelancerPlanFromUser(user)
  const budgetAllowed = role === 'company' || freelancerHasInvoicing(freelancerPlan)
  const canUseInvoicing = role === 'company' || freelancerHasInvoicing(freelancerPlan)

  let q = supabase.from('invoices').select('*').order('created_at', { ascending: false }).limit(50)
  q = role === 'company' ? q.eq('company_id', user.id) : q.eq('freelancer_id', user.id)

  const { data, error: err } = await q
  if (err) {
    return {
      rows: [],
      perspective: role,
      budgetOverview: null,
      showBudgetOverview: budgetAllowed,
      monthlyPaid: [],
      annualBudgetAmount: '',
      annualBudgetCurrency: 'EUR',
      annualBudgetYear: String(new Date().getFullYear()),
      invoicingAllowed: canUseInvoicing,
      readyToInvoice: [],
      error: err.message,
    }
  }

  const latestRows = collapseToLatestInvoices((data as InvoiceListRow[]) ?? [])
  const monthlyPaid = computeMonthlyPaid(latestRows)

  let budgetOverview: InvoiceBudgetOverview | null = null
  let annualBudgetAmount = ''
  let annualBudgetCurrency = 'EUR'
  let annualBudgetYear = String(new Date().getFullYear())

  if (budgetAllowed) {
    let projectQuery = supabase.from('projects').select('budget_amount, budget_currency, status').limit(200)
    projectQuery = role === 'company' ? projectQuery.eq('company_id', user.id) : projectQuery.eq('freelancer_id', user.id)
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
        annualBudgetAmount = budgetAmount != null ? String(budgetAmount) : ''
        annualBudgetCurrency =
          typeof profileBudgetRow?.annual_budget_currency === 'string'
            ? profileBudgetRow.annual_budget_currency.toUpperCase()
            : 'EUR'
        annualBudgetYear = budgetYear != null ? String(budgetYear) : String(new Date().getFullYear())
        budgetOverview = computeBudgetOverview((projectRows as ProjectBudgetRow[]) ?? [], (data as InvoiceListRow[]) ?? [], {
          amount: budgetAmount,
          year: budgetYear,
          currency:
            typeof profileBudgetRow?.annual_budget_currency === 'string'
              ? profileBudgetRow.annual_budget_currency
              : null,
        })
      } else {
        budgetOverview = computeBudgetOverview((projectRows as ProjectBudgetRow[]) ?? [], (data as InvoiceListRow[]) ?? [], {
          amount: null,
          year: null,
          currency: null,
        })
      }
    }
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

  return {
    rows: latestRows,
    perspective: role,
    budgetOverview,
    showBudgetOverview: budgetAllowed,
    monthlyPaid,
    annualBudgetAmount,
    annualBudgetCurrency,
    annualBudgetYear,
    invoicingAllowed: canUseInvoicing,
    readyToInvoice: readyJobs,
    error: null,
  }
}

let inflight: Promise<void> | null = null

export async function prefetchInvoicesList(userId: string): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (!readCachedInvoicesList(userId)) {
      await hydrateInvoicesListFromDisk(userId)
    }
    const user = await getAuthUser()
    if (!user || user.id !== userId) return
    const data = await loadInvoicesListCache(user)
    cacheInvoicesList(userId, data)
    void persistInvoicesListToDisk(userId, data)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

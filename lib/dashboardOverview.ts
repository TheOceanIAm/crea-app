import type { LucideIcon } from 'lucide-react-native'
import {
  Briefcase,
  CalendarDays,
  ClipboardList,
  Layers,
  MessageCircle,
  PlusCircle,
  Receipt,
  Settings2,
  Users,
} from 'lucide-react-native'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import {
  resolveCompanySubscriptionPlanFromSources,
  type CompanySubscriptionPlanDb,
} from '@/lib/companyPlanFromSession'
import {
  canFreelancerCreatePrivateProjects,
  freelancerHasInvoicing,
  isFreelancerPro,
  isFreelancerTalentPoolPlan,
  resolveFreelancerPlanFromUser,
  type FreelancerPlan,
} from '@/lib/freelancerPlan'
import { isCompanyPro } from '@/lib/company-plan'
import { getCache, setCache } from '@/lib/appCache'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { loadCeoPlatformUserStats } from '@/lib/ceoPlatformMetrics'
import { ensureOwnProfileName } from '@/lib/ensureProfileName'
import { CREA_API_TAB_TIMEOUT_MS, fetchCreaApi } from '@/lib/creaApiFetch'
import { companySubscriptionPlanForDb } from '@/lib/companyPlanFromSession'
import { normalizeFreelancerPlanKey } from '@/lib/billingDisplay'
import { isCeoUserId } from '@/lib/ceo'

const DISK_OVERVIEW_TTL_MS = 24 * 60 * 60 * 1000

function dashboardOverviewDiskKey(userId: string) {
  return `crea:dashboard_overview:${userId}`
}

export type IncomeTotals = { paid: number; incoming: number; overdue: number; currency: string }

export type DashboardStatCard = { label: string; value: string; sub: string }

export type DashboardQuickAction = {
  label: string
  icon: LucideIcon
  href?: `/(tabs)/${string}`
  /** Company-only tools that live on the web app (e.g. contracts). */
  webPath?: string
  disabled?: boolean
  hint?: string
}

export type CeoSnapshot = {
  ok: boolean
  all_users: number
  new_users: number
  active_jobs: number
  completed_jobs: number
}

export type DashboardOverviewData = {
  userId: string
  name: string
  role: string | null
  avatarUrl: string | null
  stats: DashboardStatCard[]
  income: IncomeTotals | null
  ceoSnap: CeoSnapshot | null
  ceoRpcError: string | null
  freelancerPlan: FreelancerPlan
  companyPlan: CompanySubscriptionPlanDb
  trialEndsAt: string | null
  accountCreatedAt: string | null
  hasStripeCustomer: boolean
}

export function userHasStripeCustomer(user: User): boolean {
  const m = user.user_metadata as Record<string, unknown> | undefined
  const cid = m?.stripe_customer_id
  const sid = m?.stripe_subscription_id
  return (
    (typeof cid === 'string' && cid.trim().length > 0) ||
    (typeof sid === 'string' && sid.trim().length > 0)
  )
}

export type DashboardOverviewCache = Omit<DashboardOverviewData, 'userId'>

export function dashboardOverviewCacheKey(userId: string) {
  return `dashboard:${userId}`
}

export function computeIncomeTotals(
  rows: { amount: number | null; currency: string | null; status: string | null; due_date: string | null }[]
): IncomeTotals {
  const out: IncomeTotals = { paid: 0, incoming: 0, overdue: 0, currency: 'EUR' }
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  for (const r of rows) {
    const amt = typeof r.amount === 'number' ? r.amount : 0
    const st = (r.status || '').toLowerCase()
    if (r.currency) out.currency = r.currency
    if (st === 'paid') {
      out.paid += amt
      continue
    }
    if (st === 'overdue') {
      out.overdue += amt
      continue
    }
    if (st === 'pending' || st === 'draft') {
      const due = r.due_date ? new Date(r.due_date) : null
      if (due && due < startOfToday && st === 'pending') out.overdue += amt
      else out.incoming += amt
    }
  }
  return out
}

export function parseCeoSnapshot(raw: unknown): CeoSnapshot {
  const empty: CeoSnapshot = {
    ok: false,
    all_users: 0,
    new_users: 0,
    active_jobs: 0,
    completed_jobs: 0,
  }
  if (!raw || typeof raw !== 'object') return empty
  const o = raw as Record<string, unknown>
  return {
    ok: o.ok === true,
    all_users: Number(o.all_users) || 0,
    new_users: Number(o.new_users) || 0,
    active_jobs: Number(o.active_jobs) || 0,
    completed_jobs: Number(o.completed_jobs) || 0,
  }
}

/** Transient RN/Supabase blips — never show these as a CEO error banner. */
export function sanitizeCeoRpcError(msg: string | null | undefined): string | null {
  if (!msg || !String(msg).trim()) return null
  const soft = /network request failed|failed to fetch|timeout|aborted|timed out/i.test(String(msg))
  return soft ? null : String(msg)
}

export function quickActionsForRole(
  role: string | null,
  opts?: { freelancerPlan?: FreelancerPlan; companyPlan?: CompanySubscriptionPlanDb }
): DashboardQuickAction[] {
  if (isCompanyProfile(role ?? undefined)) {
    return [
      { label: 'Post project', icon: PlusCircle, href: '/(tabs)/company-post-job' },
      { label: 'Applications', icon: ClipboardList, href: '/(tabs)/company-applications' },
      { label: 'Projects', icon: Briefcase, href: '/(tabs)/workspace-projects' },
      { label: 'Talent pool', icon: Users, href: '/(tabs)/talent-pool' },
      { label: 'Messages', icon: MessageCircle, href: '/(tabs)/messages' },
      { label: 'Invoices', icon: Receipt, href: '/(tabs)/invoices' },
      { label: 'Settings', icon: Settings2, href: '/(tabs)/profile' },
    ]
  }
  if (isCeoProfile(role ?? undefined)) {
    return [
      { label: 'Job pool', icon: Briefcase, href: '/(tabs)/jobs' },
      { label: 'Messages', icon: MessageCircle, href: '/(tabs)/messages' },
      { label: 'Invoices', icon: Receipt, href: '/(tabs)/invoices' },
      { label: 'Settings', icon: Settings2, href: '/(tabs)/profile' },
    ]
  }
  const base: DashboardQuickAction[] = [
    { label: 'Browse jobs', icon: Briefcase, href: '/(tabs)/jobs' },
    { label: 'Messages', icon: MessageCircle, href: '/(tabs)/messages' },
  ]
  if (isFreelancerProfile(role ?? undefined)) {
    const plan = opts?.freelancerPlan ?? 'free'
    const pro = isFreelancerPro(plan)
    if (pro && canFreelancerCreatePrivateProjects(plan)) {
      base.push({ label: 'Projects', icon: Layers, href: '/(tabs)/workspace-projects' })
    } else {
      base.push({
        label: 'Projects',
        icon: Layers,
        href: '/(tabs)/workspace-projects',
        disabled: true,
        hint: 'Pro plan',
      })
    }
    if (isFreelancerTalentPoolPlan(plan)) {
      base.push({ label: 'Talent pool', icon: Users, href: '/(tabs)/talent-pool' })
    } else {
      base.push({
        label: 'Talent pool',
        icon: Users,
        href: '/(tabs)/talent-pool',
        disabled: true,
        hint: 'Pro plan',
      })
    }
    base.push({
      label: 'Invoices',
      icon: Receipt,
      href: '/(tabs)/invoices',
      disabled: !freelancerHasInvoicing(plan),
      hint: pro ? undefined : 'Pro plan',
    })
    base.push({ label: 'Availability', icon: CalendarDays, href: '/(tabs)/availability' })
  } else {
    base.push({ label: 'Invoices', icon: Receipt, href: '/(tabs)/invoices' })
  }
  base.push({ label: 'Settings', icon: Settings2, href: '/(tabs)/profile' })
  return base
}

const INVOICE_STATS_LIMIT = 500

async function fetchDashboardOverviewFromApi(
  userId: string
): Promise<DashboardOverviewData | null> {
  try {
    type ApiPayload = Omit<DashboardOverviewData, 'userId'> & {
      companyPlan?: string
      freelancerPlan?: string
    }
    const { data, error } = await fetchCreaApi<ApiPayload>('/api/app/dashboard-overview', {
      method: 'GET',
      timeoutMs: CREA_API_TAB_TIMEOUT_MS,
    })
    if (error || !data || typeof data.name !== 'string') {
      if (__DEV__ && error) console.warn('[dashboard] API', error)
      return null
    }
    return {
      userId,
      name: data.name,
      role: data.role ?? null,
      avatarUrl: data.avatarUrl ?? null,
      stats: Array.isArray(data.stats) ? data.stats : [],
      income: data.income ?? null,
      ceoSnap: data.ceoSnap ?? null,
      ceoRpcError: sanitizeCeoRpcError(data.ceoRpcError),
      freelancerPlan: normalizeFreelancerPlanKey(data.freelancerPlan),
      companyPlan: companySubscriptionPlanForDb(data.companyPlan),
      trialEndsAt: data.trialEndsAt ?? null,
      accountCreatedAt: data.accountCreatedAt ?? null,
      hasStripeCustomer: Boolean(data.hasStripeCustomer),
    }
  } catch (e) {
    if (__DEV__) console.warn('[dashboard] API exception', e)
    return null
  }
}

async function loadDashboardOverviewLocal(userId: string): Promise<DashboardOverviewData | null> {
  const [{ data: profile }, { data: { user } }] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, role, avatar_url, trial_ends_at, created_at, subscription_tier')
      .eq('id', userId)
      .single(),
    supabase.auth.getUser(),
  ])
  if (!user || user.id !== userId) return null

  const resolvedName = await ensureOwnProfileName(user)
  const resolvedRole = resolveAppRole(profile?.role, user)
  const resolvedFreelancerPlan = isFreelancerProfile(resolvedRole)
    ? resolveFreelancerPlanFromUser(user)
    : 'free'
  const av = (profile?.avatar_url as string | undefined)?.trim()
  const avatarUrl = av && /^https?:\/\//i.test(av) ? av : null
  const name = resolvedName || profile?.name?.trim() || ''

  const trialEndsAt =
    typeof profile?.trial_ends_at === 'string' ? profile.trial_ends_at.trim() || null : null
  const accountCreatedAt =
    typeof profile?.created_at === 'string' ? profile.created_at.trim() || null : null

  const base: DashboardOverviewData = {
    userId,
    name,
    role: resolvedRole || null,
    avatarUrl,
    stats: [],
    income: null,
    ceoSnap: null,
    ceoRpcError: null,
    freelancerPlan: isFreelancerProfile(resolvedRole) ? resolvedFreelancerPlan : 'free',
    companyPlan: 'free',
    trialEndsAt,
    accountCreatedAt,
    hasStripeCustomer: userHasStripeCustomer(user),
  }

  if (isCeoProfile(resolvedRole) || isCeoUserId(userId)) {
    try {
      const [{ data: ceoData, error: ceoErr }, platformUsersResult] = await Promise.all([
        supabase.rpc('ceo_dashboard_snapshot'),
        loadCeoPlatformUserStats(supabase).catch((e) => {
          if (__DEV__) console.warn('[dashboard] ceo platform stats', e)
          return null
        }),
      ])
      const rpcSnap = parseCeoSnapshot(ceoData)
      const platformUsers = platformUsersResult
      const ceoSnap: CeoSnapshot = {
        ok: true,
        all_users: platformUsers?.allUsers || rpcSnap.all_users,
        new_users: platformUsers?.newUsers || rpcSnap.new_users,
        active_jobs: rpcSnap.active_jobs,
        completed_jobs: rpcSnap.completed_jobs,
      }
      // Prefer live numbers over a scary banner when either path succeeded.
      const hasAnyMetric =
        ceoSnap.all_users > 0 ||
        ceoSnap.new_users > 0 ||
        ceoSnap.active_jobs > 0 ||
        ceoSnap.completed_jobs > 0
      if (ceoErr && !rpcSnap.ok && !hasAnyMetric) {
        return {
          ...base,
          role: 'ceo',
          ceoSnap,
          ceoRpcError: sanitizeCeoRpcError(ceoErr.message || 'Could not load metrics'),
        }
      }
      return { ...base, role: 'ceo', ceoSnap, ceoRpcError: null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load metrics'
      if (__DEV__) console.warn('[dashboard] ceo load', e)
      return {
        ...base,
        role: 'ceo',
        ceoSnap: parseCeoSnapshot(null),
        ceoRpcError: sanitizeCeoRpcError(msg),
      }
    }
  }

  if (isCompanyProfile(resolvedRole)) {
    const [
      { count: jobCount },
      { count: invCount },
      { count: pendingAppsCount },
      { data: invs },
      { data: companyProfileRow },
    ] = await Promise.all([
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', userId)
        .eq('status', 'active'),
      supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', userId)
        .eq('status', 'pending'),
      supabase
        .from('job_applications')
        .select('id, jobs!inner(company_id)', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('jobs.company_id', userId),
      supabase
        .from('invoices')
        .select('amount, currency, status, due_date')
        .eq('company_id', userId)
        .order('created_at', { ascending: false })
        .limit(INVOICE_STATS_LIMIT),
      supabase.from('company_profiles').select('subscription_plan').eq('id', userId).maybeSingle(),
    ])
    const companyPlan = resolveCompanySubscriptionPlanFromSources(
      user,
      profile?.subscription_tier,
      companyProfileRow?.subscription_plan
    )
    const pendingApps = pendingAppsCount ?? 0
    return {
      ...base,
      companyPlan,
      stats: [
        { label: 'Active projects', value: String(jobCount ?? 0), sub: 'Open' },
        { label: 'Pending apps', value: String(pendingApps), sub: 'To review' },
        { label: 'Open invoices', value: String(invCount ?? 0), sub: 'Pending' },
      ],
      income: computeIncomeTotals(invs ?? []),
    }
  }

  if (!isFreelancerPro(resolvedFreelancerPlan)) {
    return {
      ...base,
      stats: [
        { label: 'Applications', value: '—', sub: 'Pro to apply' },
        { label: 'Profile views', value: '—', sub: 'Browse jobs on Free' },
      ],
      income: null,
      freelancerPlan: resolvedFreelancerPlan,
    }
  }

  const [{ count: appCount }, { count: viewCount }, { data: invs }] = await Promise.all([
    supabase
      .from('job_applications')
      .select('id', { count: 'exact', head: true })
      .eq('freelancer_id', userId)
      .eq('status', 'pending'),
    supabase
      .from('profile_views')
      .select('id', { count: 'exact', head: true })
      .eq('viewed_freelancer_id', userId),
    supabase
      .from('invoices')
      .select('amount, currency, status, due_date')
      .eq('freelancer_id', userId)
      .order('created_at', { ascending: false })
      .limit(INVOICE_STATS_LIMIT),
  ])

  return {
    ...base,
    stats: [
      { label: 'Applications', value: String(appCount ?? 0), sub: 'Pending' },
      { label: 'Profile views', value: String(viewCount ?? 0), sub: 'Total' },
    ],
    income: computeIncomeTotals(invs ?? []),
    freelancerPlan: resolvedFreelancerPlan,
  }
}

export async function loadDashboardOverview(
  userId: string
): Promise<DashboardOverviewData | null> {
  // CEO metrics are Supabase-native — skip web API (avoids RN "Network request failed" to creaservices).
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const metaRole = String(session?.user?.user_metadata?.role ?? '').toLowerCase()
  if (metaRole === 'ceo' || isCeoUserId(userId)) {
    return loadDashboardOverviewLocal(userId)
  }

  // Start local path immediately so a cold/hung API doesn't block the tab.
  const localPromise = loadDashboardOverviewLocal(userId)
  const fromApi = await fetchDashboardOverviewFromApi(userId)
  if (fromApi) return fromApi
  return localPromise
}

export function cacheDashboardOverview(data: DashboardOverviewData) {
  const { userId, ...rest } = data
  setCache(dashboardOverviewCacheKey(userId), rest, 120_000)
}

export function readCachedDashboardOverview(userId: string): DashboardOverviewData | null {
  const hit = getCache<DashboardOverviewCache>(dashboardOverviewCacheKey(userId))
  if (!hit) return null
  return { userId, ...hit, ceoRpcError: sanitizeCeoRpcError(hit.ceoRpcError) }
}

export async function hydrateDashboardOverviewFromDisk(
  userId: string
): Promise<DashboardOverviewData | null> {
  const hit = await readPersistedCache<DashboardOverviewCache>(dashboardOverviewDiskKey(userId))
  if (!hit) return null
  const data = { userId, ...hit, ceoRpcError: sanitizeCeoRpcError(hit.ceoRpcError) }
  cacheDashboardOverview(data)
  return data
}

export async function persistDashboardOverviewToDisk(data: DashboardOverviewData): Promise<void> {
  const { userId, ...rest } = data
  await writePersistedCache(dashboardOverviewDiskKey(userId), rest, DISK_OVERVIEW_TTL_MS)
}

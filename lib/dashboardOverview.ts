import type { LucideIcon } from 'lucide-react-native'
import {
  Briefcase,
  CalendarDays,
  ClipboardList,
  FileText,
  Layers,
  MessageCircle,
  PlusCircle,
  Receipt,
  Settings2,
  Shield,
  Users,
  Wallet,
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
  isFreelancerTalentPoolPlan,
  isFreelancerWorkspaceOnlyPlan,
  resolveFreelancerPlanFromUser,
  type FreelancerPlan,
} from '@/lib/freelancerPlan'
import { getCache, setCache } from '@/lib/appCache'

export type IncomeTotals = { paid: number; incoming: number; overdue: number; currency: string }

export type DashboardStatCard = { label: string; value: string; sub: string }

export type DashboardQuickAction = {
  label: string
  icon: LucideIcon
  href?: `/(tabs)/${string}`
  /** Company-only tools that live on the web app (contracts, Crea Pay, …). */
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

export function quickActionsForRole(
  role: string | null,
  opts?: { freelancerPlan?: FreelancerPlan; companyPlan?: CompanySubscriptionPlanDb }
): DashboardQuickAction[] {
  if (isCompanyProfile(role ?? undefined)) {
    const plan = opts?.companyPlan ?? 'studio'
    const businessPlus = plan === 'business' || plan === 'enterprise'
    return [
      { label: 'Post project', icon: PlusCircle, href: '/(tabs)/company-post-job' },
      { label: 'Applications', icon: ClipboardList, href: '/(tabs)/company-applications' },
      { label: 'Projects', icon: Briefcase, href: '/(tabs)/workspace-projects' },
      { label: 'Talent pool', icon: Users, href: '/(tabs)/talent-pool' },
      { label: 'Messages', icon: MessageCircle, href: '/(tabs)/messages' },
      { label: 'Invoices', icon: Receipt, href: '/(tabs)/invoices' },
      { label: 'Hiring tools', icon: Layers, href: '/(tabs)/company-hub' },
      { label: 'Contracts', icon: FileText, webPath: '/resources' },
      { label: 'Crea Pay', icon: Wallet, webPath: '/company-dashboard/payments' },
      {
        label: 'Legal partners',
        icon: Shield,
        webPath: '/company-dashboard/partners',
        disabled: !businessPlus,
        hint: businessPlus ? undefined : 'Business plan and above',
      },
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
    { label: 'Invoices', icon: Receipt, href: '/(tabs)/invoices' },
  ]
  if (isFreelancerProfile(role ?? undefined)) {
    if (opts?.freelancerPlan && isFreelancerWorkspaceOnlyPlan(opts.freelancerPlan)) {
      const starterHint = 'Included from Starter — upgrade on creaservices.de'
      return [
        { label: 'Projects', icon: Layers, href: '/(tabs)/workspace-projects' },
        {
          label: 'Browse jobs',
          icon: Briefcase,
          href: '/(tabs)/jobs',
          disabled: true,
          hint: starterHint,
        },
        {
          label: 'Messages',
          icon: MessageCircle,
          href: '/(tabs)/messages',
          disabled: true,
          hint: starterHint,
        },
        {
          label: 'Invoices',
          icon: Receipt,
          href: '/(tabs)/invoices',
          disabled: true,
          hint: starterHint,
        },
        {
          label: 'Talent pool',
          icon: Users,
          href: '/(tabs)/talent-pool',
          disabled: true,
          hint: 'Included with Pro — Starter unlocks the job pool',
        },
        {
          label: 'Availability',
          icon: CalendarDays,
          href: '/(tabs)/availability',
          disabled: true,
          hint: starterHint,
        },
        { label: 'Settings', icon: Settings2, href: '/(tabs)/profile' },
      ]
    }
    if (opts?.freelancerPlan && !isFreelancerWorkspaceOnlyPlan(opts.freelancerPlan)) {
      if (canFreelancerCreatePrivateProjects(opts.freelancerPlan)) {
        base.splice(1, 0, {
          label: 'Projects',
          icon: Layers,
          href: '/(tabs)/workspace-projects',
        })
      } else {
        base.splice(1, 0, {
          label: 'Projects',
          icon: Layers,
          href: '/(tabs)/workspace-projects',
          disabled: true,
          hint: 'Pro or Workspace plan',
        })
      }
    }
    if (opts?.freelancerPlan && isFreelancerTalentPoolPlan(opts.freelancerPlan)) {
      base.splice(2, 0, { label: 'Talent pool', icon: Users, href: '/(tabs)/talent-pool' })
    } else if (opts?.freelancerPlan && !isFreelancerWorkspaceOnlyPlan(opts.freelancerPlan)) {
      base.splice(2, 0, {
        label: 'Talent pool',
        icon: Users,
        href: '/(tabs)/talent-pool',
        disabled: true,
        hint: 'Only available for Pro users',
      })
    }
    base.push({ label: 'Availability', icon: CalendarDays, href: '/(tabs)/availability' })
  }
  base.push({ label: 'Settings', icon: Settings2, href: '/(tabs)/profile' })
  return base
}

export async function loadDashboardOverview(
  userId: string
): Promise<DashboardOverviewData | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role, avatar_url, trial_ends_at, created_at')
    .eq('id', userId)
    .single()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== userId) return null

  const resolvedRole = resolveAppRole(profile?.role, user)
  const resolvedFreelancerPlan = isFreelancerProfile(resolvedRole)
    ? resolveFreelancerPlanFromUser(user)
    : 'starter'
  const av = (profile?.avatar_url as string | undefined)?.trim()
  const avatarUrl = av && /^https?:\/\//i.test(av) ? av : null
  const name = profile?.name ?? ''

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
    freelancerPlan: isFreelancerProfile(resolvedRole) ? resolvedFreelancerPlan : 'starter',
    companyPlan: 'studio',
    trialEndsAt,
    accountCreatedAt,
    hasStripeCustomer: userHasStripeCustomer(user),
  }

  if (isCeoProfile(resolvedRole)) {
    const { data: ceoData, error: ceoErr } = await supabase.rpc('ceo_dashboard_snapshot')
    if (ceoErr) {
      return { ...base, ceoRpcError: ceoErr.message, ceoSnap: null }
    }
    return { ...base, ceoSnap: parseCeoSnapshot(ceoData), ceoRpcError: null }
  }

  if (isCompanyProfile(resolvedRole)) {
    const [
      { count: jobCount },
      { count: invCount },
      { data: myJobRows },
      { data: invs },
      { data: companyProfileRow },
    ] = await Promise.all([
      supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', userId)
        .eq('status', 'active'),
      supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', userId)
        .eq('status', 'pending'),
      supabase.from('jobs').select('id').eq('company_id', userId),
      supabase
        .from('invoices')
        .select('amount, currency, status, due_date')
        .eq('company_id', userId),
      supabase.from('company_profiles').select('subscription_plan').eq('id', userId).maybeSingle(),
    ])
    const companyPlan = resolveCompanySubscriptionPlanFromSources(
      user,
      profile?.subscription_tier,
      companyProfileRow?.subscription_plan
    )
    const jobIds = (myJobRows ?? []).map((r) => r.id as string).filter(Boolean)
    let pendingApps = 0
    if (jobIds.length > 0) {
      const { count: appCount } = await supabase
        .from('job_applications')
        .select('*', { count: 'exact', head: true })
        .in('job_id', jobIds)
        .eq('status', 'pending')
      pendingApps = appCount ?? 0
    }
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

  if (isFreelancerWorkspaceOnlyPlan(resolvedFreelancerPlan)) {
    return { ...base, stats: [], income: null, freelancerPlan: resolvedFreelancerPlan }
  }

  const [{ count: appCount }, { count: viewCount }, { data: invs }] = await Promise.all([
    supabase
      .from('job_applications')
      .select('*', { count: 'exact', head: true })
      .eq('freelancer_id', userId)
      .eq('status', 'pending'),
    supabase
      .from('profile_views')
      .select('*', { count: 'exact', head: true })
      .eq('viewed_freelancer_id', userId),
    supabase
      .from('invoices')
      .select('amount, currency, status, due_date')
      .eq('freelancer_id', userId),
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

export function cacheDashboardOverview(data: DashboardOverviewData) {
  const { userId, ...rest } = data
  setCache(dashboardOverviewCacheKey(userId), rest, 30_000)
}

export function readCachedDashboardOverview(userId: string): DashboardOverviewData | null {
  const hit = getCache<DashboardOverviewCache>(dashboardOverviewCacheKey(userId))
  if (!hit) return null
  return { userId, ...hit }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeFreelancerPlanKey } from '@/lib/billingDisplay'
import { companySubscriptionPlanForDb } from '@/lib/companyPlanFromSession'
import { getAllCeoUserIds } from '@/lib/ceo'
import {
  COMPANY_PLAN_PRICE_EUR,
  FREELANCER_PLAN_PRICE_EUR,
  formatCatalogPrice,
} from '@/lib/planCatalogPrices'

/** Real platform users: freelancer + company with login, excluding beta testers and CEO-as-freelancer. */
export type CeoPlatformUserStats = {
  allUsers: number
  newUsers: number
  freelancers: number
  companies: number
}

/** Live subscription counts — same basis as crea-services CEO dashboard MRR. */
export type CeoMrrCounts = {
  freelancerFree: number
  freelancerPro: number
  companyFree: number
  companyPro: number
}

export type CeoMrrTotals = CeoMrrCounts & {
  freelancerMrr: number
  companyMrr: number
  totalMrr: number
  totalSubs: number
}

function isRealFreelancerProfile(
  id: string,
  role: string | null | undefined,
  betaIds: Set<string>,
  ceoIds: Set<string>
): boolean {
  if (betaIds.has(id)) return false
  if (ceoIds.has(id)) return false
  return String(role ?? '').trim().toLowerCase() === 'freelancer'
}

function isRealCompanyProfile(id: string, role: string | null | undefined, betaIds: Set<string>): boolean {
  if (betaIds.has(id)) return false
  return String(role ?? '').trim().toLowerCase() === 'company'
}

async function loadBetaIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from('profiles').select('id').eq('beta_invite', true)
  return new Set((data ?? []).map((p: { id: string }) => p.id))
}

/** Count platform users the same way as crea-services/app/ceo-dashboard/page.tsx */
export async function loadCeoPlatformUserStats(
  supabase: SupabaseClient
): Promise<CeoPlatformUserStats> {
  const ceoIds = new Set(getAllCeoUserIds())
  const betaIds = await loadBetaIds(supabase)

  let freelancersQ = supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'freelancer')
  for (const id of ceoIds) {
    freelancersQ = freelancersQ.neq('id', id)
  }

  const [
    { count: freelancerRaw },
    { count: companyRaw },
    { count: betaFreelancerN },
    { count: betaCompanyN },
    { data: recentProfiles },
  ] = await Promise.all([
    freelancersQ,
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'company'),
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'freelancer')
      .eq('beta_invite', true),
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'company')
      .eq('beta_invite', true),
    supabase.from('profiles').select('id, role, created_at').eq('beta_invite', false),
  ])

  const freelancers = Math.max(0, (freelancerRaw ?? 0) - (betaFreelancerN ?? 0))
  const companies = Math.max(0, (companyRaw ?? 0) - (betaCompanyN ?? 0))

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  let newUsers = 0
  for (const row of recentProfiles ?? []) {
    const id = (row as { id: string }).id
    const role = (row as { role?: string | null }).role
    const createdAt = (row as { created_at?: string | null }).created_at
    const isFreelancer = isRealFreelancerProfile(id, role, betaIds, ceoIds)
    const isCompany = isRealCompanyProfile(id, role, betaIds)
    if (!isFreelancer && !isCompany) continue
    if (createdAt && new Date(createdAt).getTime() >= weekAgo) newUsers++
  }

  return {
    allUsers: freelancers + companies,
    newUsers,
    freelancers,
    companies,
  }
}

export async function loadCeoMrrCounts(supabase: SupabaseClient): Promise<CeoMrrCounts> {
  const { data, error } = await supabase.rpc('ceo_mrr_snapshot')
  if (!error && data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (o.ok === true) {
      return {
        freelancerFree: Number(o.freelancerFree) || 0,
        freelancerPro: Number(o.freelancerPro) || 0,
        companyFree: Number(o.companyFree) || 0,
        companyPro: Number(o.companyPro) || 0,
      }
    }
  }

  const ceoIds = new Set(getAllCeoUserIds())
  const betaIds = await loadBetaIds(supabase)

  const [{ data: fpRows }, { data: cpRows }] = await Promise.all([
    supabase.from('freelancer_profiles').select('id, plan_tier'),
    supabase.from('company_profiles').select('id, subscription_plan'),
  ])

  const counts: CeoMrrCounts = {
    freelancerFree: 0,
    freelancerPro: 0,
    companyFree: 0,
    companyPro: 0,
  }

  for (const fp of fpRows ?? []) {
    const fpId = (fp as { id: string }).id
    if (ceoIds.has(fpId) || betaIds.has(fpId)) continue
    const tier = normalizeFreelancerPlanKey((fp as { plan_tier?: string | null }).plan_tier)
    if (tier === 'pro') counts.freelancerPro++
    else counts.freelancerFree++
  }

  for (const cp of cpRows ?? []) {
    const cpId = (cp as { id: string }).id
    if (betaIds.has(cpId)) continue
    const plan = companySubscriptionPlanForDb((cp as { subscription_plan?: string | null }).subscription_plan)
    if (plan === 'pro') counts.companyPro++
    else counts.companyFree++
  }

  return counts
}

export function computeCeoMrrTotals(counts: CeoMrrCounts): CeoMrrTotals {
  const freelancerMrr = counts.freelancerPro * FREELANCER_PLAN_PRICE_EUR.proMonthly
  const companyMrr = counts.companyPro * COMPANY_PLAN_PRICE_EUR.proMonthly
  return {
    ...counts,
    freelancerMrr,
    companyMrr,
    totalMrr: freelancerMrr + companyMrr,
    totalSubs:
      counts.freelancerFree +
      counts.freelancerPro +
      counts.companyFree +
      counts.companyPro,
  }
}

export function formatCeoMrr(amount: number): string {
  return formatCatalogPrice(amount)
}

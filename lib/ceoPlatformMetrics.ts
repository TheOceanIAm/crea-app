import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeFreelancerPlanKey } from '@/lib/billingDisplay'
import { companySubscriptionPlanForDb } from '@/lib/companyPlanFromSession'
import { getAllCeoUserIds } from '@/lib/ceo'
import {
  COMPANY_PLAN_PRICE_EUR,
  FREELANCER_PLAN_PRICE_EUR,
  formatCatalogPrice,
} from '@/lib/planCatalogPrices'

function isMissingInternalColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  const message = error.message ?? ''
  if (!message.toLowerCase().includes('is_internal')) return false
  return error.code === '42703' || /does not exist|schema cache|could not find/i.test(message)
}

async function withoutInternalAccounts<T extends { error: { message?: string; code?: string } | null }>(
  run: (excludeInternal: boolean) => PromiseLike<T>
): Promise<T> {
  const first = await run(true)
  if (first.error && isMissingInternalColumn(first.error)) return run(false)
  return first
}

/** Real platform users: freelancer + company with login, excluding beta testers, CEO-as-freelancer, and internal accounts. */
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

async function loadBetaIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from('profiles').select('id').eq('beta_invite', true)
  return new Set((data ?? []).map((p: { id: string }) => p.id))
}

/** Count platform users the same way as crea-services/app/ceo-dashboard/page.tsx */
export async function loadCeoPlatformUserStats(
  supabase: SupabaseClient
): Promise<CeoPlatformUserStats> {
  const ceoIds = new Set(getAllCeoUserIds())
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const countProfiles = (
    role: 'freelancer' | 'company',
    excludeInternal: boolean,
    opts?: { beta?: boolean; since?: string; excludeCeo?: boolean }
  ) => {
    let query = supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', role)
    if (excludeInternal) query = query.eq('is_internal', false)
    if (opts?.beta != null) query = query.eq('beta_invite', opts.beta)
    if (opts?.since) query = query.gte('created_at', opts.since)
    if (opts?.excludeCeo) {
      for (const id of ceoIds) query = query.neq('id', id)
    }
    return query
  }

  const [
    { count: freelancerRaw },
    { count: companyRaw },
    { count: betaFreelancerN },
    { count: betaCompanyN },
    { count: newFreelancerN },
    { count: newCompanyN },
  ] = await Promise.all([
    withoutInternalAccounts((excludeInternal) =>
      countProfiles('freelancer', excludeInternal, { excludeCeo: true })
    ),
    withoutInternalAccounts((excludeInternal) => countProfiles('company', excludeInternal)),
    withoutInternalAccounts((excludeInternal) =>
      countProfiles('freelancer', excludeInternal, { beta: true })
    ),
    withoutInternalAccounts((excludeInternal) => countProfiles('company', excludeInternal, { beta: true })),
    withoutInternalAccounts((excludeInternal) =>
      countProfiles('freelancer', excludeInternal, { beta: false, since: weekAgo, excludeCeo: true })
    ),
    withoutInternalAccounts((excludeInternal) =>
      countProfiles('company', excludeInternal, { beta: false, since: weekAgo })
    ),
  ])

  const freelancers = Math.max(0, (freelancerRaw ?? 0) - (betaFreelancerN ?? 0))
  const companies = Math.max(0, (companyRaw ?? 0) - (betaCompanyN ?? 0))

  return {
    allUsers: freelancers + companies,
    newUsers: (newFreelancerN ?? 0) + (newCompanyN ?? 0),
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

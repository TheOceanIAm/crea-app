import type { User } from '@supabase/supabase-js'
import { getCache, setCache } from '@/lib/appCache'
import {
  companyCanReviewApplications,
  companyPlanWithPlatformTrial,
} from '@/lib/company-plan'
import { resolveCompanySubscriptionPlanFromSources } from '@/lib/companyPlanFromSession'
import { getAuthUser } from '@/lib/getAuthUser'
import { isWithinPlatformTrialPeriod } from '@/lib/platformTrial'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { supabase } from '@/lib/supabase'

export type CompanyApplicationRow = {
  id: string
  jobId: string
  jobTitle: string
  freelancerId: string
  freelancerName: string
  avatarUrl: string | null
  status: string
  createdAt: string
}

export type CompanyApplicationsCache = {
  allowed: boolean
  proRequired: boolean
  rows: CompanyApplicationRow[]
}

const MEM_TTL_MS = 35_000
const DISK_TTL_MS = 24 * 60 * 60 * 1000

export function companyApplicationsCacheKey(userId: string): string {
  return `company-applications:${userId}`
}

function companyApplicationsDiskKey(userId: string): string {
  return `crea:company-applications:${userId}`
}

export function readCachedCompanyApplications(userId: string): CompanyApplicationsCache | null {
  return getCache<CompanyApplicationsCache>(companyApplicationsCacheKey(userId))
}

export function cacheCompanyApplications(userId: string, data: CompanyApplicationsCache): void {
  setCache(companyApplicationsCacheKey(userId), data, MEM_TTL_MS)
}

export async function hydrateCompanyApplicationsFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<CompanyApplicationsCache>(companyApplicationsDiskKey(userId))
  if (!hit) return false
  cacheCompanyApplications(userId, hit)
  return true
}

async function persistCompanyApplicationsToDisk(userId: string, data: CompanyApplicationsCache): Promise<void> {
  await writePersistedCache(companyApplicationsDiskKey(userId), data, DISK_TTL_MS)
}

export async function loadCompanyApplicationsCache(user: User): Promise<CompanyApplicationsCache> {
  const { data: p } = await supabase
    .from('profiles')
    .select('role, trial_ends_at, created_at, subscription_tier')
    .eq('id', user.id)
    .single()
  const role = resolveAppRole(p?.role, user)
  if (!isCompanyProfile(role)) {
    return { allowed: false, proRequired: false, rows: [] }
  }

  const { data: cp } = await supabase
    .from('company_profiles')
    .select('subscription_plan')
    .eq('id', user.id)
    .maybeSingle()
  const storedPlan = resolveCompanySubscriptionPlanFromSources(
    user,
    p?.subscription_tier,
    cp?.subscription_plan
  )
  const trialActive = isWithinPlatformTrialPeriod(p?.trial_ends_at, p?.created_at ?? user.created_at)
  const effectivePlan = companyPlanWithPlatformTrial(storedPlan, trialActive)
  if (!companyCanReviewApplications(effectivePlan)) {
    return { allowed: true, proRequired: true, rows: [] }
  }

  const { data: jobs, error: jerr } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('company_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (jerr || !jobs?.length) {
    return { allowed: true, proRequired: false, rows: [] }
  }

  const jobMap = new Map<string, string>()
  for (const j of jobs) {
    jobMap.set(j.id as string, String(j.title ?? '').trim() || 'Project')
  }
  const jobIds = [...jobMap.keys()]

  const { data: apps, error: aerr } = await supabase
    .from('job_applications')
    .select('id, job_id, freelancer_id, status, created_at')
    .in('job_id', jobIds)
    .order('created_at', { ascending: false })
    .limit(200)

  if (aerr || !apps?.length) {
    return { allowed: true, proRequired: false, rows: [] }
  }

  const fIds = [...new Set(apps.map((a) => a.freelancer_id as string).filter(Boolean))]
  const { data: profs } = await supabase.from('profiles').select('id, name, avatar_url').in('id', fIds)
  const profMap = new Map<string, { name: string; avatar_url: string | null }>()
  for (const pr of profs ?? []) {
    const url = pr.avatar_url?.trim()
    profMap.set(pr.id as string, {
      name: (pr.name || 'Freelancer').trim() || 'Freelancer',
      avatar_url: url && /^https?:\/\//i.test(url) ? url : null,
    })
  }

  const rows: CompanyApplicationRow[] = apps.map((a) => {
    const fid = a.freelancer_id as string
    const pr = profMap.get(fid)
    const jid = a.job_id as string
    return {
      id: a.id as string,
      jobId: jid,
      jobTitle: jobMap.get(jid) ?? 'Job',
      freelancerId: fid,
      freelancerName: pr?.name ?? 'Freelancer',
      avatarUrl: pr?.avatar_url ?? null,
      status: String(a.status ?? 'pending'),
      createdAt: String(a.created_at ?? ''),
    }
  })

  return { allowed: true, proRequired: false, rows }
}

let inflight: Promise<void> | null = null

export async function prefetchCompanyApplications(userId: string): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (!readCachedCompanyApplications(userId)) {
      await hydrateCompanyApplicationsFromDisk(userId)
    }
    const user = await getAuthUser()
    if (!user || user.id !== userId) return
    const data = await loadCompanyApplicationsCache(user)
    cacheCompanyApplications(userId, data)
    void persistCompanyApplicationsToDisk(userId, data)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

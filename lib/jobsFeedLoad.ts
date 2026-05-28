import type { User } from '@supabase/supabase-js'
import { getCache, setCache } from '@/lib/appCache'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { supabase } from '@/lib/supabase'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'

export type JobFeedRow = {
  id: string
  title: string
  category: string
  budget_type: string
  budget_amount: number | null
  budget_currency: string | null
  location_type: string
  company_id: string | null
  company_name: string
  company_logo_url: string | null
  status: string
  is_solo_workspace: boolean
}

export type ExternalJobRow = {
  id: string
  title: string
  company: string
  location: string | null
  region: string | null
  role: string | null
  rate: string | null
  needed_when: string | null
  source_platform: string | null
  source_url: string | null
  intel_brief: string | null
  contact_name: string | null
  contact_email: string | null
  contact_linkedin: string | null
  contact_instagram: string | null
}

export type JobsFeedCache = {
  jobs: JobFeedRow[]
  externalJobs: ExternalJobRow[]
}

const DISK_TTL_MS = 24 * 60 * 60 * 1000
const MEM_TTL_MS = 35_000

export function jobsFeedCacheKey(userId: string, feedTab: 'crea' | 'external', companyOnly: boolean): string {
  return `jobs-feed:${userId}:${feedTab}:${companyOnly ? 'c' : 'f'}`
}

function jobsFeedDiskKey(userId: string, feedTab: 'crea' | 'external', companyOnly: boolean): string {
  return `crea:jobs-feed:${userId}:${feedTab}:${companyOnly ? 'c' : 'f'}`
}

export function readCachedJobsFeed(
  userId: string,
  feedTab: 'crea' | 'external' = 'crea',
  companyOnly = false
): JobsFeedCache | null {
  return getCache<JobsFeedCache>(jobsFeedCacheKey(userId, feedTab, companyOnly))
}

export function cacheJobsFeed(
  userId: string,
  feedTab: 'crea' | 'external',
  companyOnly: boolean,
  data: JobsFeedCache
): void {
  setCache(jobsFeedCacheKey(userId, feedTab, companyOnly), data, MEM_TTL_MS)
}

export async function hydrateJobsFeedFromDisk(
  userId: string,
  feedTab: 'crea' | 'external' = 'crea',
  companyOnly = false
): Promise<boolean> {
  const hit = await readPersistedCache<JobsFeedCache>(jobsFeedDiskKey(userId, feedTab, companyOnly))
  if (!hit) return false
  cacheJobsFeed(userId, feedTab, companyOnly, hit)
  return true
}

export async function persistJobsFeedToDisk(
  userId: string,
  feedTab: 'crea' | 'external',
  companyOnly: boolean,
  data: JobsFeedCache
): Promise<void> {
  await writePersistedCache(jobsFeedDiskKey(userId, feedTab, companyOnly), data, DISK_TTL_MS)
}

export async function loadJobsFeed(
  user: User,
  opts?: { feedTab?: 'crea' | 'external' }
): Promise<{ cacheKey: string; data: JobsFeedCache; companyOnly: boolean; feedTab: 'crea' | 'external' } | null> {
  const feedTab = opts?.feedTab ?? 'crea'
  const { data: prof } = await supabase
    .from('profiles')
    .select('role, subscription_tier')
    .eq('id', user.id)
    .maybeSingle()
  const role = resolveAppRole(prof?.role, user)
  const companyOnly = isCompanyProfile(role)
  const cacheKey = jobsFeedCacheKey(user.id, feedTab, companyOnly)

  if (!companyOnly && feedTab === 'external') {
    const { data: extRows, error: extError } = await supabase
      .from('external_jobs')
      .select(
        'id,title,company,location,region,role,rate,needed_when,source_platform,source_url,intel_brief,contact_name,contact_email,contact_linkedin,contact_instagram'
      )
      .eq('status', 'published')
      .order('posted_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(40)
    const externalJobs = extError || !extRows ? [] : (extRows as ExternalJobRow[])
    const data: JobsFeedCache = { jobs: [], externalJobs }
    return { cacheKey, data, companyOnly, feedTab }
  }

  let q = supabase
    .from('jobs')
    .select(
      'id, title, category, budget_type, budget_amount, budget_currency, location_type, company_id, status, is_solo_workspace'
    )
    .order('created_at', { ascending: false })
    .limit(companyOnly ? 100 : 30)

  if (companyOnly) {
    q = q.eq('company_id', user.id)
  } else {
    q = q.eq('status', 'active')
  }
  q = q.eq('is_solo_workspace', false)

  const { data: jobRows, error } = await q
  if (error || !jobRows?.length) {
    return { cacheKey, data: { jobs: [], externalJobs: [] }, companyOnly, feedTab }
  }

  const ids = [
    ...new Set(
      jobRows.map((j) => j.company_id).filter((x): x is string => typeof x === 'string' && x.length > 0)
    ),
  ]

  const companyById: Record<string, { name: string; avatar_url: string | null }> = {}
  if (ids.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, name, avatar_url').in('id', ids)
    for (const p of profiles ?? []) {
      const url = p.avatar_url?.trim()
      companyById[p.id] = {
        name: (p.name || 'Company').trim() || 'Company',
        avatar_url: url && /^https?:\/\//i.test(url) ? url : null,
      }
    }
  }

  const jobs: JobFeedRow[] = jobRows.map((j) => {
    const cid = j.company_id as string | null
    const c = cid ? companyById[cid] : undefined
    return {
      id: j.id as string,
      title: String(j.title ?? ''),
      category: String(j.category ?? ''),
      budget_type: String(j.budget_type ?? ''),
      budget_amount: typeof j.budget_amount === 'number' ? j.budget_amount : null,
      budget_currency: typeof j.budget_currency === 'string' ? j.budget_currency : null,
      location_type: String(j.location_type ?? ''),
      company_id: cid,
      company_name: c?.name ?? 'Company',
      company_logo_url: c?.avatar_url ?? null,
      status: String(j.status ?? ''),
      is_solo_workspace: Boolean(j.is_solo_workspace),
    }
  })

  return { cacheKey, data: { jobs, externalJobs: [] }, companyOnly, feedTab }
}

let inflight: Promise<void> | null = null

export async function prefetchJobsFeed(user: User): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    const { data: prof } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const role = resolveAppRole(prof?.role, user)
    const companyOnly = isCompanyProfile(role)
    if (!readCachedJobsFeed(user.id, 'crea', companyOnly)) {
      await hydrateJobsFeedFromDisk(user.id, 'crea', companyOnly)
    }
    const loaded = await loadJobsFeed(user, { feedTab: 'crea' })
    if (!loaded) return
    cacheJobsFeed(user.id, loaded.feedTab, loaded.companyOnly, loaded.data)
    void persistJobsFeedToDisk(user.id, loaded.feedTab, loaded.companyOnly, loaded.data)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

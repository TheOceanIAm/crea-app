import type { User } from '@supabase/supabase-js'
import { getCache, setCache } from '@/lib/appCache'
import { freelancerCustomerJobVisibleToFreelancer } from '@/lib/freelancerCustomerJobVisibility'
import { formatBudgetDisplay, resolveListingBudgetFields } from '@/lib/budgetFormatting'
import {
  canFreelancerCreatePrivateProjects,
  resolveFreelancerPlanFromUserAndProfileTier,
} from '@/lib/freelancerPlan'
import { getAuthUser } from '@/lib/getAuthUser'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { supabase } from '@/lib/supabase'

export type ListingKind = 'private' | 'customer'

export type ProjectListing = {
  id: string
  kind: ListingKind
  title: string
  /** Customer company name, or optional solo client label */
  subtitle: string | null
  budgetLine: string
  logoUrl: string
  statusLabel: string
  updatedAt: string | null
  categoryLabel: string
  isArchived: boolean
  /** Customer jobs: native workspace (`/project/:id`); set when `projects.job_id` exists */
  workspaceProjectId?: string | null
}

export type WorkspaceProjectsCache = {
  listings: ProjectListing[]
  archivedListings: ProjectListing[]
  canCreatePrivate: boolean
  viewerRole: 'freelancer' | 'company'
}

type JobRow = {
  id: string
  title: string
  category: string | null
  budget_type: string | null
  budget_amount: number | null
  budget_currency?: string | null
  status: string | null
  project_status?: string | null
  company_id: string
  is_solo_workspace?: boolean | null
  solo_workspace_client_label?: string | null
  updated_at?: string | null
  created_at?: string | null
}

const DISK_TTL_MS = 24 * 60 * 60 * 1000
const MEM_TTL_MS = 35_000

export function mapProjectStatusLabel(project: {
  status: string | null | undefined
  job_status?: string | null
  job_project_status?: string | null
}): string {
  const st = String(project.status ?? '').toLowerCase()
  const js = String(project.job_status ?? '').toLowerCase()
  const jps = String(project.job_project_status ?? '').toLowerCase()
  if (st === 'archived') return 'ARCHIVED'
  if (st === 'cancelled' || js === 'closed') return 'CLOSED'
  if (st === 'completed' || jps === 'completed') return 'COMPLETED'
  if (st === 'recruiting' || jps === 'recruiting') return 'RECRUITING'
  return 'ACTIVE'
}

export function faviconFromWebsite(url: string): string | null {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`
    const host = new URL(u).hostname.replace(/^www\./, '')
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return null
  }
}

export function listingProfileAvatarUrl(displayName: string, avatarUrl: string | null | undefined): string {
  const u = avatarUrl?.trim()
  if (u) return u
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || 'You')}&background=333&color=fff&size=128`
}

export function mapJobStatusLabel(job: {
  status: string | null | undefined
  project_status?: string | null
}): string {
  const st = String(job.status ?? '').toLowerCase()
  const ps = String(job.project_status ?? '').toLowerCase()
  if (st === 'closed' || ps === 'completed') return 'COMPLETED'
  if (ps === 'recruiting') return 'RECRUITING'
  return 'ACTIVE'
}

export function workspaceProjectsCacheKey(userId: string): string {
  return `workspace-projects:${userId}`
}

function workspaceProjectsDiskKey(userId: string): string {
  return `crea:workspace-projects:${userId}`
}

export function readCachedWorkspaceProjects(userId: string): WorkspaceProjectsCache | null {
  return getCache<WorkspaceProjectsCache>(workspaceProjectsCacheKey(userId))
}

export function cacheWorkspaceProjects(userId: string, data: WorkspaceProjectsCache): void {
  setCache(workspaceProjectsCacheKey(userId), data, MEM_TTL_MS)
}

export async function hydrateWorkspaceProjectsFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<WorkspaceProjectsCache>(workspaceProjectsDiskKey(userId))
  if (!hit) return false
  cacheWorkspaceProjects(userId, hit)
  return true
}

export async function persistWorkspaceProjectsToDisk(
  userId: string,
  data: WorkspaceProjectsCache
): Promise<void> {
  await writePersistedCache(workspaceProjectsDiskKey(userId), data, DISK_TTL_MS)
}

export async function loadWorkspaceProjectsCache(user: User): Promise<WorkspaceProjectsCache | null> {
  const { data: p } = await supabase
    .from('profiles')
    .select('role, subscription_tier, name, avatar_url')
    .eq('id', user.id)
    .maybeSingle()
  const role = resolveAppRole(p?.role, user)
  const freelancerView = isFreelancerProfile(role) && !isCompanyProfile(role) && !isCeoProfile(role)
  const companyView = isCompanyProfile(role)
  if (!freelancerView && !companyView) {
    return null
  }

  if (companyView) {
    const [{ data: companyProjects, error: projectsErr }, { data: cp }, { data: profileRow }] =
      await Promise.all([
        supabase
          .from('projects')
          .select('id, job_id, title, status, updated_at, budget_amount, budget_type, budget_currency')
          .eq('company_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(150),
        supabase
          .from('company_profiles')
          .select('logo_url, website')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .maybeSingle(),
      ])
    if (projectsErr) {
      throw new Error(projectsErr.message)
    }
    const companyName =
      typeof profileRow?.name === 'string' && profileRow.name.trim().length > 0
        ? profileRow.name.trim()
        : 'Company'
    const companyLogo =
      (typeof cp?.logo_url === 'string' && cp.logo_url.trim()) ||
      (typeof cp?.website === 'string' && cp.website.trim() ? faviconFromWebsite(cp.website.trim()) : null) ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(companyName)}&background=FFDC00&color=0a0a0a&size=64`
    const companyJobIds = [
      ...new Set(
        (companyProjects ?? [])
          .map((pr) => (typeof pr.job_id === 'string' ? pr.job_id : null))
          .filter((id): id is string => Boolean(id))
      ),
    ]
    let jobStatusById: Record<string, { status: string | null; project_status: string | null }> = {}
    if (companyJobIds.length > 0) {
      const { data: companyJobs } = await supabase
        .from('jobs')
        .select('id, status, project_status')
        .in('id', companyJobIds)
      jobStatusById = Object.fromEntries(
        (companyJobs ?? []).map((j) => [
          String(j.id),
          {
            status: typeof j.status === 'string' ? j.status : null,
            project_status: typeof j.project_status === 'string' ? j.project_status : null,
          },
        ])
      )
    }

    const companyProjectIds = (companyProjects ?? []).map((pr) => String(pr.id))
    let companyPlanByProjectId: Record<string, { total_budget: number | null; currency: string | null }> = {}
    if (companyProjectIds.length > 0) {
      const { data: planRows } = await supabase
        .from('project_budget_plans')
        .select('project_id, total_budget, currency')
        .in('project_id', companyProjectIds)
      companyPlanByProjectId = Object.fromEntries(
        (planRows ?? []).map((row) => {
          const projectId = String((row as { project_id: string }).project_id)
          return [
            projectId,
            {
              total_budget:
                typeof (row as { total_budget?: number | null }).total_budget === 'number'
                  ? (row as { total_budget: number }).total_budget
                  : null,
              currency:
                typeof (row as { currency?: string | null }).currency === 'string'
                  ? (row as { currency: string }).currency
                  : null,
            },
          ]
        })
      )
    }

    const builtCompany: ProjectListing[] = (companyProjects ?? []).map((pr) => {
      const archived = String(pr.status ?? '').toLowerCase() === 'archived'
      const jobId = typeof pr.job_id === 'string' ? pr.job_id : null
      const jobStatus = jobId ? jobStatusById[jobId] : null
      const plan = companyPlanByProjectId[String(pr.id)]
      const budgetLine = formatBudgetDisplay(
        resolveListingBudgetFields({
          budget_type: String(pr.budget_type ?? 'negotiable'),
          budget_amount: typeof pr.budget_amount === 'number' ? pr.budget_amount : null,
          budget_currency: typeof pr.budget_currency === 'string' ? pr.budget_currency : null,
          plan_total_budget: plan?.total_budget ?? null,
          plan_currency: plan?.currency ?? null,
        })
      )
      return {
        id: String(pr.id),
        kind: 'private' as const,
        title: String(pr.title ?? '').trim() || 'Untitled project',
        subtitle: null,
        budgetLine,
        logoUrl: companyLogo,
        statusLabel: mapProjectStatusLabel({
          status: pr.status,
          job_status: jobStatus?.status ?? null,
          job_project_status: jobStatus?.project_status ?? null,
        }),
        updatedAt: typeof pr.updated_at === 'string' ? pr.updated_at : null,
        categoryLabel: 'Company',
        isArchived: archived,
      }
    })
    builtCompany.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    const coActive = builtCompany.filter((x) => !x.isArchived && x.statusLabel !== 'CLOSED')
    const coArch = builtCompany.filter((x) => x.isArchived || x.statusLabel === 'CLOSED')
    return {
      listings: coActive,
      archivedListings: coArch,
      canCreatePrivate: true,
      viewerRole: 'company',
    }
  }

  const plan = resolveFreelancerPlanFromUserAndProfileTier(user, p?.subscription_tier)
  const nextCanPrivate = canFreelancerCreatePrivateProjects(plan)

  const displayName = (p?.name && String(p.name).trim()) || 'You'
  const av =
    p && typeof (p as { avatar_url?: string | null }).avatar_url === 'string'
      ? String((p as { avatar_url?: string | null }).avatar_url).trim() || null
      : null

  const [
    { error: syncErr },
    { data: soloJobRows },
    { data: apps },
    { data: pmRows },
    { data: leadProjRows },
    { data: projectRows },
  ] = await Promise.all([
    supabase.rpc('sync_solo_workspace_projects_for_owner'),
    supabase.from('jobs').select('id').eq('company_id', user.id).eq('is_solo_workspace', true).limit(100),
    supabase.from('job_applications').select('job_id').eq('freelancer_id', user.id).eq('status', 'accepted').limit(200),
    supabase.from('project_members').select('project_id').eq('profile_id', user.id).limit(200),
    supabase.from('projects').select('job_id').eq('freelancer_id', user.id).not('job_id', 'is', null).limit(200),
    // Own private workspaces — only needs user.id, so fetch it up front in parallel.
    supabase
      .from('projects')
      .select('id, title, status, updated_at, job_id, budget_amount, budget_type, budget_currency')
      .eq('company_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(150),
  ])
  if (syncErr && __DEV__) {
    console.warn('[workspace-projects] sync_solo_workspace_projects_for_owner', syncErr.message)
  }

  const crewJobIds = [...new Set((apps ?? []).map((a) => a.job_id).filter(Boolean))] as string[]
  const membershipJobIds: string[] = []
  const pmProjectIds = [...new Set((pmRows ?? []).map((r) => String((r as { project_id: string }).project_id).trim()).filter(Boolean))]
  if (pmProjectIds.length > 0) {
    const { data: projFromPm } = await supabase
      .from('projects')
      .select('job_id')
      .in('id', pmProjectIds)
      .not('job_id', 'is', null)
    for (const row of projFromPm ?? []) {
      const jid = row.job_id as string | null
      if (jid) membershipJobIds.push(jid)
    }
  }
  const leadJobIds = ((leadProjRows ?? []) as { job_id: string | null }[])
    .map((r) => r.job_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const soloIds = (soloJobRows ?? []).map((r) => String((r as { id: string }).id))
  const allJobIds = [...new Set([...crewJobIds, ...soloIds, ...membershipJobIds, ...leadJobIds])]
  const declinedCustomerJobIds = await loadDeclinedCustomerJobIds(user.id, allJobIds)
  const visibleJobIds = allJobIds.filter((jid) => !declinedCustomerJobIds.has(jid))

  let jobsById: Record<string, JobRow> = {}
  const workspaceProjectIdByJobId: Record<string, string> = {}
  if (visibleJobIds.length > 0) {
    const [jobsRes, linkRes] = await Promise.all([
      supabase
        .from('jobs')
        .select(
          'id, title, category, budget_type, budget_amount, budget_currency, status, project_status, company_id, is_solo_workspace, solo_workspace_client_label, updated_at, created_at'
        )
        .in('id', visibleJobIds),
      supabase.from('projects').select('id, job_id').in('job_id', visibleJobIds),
    ])
    if (jobsRes.error && __DEV__) console.warn('[workspace-projects] jobs', jobsRes.error.message)
    jobsById = Object.fromEntries(((jobsRes.data ?? []) as JobRow[]).map((j) => [j.id, j]))
    for (const row of linkRes.data ?? []) {
      const jid = String((row as { job_id?: string | null }).job_id ?? '').trim()
      const pid = String((row as { id?: string | null }).id ?? '').trim()
      if (!jid || !pid) continue
      if (!workspaceProjectIdByJobId[jid]) workspaceProjectIdByJobId[jid] = pid
    }
  }

  const companyIds = [...new Set(Object.values(jobsById).map((j) => j.company_id).filter(Boolean))] as string[]
  const [{ data: companyProfiles }, { data: companyNames }] = await Promise.all([
    companyIds.length
      ? supabase.from('company_profiles').select('id, website, logo_url').in('id', companyIds)
      : { data: [] as { id: string; website: string | null; logo_url: string | null }[] },
    companyIds.length
      ? supabase.from('profiles').select('id, name').in('id', companyIds)
      : { data: [] as { id: string; name: string | null }[] },
  ])
  const cpMap = Object.fromEntries((companyProfiles ?? []).map((c) => [c.id, c]))
  const nameByCompany = Object.fromEntries((companyNames ?? []).map((r) => [r.id, (r.name || '').trim()]))

  const projectById = Object.fromEntries((projectRows ?? []).map((r) => [String(r.id), r]))

  const budgetPlanProjectIds = [
    ...new Set([
      ...soloIds,
      ...(projectRows ?? []).map((r) => String(r.id)),
      ...Object.values(workspaceProjectIdByJobId),
    ]),
  ].filter(Boolean)
  let budgetPlanByProjectId: Record<string, { total_budget: number | null; currency: string | null }> = {}
  if (budgetPlanProjectIds.length > 0) {
    const { data: planRows } = await supabase
      .from('project_budget_plans')
      .select('project_id, total_budget, currency')
      .in('project_id', budgetPlanProjectIds)
    budgetPlanByProjectId = Object.fromEntries(
      (planRows ?? []).map((row) => {
        const projectId = String((row as { project_id: string }).project_id)
        return [
          projectId,
          {
            total_budget:
              typeof (row as { total_budget?: number | null }).total_budget === 'number'
                ? (row as { total_budget: number }).total_budget
                : null,
            currency:
              typeof (row as { currency?: string | null }).currency === 'string'
                ? (row as { currency: string }).currency
                : null,
          },
        ]
      })
    )
  }

  const built: ProjectListing[] = []
  for (const jid of visibleJobIds) {
    const job = jobsById[jid]
    if (!job) continue
    if (!freelancerCustomerJobVisibleToFreelancer(job, user.id)) continue

    const isSolo = Boolean(job.is_solo_workspace) && job.company_id === user.id
    const listingProjectId = workspaceProjectIdByJobId[jid] ?? jid
    const plan = budgetPlanByProjectId[listingProjectId] ?? budgetPlanByProjectId[jid]
    const budgetLine = formatBudgetDisplay(
      resolveListingBudgetFields({
        budget_type: job.budget_type,
        budget_amount: job.budget_amount,
        budget_currency: job.budget_currency,
        plan_total_budget: plan?.total_budget ?? null,
        plan_currency: plan?.currency ?? null,
      })
    )

    const proj = projectById[jid]
    const updatedRaw = proj?.updated_at ?? job.updated_at ?? job.created_at ?? null
    const archived = isSolo && String(proj?.status ?? '').toLowerCase() === 'archived'

    if (isSolo) {
      const clientLbl =
        typeof job.solo_workspace_client_label === 'string' ? job.solo_workspace_client_label.trim() : ''
      built.push({
        id: job.id,
        kind: 'private',
        title: (job.title || 'Untitled project').trim(),
        subtitle: clientLbl || null,
        budgetLine,
        logoUrl: listingProfileAvatarUrl(displayName, av),
        statusLabel: mapJobStatusLabel(job),
        updatedAt: typeof updatedRaw === 'string' ? updatedRaw : null,
        categoryLabel: String(job.category ?? '').trim() || 'Private',
        isArchived: archived,
      })
    } else {
      const cp = cpMap[job.company_id]
      const companyName = nameByCompany[job.company_id] || 'Client'
      const logo =
        cp?.logo_url ||
        (cp?.website ? faviconFromWebsite(cp.website) : null) ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(companyName)}&background=FFDC00&color=0a0a0a&size=64`
      built.push({
        id: job.id,
        kind: 'customer',
        title: (job.title || 'Project').trim(),
        subtitle: companyName,
        budgetLine,
        logoUrl: logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(companyName)}&background=FFDC00&color=0a0a0a&size=64`,
        statusLabel: mapJobStatusLabel(job),
        updatedAt: typeof updatedRaw === 'string' ? updatedRaw : null,
        categoryLabel: String(job.category ?? '').trim() || 'Job',
        isArchived: false,
        workspaceProjectId: workspaceProjectIdByJobId[job.id] ?? null,
      })
    }
  }

  const listedJobIds = new Set(built.map((b) => b.id))
  const soloJobIdSet = new Set(soloIds)
  for (const pr of projectRows ?? []) {
    const pid = String(pr.id)
    if (listedJobIds.has(pid)) continue
    const linkId =
      typeof pr.job_id === 'string' && pr.job_id.trim().length > 0 ? pr.job_id.trim() : pid
    // Drop stale project mirrors after a web-side solo job delete (job gone, project row may linger).
    if (!soloJobIdSet.has(linkId) && !soloJobIdSet.has(pid)) continue
    const plan = budgetPlanByProjectId[pid]
    const budgetLine = formatBudgetDisplay(
      resolveListingBudgetFields({
        budget_type: String(pr.budget_type ?? 'negotiable'),
        budget_amount: typeof pr.budget_amount === 'number' ? pr.budget_amount : null,
        budget_currency: typeof pr.budget_currency === 'string' ? pr.budget_currency : null,
        plan_total_budget: plan?.total_budget ?? null,
        plan_currency: plan?.currency ?? null,
      })
    )
    const archived = String(pr.status ?? '').toLowerCase() === 'archived'
    built.push({
      id: pid,
      kind: 'private',
      title: String(pr.title ?? '').trim() || 'Untitled project',
      subtitle: null,
      budgetLine,
      logoUrl: listingProfileAvatarUrl(displayName, av),
      statusLabel: archived ? 'ARCHIVED' : 'ACTIVE',
      updatedAt: typeof pr.updated_at === 'string' ? pr.updated_at : null,
      categoryLabel: 'Private',
      isArchived: archived,
    })
  }

  const ts = (x: ProjectListing) => new Date(x.updatedAt || 0).getTime()
  built.sort((a, b) => ts(b) - ts(a))

  const active = built.filter((x) => !x.isArchived)
  const arch = built.filter((x) => x.isArchived)

  return {
    listings: active,
    archivedListings: arch,
    canCreatePrivate: nextCanPrivate,
    viewerRole: 'freelancer',
  }
}

async function loadDeclinedCustomerJobIds(freelancerId: string, jobIds: string[]): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set()
  const { data } = await supabase
    .from('job_applications')
    .select('job_id')
    .eq('freelancer_id', freelancerId)
    .eq('status', 'declined')
    .in('job_id', jobIds)
  return new Set((data ?? []).map((r) => String(r.job_id)).filter(Boolean))
}

let inflight: Promise<void> | null = null

export async function prefetchWorkspaceProjects(userId: string): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    const user = await getAuthUser()
    if (!user || user.id !== userId) return
    if (!readCachedWorkspaceProjects(userId)) {
      await hydrateWorkspaceProjectsFromDisk(userId)
    }
    const loaded = await loadWorkspaceProjectsCache(user)
    if (!loaded) return
    cacheWorkspaceProjects(userId, loaded)
    void persistWorkspaceProjectsToDisk(userId, loaded)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

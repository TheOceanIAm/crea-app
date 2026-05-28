import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Image,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  SectionList,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import {
  canFreelancerCreatePrivateProjects,
  resolveFreelancerPlanFromUserAndProfileTier,
} from '@/lib/freelancerPlan'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'
import {
  readCachedWorkspaceProjects,
  workspaceProjectsCacheKey,
  type WorkspaceProjectsCache,
} from '@/lib/workspaceProjectsLoad'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { getCache, setCache } from '@/lib/appCache'
import { runTimed } from '@/lib/perfMarks'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'

type ListingKind = 'private' | 'customer'

type ProjectListing = {
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

type WorkspaceProject = {
  id: string
  job_id: string | null
  title: string
  status: string | null
  updated_at: string | null
  brief_ai_context: string | null
  workspace_summary: string | null
  brief_ai_outputs: Record<string, unknown> | null
}

function mapProjectStatusLabel(project: {
  status: string | null | undefined
  job_status?: string | null
  job_project_status?: string | null
}): string {
  const st = String(project.status ?? '').toLowerCase()
  const js = String(project.job_status ?? '').toLowerCase()
  const jps = String(project.job_project_status ?? '').toLowerCase()
  if (st === 'archived') return 'ARCHIVED'
  if (st === 'completed' || js === 'closed' || jps === 'completed') return 'COMPLETED'
  if (st === 'recruiting' || jps === 'recruiting') return 'RECRUITING'
  return 'ACTIVE'
}

function faviconFromWebsite(url: string): string | null {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`
    const host = new URL(u).hostname.replace(/^www\./, '')
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return null
  }
}

function listingProfileAvatarUrl(displayName: string, avatarUrl: string | null | undefined): string {
  const u = avatarUrl?.trim()
  if (u) return u
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || 'You')}&background=333&color=fff&size=128`
}

function fmtDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function mapJobStatusLabel(job: {
  status: string | null | undefined
  project_status?: string | null
}): string {
  const st = String(job.status ?? '').toLowerCase()
  const ps = String(job.project_status ?? '').toLowerCase()
  if (st === 'closed' || ps === 'completed') return 'COMPLETED'
  if (ps === 'recruiting') return 'RECRUITING'
  return 'ACTIVE'
}

type ListingSection = {
  title: string
  subtitle: string
  data: ProjectListing[]
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

function readInitialWorkspaceProjects(): {
  listings: ProjectListing[]
  archivedListings: ProjectListing[]
  canCreatePrivate: boolean
  viewerRole: 'freelancer' | 'company' | null
  loading: boolean
} {
  const uid = peekWarmedOverview()?.userId
  if (!uid) {
    return { listings: [], archivedListings: [], canCreatePrivate: false, viewerRole: null, loading: true }
  }
  const cached = readCachedWorkspaceProjects(uid)
  if (!cached) {
    return { listings: [], archivedListings: [], canCreatePrivate: false, viewerRole: null, loading: true }
  }
  return {
    listings: cached.listings,
    archivedListings: cached.archivedListings,
    canCreatePrivate: cached.canCreatePrivate,
    viewerRole: cached.viewerRole,
    loading: false,
  }
}

export default function WorkspaceProjectsScreen() {
  const router = useRouter()
  const boot = useRef(readInitialWorkspaceProjects()).current
  const hasLoadedRef = useRef(!boot.loading)
  const lastLoadedAtRef = useRef(boot.loading ? 0 : Date.now())
  const RELOAD_COOLDOWN_MS = 15000
  const [loading, setLoading] = useState(boot.loading)
  const [allowed, setAllowed] = useState<boolean | null>(boot.viewerRole ? true : null)
  const [denyKind, setDenyKind] = useState<'role' | null>(null)
  const [canCreatePrivate, setCanCreatePrivate] = useState(boot.canCreatePrivate)
  const [listings, setListings] = useState<ProjectListing[]>(boot.listings)
  const [archivedListings, setArchivedListings] = useState<ProjectListing[]>(boot.archivedListings)
  const [posterAvatarUrl, setPosterAvatarUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editJobId, setEditJobId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editOutputs, setEditOutputs] = useState<Record<string, unknown>>({})
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [viewerRole, setViewerRole] = useState<'freelancer' | 'company' | null>(boot.viewerRole)

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const now = Date.now()
    if (!opts?.force && hasLoadedRef.current && now - lastLoadedAtRef.current < RELOAD_COOLDOWN_MS) {
      return
    }
    const timed = await runTimed('workspace-projects.load', async () => {
    setError(null)
    const user = await getAuthUser()
    if (!user) {
      setAllowed(false)
      setListings([])
      setLoading(false)
      router.replace('/login')
      return
    }

    const wsCacheKey = workspaceProjectsCacheKey(user.id)

    const { data: p } = await supabase
      .from('profiles')
      .select('role, subscription_tier, name, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
    const role = resolveAppRole(p?.role, user)
    const freelancerView = isFreelancerProfile(role) && !isCompanyProfile(role) && !isCeoProfile(role)
    const companyView = isCompanyProfile(role)
    if (!freelancerView && !companyView) {
      setAllowed(false)
      setDenyKind('role')
      setListings([])
      setLoading(false)
      return
    }
    setDenyKind(null)
    setAllowed(true)
    const vr: 'freelancer' | 'company' = companyView ? 'company' : 'freelancer'
    setViewerRole(vr)

    let hydratedCache = false
    if (!opts?.force) {
      const wc = getCache<WorkspaceProjectsCache>(wsCacheKey)
      if (
        wc &&
        wc.viewerRole === vr &&
        Array.isArray(wc.listings) &&
        Array.isArray(wc.archivedListings)
      ) {
        setListings(wc.listings)
        setArchivedListings(wc.archivedListings)
        setCanCreatePrivate(wc.canCreatePrivate)
        setLoading(false)
        hydratedCache = true
      }
    }
    if (!hydratedCache && !hasLoadedRef.current) setLoading(true)

    if (companyView) {
      setCanCreatePrivate(true)
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
        setError(projectsErr.message)
        setListings([])
        setArchivedListings([])
        setLoading(false)
        return
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

      const builtCompany: ProjectListing[] = (companyProjects ?? []).map((pr) => {
        const archived = String(pr.status ?? '').toLowerCase() === 'archived'
        const jobId = typeof pr.job_id === 'string' ? pr.job_id : null
        const jobStatus = jobId ? jobStatusById[jobId] : null
        const budgetLine = formatBudgetDisplay({
          budget_type: String(pr.budget_type ?? 'negotiable'),
          budget_amount: typeof pr.budget_amount === 'number' ? pr.budget_amount : null,
          budget_currency: typeof pr.budget_currency === 'string' ? pr.budget_currency : null,
        })
        return {
          id: String(pr.id),
          kind: 'private',
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
      const coActive = builtCompany.filter((x) => !x.isArchived)
      const coArch = builtCompany.filter((x) => x.isArchived)
      setListings(coActive)
      setArchivedListings(coArch)
      setCache(
        wsCacheKey,
        {
          listings: coActive,
          archivedListings: coArch,
          canCreatePrivate: true,
          viewerRole: 'company',
        },
        35_000
      )
      setLoading(false)
      hasLoadedRef.current = true
      lastLoadedAtRef.current = Date.now()
      return { active: coActive.length, archived: coArch.length }
    }

    const plan = resolveFreelancerPlanFromUserAndProfileTier(user, p?.subscription_tier)
    const nextCanPrivate = canFreelancerCreatePrivateProjects(plan)
    setCanCreatePrivate(nextCanPrivate)

    const displayName = (p?.name && String(p.name).trim()) || 'You'
    const av =
      p && typeof (p as { avatar_url?: string | null }).avatar_url === 'string'
        ? String((p as { avatar_url?: string | null }).avatar_url).trim() || null
        : null
    setPosterAvatarUrl(av)

    const [{ error: syncErr }, { data: soloJobRows }, { data: apps }, { data: pmRows }, { data: leadProjRows }] =
      await Promise.all([
        supabase.rpc('sync_solo_workspace_projects_for_owner'),
        supabase.from('jobs').select('id').eq('company_id', user.id).eq('is_solo_workspace', true).limit(100),
        supabase.from('job_applications').select('job_id').eq('freelancer_id', user.id).eq('status', 'accepted').limit(200),
        supabase.from('project_members').select('project_id').eq('profile_id', user.id).limit(200),
        supabase.from('projects').select('job_id').eq('freelancer_id', user.id).not('job_id', 'is', null).limit(200),
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

    let jobsById: Record<string, JobRow> = {}
    if (allJobIds.length > 0) {
      const { data: jobRows, error: jobsErr } = await supabase
        .from('jobs')
        .select(
          'id, title, category, budget_type, budget_amount, budget_currency, status, project_status, company_id, is_solo_workspace, solo_workspace_client_label, updated_at, created_at'
        )
        .in('id', allJobIds)
      if (jobsErr && __DEV__) console.warn('[workspace-projects] jobs', jobsErr.message)
      jobsById = Object.fromEntries(((jobRows ?? []) as JobRow[]).map((j) => [j.id, j]))
    }

    const workspaceProjectIdByJobId: Record<string, string> = {}
    if (allJobIds.length > 0) {
      const { data: linkRows } = await supabase.from('projects').select('id, job_id').in('job_id', allJobIds)
      for (const row of linkRows ?? []) {
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

    const { data: projectRows } = await supabase
      .from('projects')
      .select('id, title, status, updated_at, job_id, budget_amount, budget_type, budget_currency, brief_ai_context, brief_ai_outputs')
      .eq('company_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(150)

    const projectById = Object.fromEntries((projectRows ?? []).map((r) => [String(r.id), r]))

    const built: ProjectListing[] = []
    for (const jid of allJobIds) {
      const job = jobsById[jid]
      if (!job) continue

      const isSolo = Boolean(job.is_solo_workspace) && job.company_id === user.id
      const budgetLine = formatBudgetDisplay({
        budget_type: String(job.budget_type ?? 'negotiable'),
        budget_amount: job.budget_amount,
        budget_currency: job.budget_currency,
      })

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
    for (const pr of projectRows ?? []) {
      const pid = String(pr.id)
      if (listedJobIds.has(pid)) continue
      const budgetLine = formatBudgetDisplay({
        budget_type: String(pr.budget_type ?? 'negotiable'),
        budget_amount: typeof pr.budget_amount === 'number' ? pr.budget_amount : null,
        budget_currency: typeof pr.budget_currency === 'string' ? pr.budget_currency : null,
      })
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

    setListings(active)
    setArchivedListings(arch)
    setCache(
      wsCacheKey,
      {
        listings: active,
        archivedListings: arch,
        canCreatePrivate: nextCanPrivate,
        viewerRole: 'freelancer',
      },
      35_000
    )
    setLoading(false)
    hasLoadedRef.current = true
    lastLoadedAtRef.current = Date.now()
    return { active: active.length, archived: arch.length }
    })
    if (__DEV__) {
      console.log(
        `[perf] workspace-projects.rows: active=${timed.value.active} archived=${timed.value.archived}`
      )
    }
  }, [router])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const listingSections = useMemo<ListingSection[]>(() => {
    if (viewerRole !== 'freelancer') {
      return [{ title: '', subtitle: '', data: listings }]
    }
    const jobs = listings.filter((x) => x.kind === 'customer')
    const priv = listings.filter((x) => x.kind === 'private')
    const sections: ListingSection[] = []
    if (jobs.length > 0) {
      sections.push({
        title: 'Customer jobs',
        subtitle: 'Bookings with client companies — open the job workspace.',
        data: jobs,
      })
    }
    if (priv.length > 0) {
      sections.push({
        title: 'Private workspaces',
        subtitle: 'Projects you created yourself — full edit, archive, and delete.',
        data: priv,
      })
    }
    return sections.length > 0 ? sections : [{ title: '', subtitle: '', data: [] }]
  }, [viewerRole, listings])

  const onCreate = async () => {
    const t = title.trim()
    if (!t || creating) return
    const u = await getAuthUser()
    if (!u) {
      Alert.alert('Projects', 'Please sign in again.')
      return
    }
    const { data: selfProfile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', u.id)
      .maybeSingle()
    if (!canFreelancerCreatePrivateProjects(resolveFreelancerPlanFromUserAndProfileTier(u, selfProfile?.subscription_tier))) {
      Alert.alert('Projects', 'Creating lead-owned private workspaces requires Pro or Workspace. Upgrade on the web.')
      return
    }
    setCreating(true)
    setError(null)
    const user = await getAuthUser()
    if (!user) {
      setCreating(false)
      setError('Please sign in again.')
      return
    }
    const { data: created, error: insErr } = await supabase
      .from('projects')
      .insert({
        company_id: user.id,
        freelancer_id: user.id,
        title: t,
        brief_ai_context: notes.trim() || null,
        brief_ai_outputs: { workspace_summary: notes.trim() || '' },
        budget_type: 'negotiable',
        location: 'Remote',
      })
      .select('id')
      .single()
    setCreating(false)
    if (insErr || !created?.id) {
      setError(insErr?.message ?? 'Could not create workspace.')
      return
    }
    setCreateOpen(false)
    setTitle('')
    setNotes('')
    router.push(`/project/${created.id}` as Href)
  }

  const openListing = (item: ProjectListing) => {
    if (item.kind === 'private') {
      router.push(`/project/${item.id}` as Href)
    } else if (item.workspaceProjectId) {
      router.push(`/project/${item.workspaceProjectId}` as Href)
    } else {
      router.push(`/(tabs)/jobs/${item.id}` as Href)
    }
  }

  const fetchProjectForEdit = async (projectId: string): Promise<WorkspaceProject | null> => {
    const { data, error: qErr } = await supabase
      .from('projects')
      .select('id, job_id, title, status, updated_at, brief_ai_context, brief_ai_outputs')
      .eq('id', projectId)
      .maybeSingle()
    if (qErr || !data) return null
    const outputs =
      data.brief_ai_outputs && typeof data.brief_ai_outputs === 'object'
        ? (data.brief_ai_outputs as Record<string, unknown>)
        : {}
    const ws =
      typeof outputs.workspace_summary === 'string' ? outputs.workspace_summary : ''
    return {
      id: String(data.id),
      job_id: typeof data.job_id === 'string' ? data.job_id : null,
      title: String(data.title ?? '').trim(),
      status: typeof data.status === 'string' ? data.status : null,
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
      brief_ai_context: typeof data.brief_ai_context === 'string' ? data.brief_ai_context : null,
      workspace_summary: ws,
      brief_ai_outputs: outputs,
    }
  }

  const openEdit = async (item: ProjectListing) => {
    if (item.kind !== 'private') return
    const row = await fetchProjectForEdit(item.id)
    if (!row) {
      Alert.alert('Projects', 'Could not load project for editing.')
      return
    }
    setEditId(row.id)
    setEditJobId(row.job_id)
    setEditTitle(row.title)
    setEditNotes(row.workspace_summary ?? row.brief_ai_context ?? '')
    setEditOutputs(row.brief_ai_outputs ?? {})
    setEditOpen(true)
  }

  const saveEdit = async () => {
    const t = editTitle.trim()
    if (!editId || !t || actingId) return
    setActingId(editId)
    setError(null)
    const { error: updErr } = await supabase
      .from('projects')
      .update({
        title: t,
        brief_ai_context: editNotes.trim() || null,
        brief_ai_outputs: { ...editOutputs, workspace_summary: editNotes.trim() || '' },
      })
      .eq('id', editId)
    if (!updErr && editJobId) {
      await supabase.from('jobs').update({ title: t }).eq('id', editJobId)
    }
    setActingId(null)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setEditOpen(false)
    setEditId(null)
    setEditJobId(null)
    setEditTitle('')
    setEditNotes('')
    setEditOutputs({})
    await load({ force: true })
  }

  const archiveProject = async (item: ProjectListing) => {
    if (actingId || item.kind !== 'private') return
    const user = await getAuthUser()
    if (!user) {
      setError('Please sign in again.')
      return
    }
    setActingId(item.id)
    setError(null)
    const row = await fetchProjectForEdit(item.id)
    const next = row?.status === 'archived' ? 'active' : 'archived'
    const { error: updErr } = await supabase
      .from('projects')
      .update({ status: next })
      .eq('id', item.id)
      .eq('company_id', user.id)
    setActingId(null)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await load({ force: true })
  }

  const deleteProject = async (item: ProjectListing) => {
    if (actingId || item.kind !== 'private') return
    Alert.alert(
      'Delete project',
      'This removes the project permanently. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const user = await getAuthUser()
              if (!user) {
                setError('Please sign in again.')
                return
              }
              setActingId(item.id)
              setError(null)
              const { error: delErr } = await supabase
                .from('projects')
                .delete()
                .eq('id', item.id)
                .eq('company_id', user.id)
              setActingId(null)
              if (delErr) {
                setError(delErr.message)
                return
              }
              await load({ force: true })
            })()
          },
        },
      ]
    )
  }

  const renderCard = (item: ProjectListing) => (
    <View
      style={[
        styles.card,
        viewerRole === 'freelancer'
          ? item.kind === 'customer'
            ? styles.cardAccentCustomer
            : styles.cardAccentPrivate
          : null,
      ]}
    >
      <TouchableOpacity style={styles.cardMain} onPress={() => openListing(item)} activeOpacity={0.85}>
        <View style={styles.cardTop}>
          <Image
            source={{ uri: item.logoUrl }}
            style={[styles.logo, item.kind === 'private' ? styles.logoRound : styles.logoSquare]}
          />
          <View style={styles.cardHead}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              {viewerRole === 'freelancer' ? (
                <View
                  style={[
                    styles.kindPill,
                    item.kind === 'customer' ? styles.kindPillCustomer : styles.kindPillPrivate,
                  ]}
                >
                  <Text
                    style={[
                      styles.kindPillText,
                      item.kind === 'customer' ? styles.kindPillTextCustomer : styles.kindPillTextPrivate,
                    ]}
                  >
                    {item.kind === 'customer' ? 'Client job' : 'Private'}
                  </Text>
                </View>
              ) : null}
              <View
                style={[
                  styles.badgeStatus,
                  item.statusLabel === 'COMPLETED'
                    ? styles.badgeCompleted
                    : item.statusLabel === 'RECRUITING'
                      ? styles.badgeRecruiting
                      : item.statusLabel === 'ARCHIVED'
                        ? styles.badgeArchived
                        : styles.badgeActive,
                ]}
              >
                <Text style={styles.badgeStatusText}>{item.statusLabel}</Text>
              </View>
            </View>
            {item.subtitle ? (
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {item.subtitle}
              </Text>
            ) : null}
            <Text style={styles.cardMeta}>
              {item.statusLabel} · {item.categoryLabel} · Updated {fmtDate(item.updatedAt)}
            </Text>
          </View>
        </View>
        <Text style={styles.budgetLine}>{item.budgetLine}</Text>
      </TouchableOpacity>

      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.cardBtnPrimary} onPress={() => openListing(item)}>
          <Text style={styles.cardBtnPrimaryText}>Open</Text>
        </TouchableOpacity>
        {item.kind === 'private' ? (
          <>
            <TouchableOpacity style={styles.cardBtnGhost} onPress={() => void openEdit(item)}>
              <Text style={styles.cardBtnGhostText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cardBtnGhost}
              onPress={() => void archiveProject(item)}
              disabled={actingId === item.id}
            >
              <Text style={styles.cardBtnGhostText}>{item.isArchived ? 'Unarchive' : 'Archive'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cardBtnDanger}
              onPress={() => void deleteProject(item)}
              disabled={actingId === item.id}
            >
              <Text style={styles.cardBtnDangerText}>Delete</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </View>
  )

  if (loading || allowed === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingShell}>
          <ScreenListSkeleton rows={6} />
        </View>
      </SafeAreaView>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.blockTitle}>Freelancers only</Text>
          <Text style={styles.blockSub}>
            This overview is for freelancer or company accounts.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Dashboard</Text>
        </TouchableOpacity>
        {canCreatePrivate ? (
          <TouchableOpacity style={styles.newBtn} onPress={() => setCreateOpen(true)}>
            <Plus size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
            <Text style={styles.newBtnText}>New project</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.newBtnPlaceholder} />
        )}
      </View>

      <Text style={styles.title}>Projects</Text>
      <Text style={styles.sub}>
        {viewerRole === 'company'
          ? 'Your company projects. You can open, edit, archive, or delete them here.'
          : "Private workspaces (your avatar) and customer jobs you're booked on — same overview as on the web. Budget comes from each project or job."}
      </Text>
      {!canCreatePrivate ? (
        <Text style={styles.planHint}>
          Upgrade to Pro or Workspace on the web to create new private projects (Starter can still manage jobs you're hired
          for).
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SectionList
        sections={listingSections}
        keyExtractor={(item) => item.id}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={8}
        removeClippedSubviews
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
            </View>
          ) : null
        }
        SectionSeparatorComponent={() => <View style={styles.sectionGap} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptySub}>
              Accept a job from the Jobs tab, or create a private workspace when your plan allows.
            </Text>
            {canCreatePrivate ? (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setCreateOpen(true)}>
                <Text style={styles.emptyBtnText}>+ New private project</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <View style={styles.cardWrap}>{renderCard(item)}</View>}
        ListFooterComponent={
          archivedListings.length ? (
            <View style={styles.archiveWrap}>
              <TouchableOpacity style={styles.archiveHeader} onPress={() => setArchiveOpen((v) => !v)}>
                <Text style={styles.archiveTitle}>Archived ({archivedListings.length})</Text>
                <Text style={styles.archiveToggle}>{archiveOpen ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
              {archiveOpen ? (
                <View style={styles.archiveList}>{archivedListings.map((item) => <View key={item.id}>{renderCard(item)}</View>)}</View>
              ) : null}
            </View>
          ) : null
        }
      />

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New project</Text>
            <Text style={styles.modalSub}>
              Creates a private workspace only. It will not appear on the Jobs tab for other users.
            </Text>

            <Text style={styles.fieldLabel}>Project name</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Brand film — spring"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlignVertical="top"
              placeholder="Short context for yourself — you can add more in the workspace."
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setCreateOpen(false)}
                disabled={creating}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAccent, (!title.trim() || creating) && styles.dim]}
                onPress={onCreate}
                disabled={!title.trim() || creating}
              >
                <Text style={styles.modalBtnAccentText}>{creating ? 'Creating…' : 'Create & open workspace'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit project</Text>
            <Text style={styles.modalSub}>Update project title and notes for this private workspace project.</Text>

            <Text style={styles.fieldLabel}>Project name</Text>
            <TextInput
              style={styles.input}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Project name"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              value={editNotes}
              onChangeText={setEditNotes}
              multiline
              textAlignVertical="top"
              placeholder="Project context"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setEditOpen(false)}
                disabled={!!actingId}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAccent, (!editTitle.trim() || !!actingId) && styles.dim]}
                onPress={() => void saveEdit()}
                disabled={!editTitle.trim() || !!actingId}
              >
                <Text style={styles.modalBtnAccentText}>{actingId ? 'Saving…' : 'Save changes'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  topRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 16, color: '#FFDC00', fontWeight: '600' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#FFDC00',
  },
  newBtnPlaceholder: { minWidth: 1, minHeight: 36 },
  newBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 12 },
  title: { fontSize: 26, color: '#fff', fontWeight: '900', paddingHorizontal: 20, marginTop: 10 },
  sub: { fontSize: 13, color: 'rgba(255,255,255,0.4)', paddingHorizontal: 20, marginTop: 6, marginBottom: 8 },
  planHint: {
    fontSize: 12,
    color: 'rgba(255,220,0,0.55)',
    paddingHorizontal: 20,
    marginBottom: 10,
    lineHeight: 17,
  },
  error: { fontSize: 12, color: '#ff9b9b', paddingHorizontal: 20, marginBottom: 8 },
  list: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  sectionHeader: { paddingTop: 6, paddingBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 0.4, textTransform: 'uppercase' },
  sectionSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.38)',
    marginTop: 4,
    lineHeight: 16,
  },
  sectionGap: { height: 14 },
  cardWrap: { marginBottom: 12 },
  card: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  cardAccentCustomer: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,220,0,0.65)',
  },
  cardAccentPrivate: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,255,255,0.22)',
  },
  cardMain: { padding: 14 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  logo: { width: 48, height: 48, backgroundColor: '#fff' },
  logoRound: { borderRadius: 24 },
  logoSquare: { borderRadius: 12 },
  cardHead: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 16, color: '#fff', fontWeight: '800', flex: 1, minWidth: 0 },
  kindPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  kindPillCustomer: {
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderColor: 'rgba(255,220,0,0.35)',
  },
  kindPillPrivate: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.14)',
  },
  kindPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  kindPillTextCustomer: { color: '#FFDC00' },
  kindPillTextPrivate: { color: 'rgba(255,255,255,0.55)' },
  badgeStatus: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeActive: {
    backgroundColor: 'rgba(40,205,65,0.12)',
    borderColor: 'rgba(40,205,65,0.28)',
  },
  badgeCompleted: {
    backgroundColor: 'rgba(255,220,0,0.12)',
    borderColor: 'rgba(255,220,0,0.28)',
  },
  badgeRecruiting: {
    backgroundColor: 'rgba(64,156,255,0.12)',
    borderColor: 'rgba(64,156,255,0.28)',
  },
  badgeArchived: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  badgeStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#fff',
    textTransform: 'uppercase',
  },
  cardSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginBottom: 4 },
  cardMeta: { fontSize: 11, color: 'rgba(255,255,255,0.32)' },
  budgetLine: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 0.3,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
  },
  cardBtnPrimary: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#FFDC00' },
  cardBtnPrimaryText: { fontSize: 12, color: '#0a0a0a', fontWeight: '800' },
  cardBtnGhost: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  cardBtnGhostText: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  cardBtnDanger: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,120,120,0.45)',
    backgroundColor: 'rgba(255,80,80,0.06)',
  },
  cardBtnDangerText: { fontSize: 12, color: '#ff8e8e', fontWeight: '800' },
  emptyCard: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    padding: 20,
    alignItems: 'center',
  },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  emptySub: { color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', marginBottom: 14, lineHeight: 18 },
  emptyBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: '#FFDC00' },
  emptyBtnText: { color: '#0a0a0a', fontWeight: '800' },
  loadingShell: { flex: 1, paddingHorizontal: 20, paddingTop: 24, justifyContent: 'flex-start' },
  archiveWrap: { marginTop: 14 },
  archiveHeader: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#101010',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  archiveTitle: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '800' },
  archiveToggle: { color: '#FFDC00', fontSize: 12, fontWeight: '700' },
  archiveList: { marginTop: 8, gap: 12 },
  blockTitle: { fontSize: 19, color: '#fff', fontWeight: '800', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 20 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#141414',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 18,
  },
  modalTitle: { fontSize: 30, fontWeight: '900', color: '#FFDC00', textTransform: 'uppercase', marginBottom: 6 },
  modalSub: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 14 },
  fieldLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 7,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    backgroundColor: '#1c1c1c',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  inputTall: { minHeight: 110 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: 'center' },
  modalBtnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  modalBtnGhostText: { color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  modalBtnAccent: { backgroundColor: '#FFDC00' },
  modalBtnAccentText: { color: '#0a0a0a', fontWeight: '800' },
  dim: { opacity: 0.6 },
})

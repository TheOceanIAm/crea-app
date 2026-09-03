import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  ChevronLeft,
  Clapperboard,
  ClipboardList,
  Phone,
  Video,
  Sparkles,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { ensureSoloWorkspaceProjectRow } from '@/lib/ensureSoloWorkspaceProject'
import { ensureMarketplaceJobWorkspaceRow } from '@/lib/ensureMarketplaceJobWorkspace'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { ICON_STROKE } from '@/lib/iconTheme'
import { ProjectMilestonesTab } from '@/components/project/ProjectMilestonesTab'
import { ProjectMessagesTab } from '@/components/project/ProjectMessagesTab'
import { ProjectBudgetTab } from '@/components/project/ProjectBudgetTab'
import { ProjectCrewTab } from '@/components/project/ProjectCrewTab'
import { ProjectFilesTab } from '@/components/project/ProjectFilesTab'
import { ProjectReviewTab } from '@/components/project/ProjectReviewTab'
import { ProductionTab } from '@/app/components/project/[projectId]/ProductionTab'
import { ProjectOverviewAbout } from '@/components/project/ProjectOverviewAbout'
import { ProjectOverviewProductionWindow } from '@/components/project/ProjectOverviewProductionWindow'
import { BriefAiFormattedOutput } from '@/components/project/BriefAiFormattedOutput'
import { countProjectCrewMembers, crewMembersSubLabel } from '@/lib/projectCrewCount'
import { formatProjectBudgetLine } from '@/lib/budgetFormatting'
import {
  PROJECT_STATUS_PILL,
  projectStatusDisplayLabel,
  projectStatusVariant,
} from '@/lib/projectStatusDisplay'
import { resolveCompanySubscriptionPlanFromSources } from '@/lib/companyPlanFromSession'
import { isCompanyPro } from '@/lib/company-plan'
import {
  isFreelancerStarterPlan,
  isFreelancerWorkspaceOnlyPlan,
  resolveFreelancerPlanFromUser,
} from '@/lib/freelancerPlan'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import {
  freelancerProductionSunAllowed,
  freelancerProductionWeatherAllowed,
} from '@/lib/sunPlannerWorkspaceTrial'
import { runTimed } from '@/lib/perfMarks'
import { CREA_API_WORKSPACE_TIMEOUT_MS, fetchCreaApi } from '@/lib/creaApiFetch'
import {
  cacheProjectShell,
  hydrateProjectShellFromDisk,
  persistProjectShellToDisk,
  readCachedProjectShell,
} from '@/lib/projectShellCache'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'

type TabId =
  | 'overview'
  | 'milestones'
  | 'production'
  | 'crew'
  | 'budget'
  | 'messages'
  | 'files'
  | 'review'
  | 'brief'

type ProjectRow = {
  id: string
  job_id: string | null
  company_id: string
  freelancer_id: string
  title: string
  status: string
  budget_amount: number | null
  budget_type: string | null
  budget_currency: string | null
  location: string | null
  milestones_completed: number
  milestones_total: number
  brief_ai_context: string | null
  frame_io_url: string | null
  picdrop_url: string | null
  brief_ai_outputs: Record<string, string> | null
  scheduling_start_date: string | null
  scheduling_end_date: string | null
}

type ApplyBriefProdResult = {
  ok?: boolean
  error?: string
  hint?: string
  shotsInserted?: number
  crewUpdated?: number
  createdDay?: boolean
}

async function readFunctionErrorDetails(error: unknown): Promise<{ message: string; hint?: string } | null> {
  const e = error as { context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } } | null
  const ctx = e?.context
  if (!ctx) return null
  try {
    if (typeof ctx.json === 'function') {
      const body = (await ctx.json()) as { error?: unknown; hint?: unknown; details?: unknown } | null
      const msg =
        typeof body?.error === 'string'
          ? body.error
          : typeof body?.details === 'string'
            ? body.details
            : null
      if (msg) {
        return {
          message: msg,
          hint: typeof body?.hint === 'string' ? body.hint : undefined,
        }
      }
    }
    if (typeof ctx.text === 'function') {
      const t = await ctx.text()
      if (t.trim()) return { message: t.trim() }
    }
  } catch {
    // no-op: fall back to generic error below
  }
  return null
}

function parseIsoDateInput(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return t
}

function todayLocalISODate(): string {
  const t = new Date()
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const BASE_TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'production', label: 'Production' },
  { id: 'crew', label: 'Crew' },
  { id: 'messages', label: 'Messages' },
  { id: 'files', label: 'Files' },
  { id: 'review', label: 'Review' },
  { id: 'brief', label: 'Brief AI' },
]

/** Same phase labels as web job workspace (`jobs.project_status`). */
const JOB_PROJECT_PHASES = ['recruiting', 'active', 'completed'] as const
type JobProjectPhase = (typeof JOB_PROJECT_PHASES)[number]

const TOOLS: { id: string; title: string; sub: string; icon: LucideIcon }[] = [
  { id: 'shotlist', title: 'Shotlist', sub: 'Shot-by-shot breakdown.', icon: Clapperboard },
  {
    id: 'tasks',
    title: 'Task breakdown',
    sub: 'Phases, RACI-style tables & checklists.',
    icon: ClipboardList,
  },
  {
    id: 'callsheet',
    title: 'Call sheet',
    sub: 'Timeline, travel legs, distances & crew calls.',
    icon: Phone,
  },
  {
    id: 'gear',
    title: 'Equipment list',
    sub: 'Qty, specs, tables by department.',
    icon: Video,
  },
]

export default function ProjectWorkspaceScreen() {
  const { id, tab: tabParam, tool: toolParam, day: dayParam } = useLocalSearchParams<{
    id: string
    tab?: string | string[]
    tool?: string | string[]
    day?: string | string[]
  }>()
  const router = useRouter()
  const bootShell =
    typeof id === 'string' && id ? readCachedProjectShell(id) : null
  const [loading, setLoading] = useState(!bootShell)
  const [forbidden, setForbidden] = useState(false)
  const [project, setProject] = useState<ProjectRow | null>(bootShell?.project ?? null)
  const [userId, setUserId] = useState<string | null>(null)
  const [workspaceOnlyPlan, setWorkspaceOnlyPlan] = useState(false)
  const [starterFreelancerPlan, setStarterFreelancerPlan] = useState(false)
  const [sunPlannerEnabled, setSunPlannerEnabled] = useState(false)
  const [productionWeatherEnabled, setProductionWeatherEnabled] = useState(false)
  const [sunPlannerLockedHint, setSunPlannerLockedHint] = useState<string | null>(null)
  const [productionWeatherLockedHint, setProductionWeatherLockedHint] = useState<string | null>(null)
  const [isPrivateWorkspace, setIsPrivateWorkspace] = useState(Boolean(bootShell?.isPrivateWorkspace))
  /** `jobs.company_id` — same owner check as web ManageJobClient (`isOwner`). */
  const [jobOwnerCompanyId, setJobOwnerCompanyId] = useState<string | null>(
    bootShell?.jobOwnerCompanyId ?? null
  )
  const [pipelineStatCount, setPipelineStatCount] = useState(0)
  const initialTab = (Array.isArray(tabParam) ? tabParam[0] : tabParam) as TabId | undefined
  const initialTool = Array.isArray(toolParam) ? toolParam[0] : toolParam
  const initialDayRaw = Array.isArray(dayParam) ? dayParam[0] : dayParam
  const initialDay =
    typeof initialDayRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(initialDayRaw.trim())
      ? initialDayRaw.trim().slice(0, 10)
      : ''
  const [tab, setTab] = useState<TabId>(
    initialTab &&
      ['overview', 'milestones', 'production', 'crew', 'budget', 'messages', 'files', 'review', 'brief'].includes(
        initialTab
      )
      ? initialTab
      : 'overview'
  )
  const [tool, setTool] = useState<string>(
    initialTool && ['tasks', 'shotlist', 'callsheet', 'gear', 'sun', 'weather'].includes(initialTool)
      ? initialTool
      : ''
  )
  const [shootDayParam, setShootDayParam] = useState<string>(initialDay)
  const [briefText, setBriefText] = useState(bootShell?.project.brief_ai_context ?? '')
  const [overviewSummary, setOverviewSummary] = useState(bootShell?.overviewSummary ?? '')
  const [overviewBudgetAmount, setOverviewBudgetAmount] = useState('')
  const [overviewBudgetType, setOverviewBudgetType] = useState('')
  const [overviewStatus, setOverviewStatus] = useState('active')
  const [overviewEditOpen, setOverviewEditOpen] = useState(false)
  const [savingBrief, setSavingBrief] = useState(false)
  const [savingOverview, setSavingOverview] = useState(false)
  const [savingProjectSummary, setSavingProjectSummary] = useState(false)
  const [savingJobPhaseStatus, setSavingJobPhaseStatus] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [scheduleStart, setScheduleStart] = useState('')
  const [scheduleEnd, setScheduleEnd] = useState('')
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [productionApplyDate, setProductionApplyDate] = useState('')
  const [applyingProd, setApplyingProd] = useState(false)
  const bodyScrollRef = useRef<ScrollView | null>(null)

  const refreshProjectCounts = useCallback(async () => {
    if (!project?.id) return
    const companyOwnsProject = Boolean(userId && project.company_id === userId)
    const [{ data: next }, jobRow] = await Promise.all([
      supabase
        .from('projects')
        .select('milestones_completed, milestones_total')
        .eq('id', project.id)
        .maybeSingle(),
      project.job_id
        ? supabase
            .from('jobs')
            .select('is_solo_workspace, company_id')
            .eq('id', project.job_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const soloPrivate = Boolean(
      jobRow.data?.is_solo_workspace &&
        userId &&
        String(jobRow.data.company_id ?? '') === userId
    )
    setIsPrivateWorkspace(soloPrivate)

    if (next) {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              milestones_completed:
                typeof (next as { milestones_completed?: unknown }).milestones_completed === 'number'
                  ? ((next as { milestones_completed: number }).milestones_completed ?? prev.milestones_completed)
                  : prev.milestones_completed,
              milestones_total:
                typeof (next as { milestones_total?: unknown }).milestones_total === 'number'
                  ? ((next as { milestones_total: number }).milestones_total ?? prev.milestones_total)
                  : prev.milestones_total,
            }
          : prev
      )
    }

    if (!companyOwnsProject || !project.job_id) {
      setPipelineStatCount(0)
      return
    }
    if (soloPrivate) {
      setPipelineStatCount(await countProjectCrewMembers(supabase, project.id))
      return
    }
    const { count } = await supabase
      .from('job_applications')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', project.job_id)
    setPipelineStatCount(count ?? 0)
  }, [project?.id, project?.job_id, project?.company_id, userId])

  const load = useCallback(async () => {
    const timed = await runTimed('project-workspace.load', async () => {
    if (!id || typeof id !== 'string') {
      setSunPlannerEnabled(false)
      setProductionWeatherEnabled(false)
      setSunPlannerLockedHint(null)
      setProductionWeatherLockedHint(null)
      setLoading(false)
      return
    }
    const user = await getAuthUser()
    if (!user) {
      setForbidden(true)
      setWorkspaceOnlyPlan(false)
      setStarterFreelancerPlan(false)
      setSunPlannerEnabled(false)
      setProductionWeatherEnabled(false)
      setSunPlannerLockedHint(null)
      setProductionWeatherLockedHint(null)
      setLoading(false)
      return
    }
    setUserId(user.id)

    // Instant paint from mem/disk shell while network revalidates.
    let shellHit = readCachedProjectShell(id)
    if (!shellHit) {
      shellHit = await hydrateProjectShellFromDisk(id)
    }
    if (shellHit?.project) {
      setProject(shellHit.project)
      setOverviewSummary(shellHit.overviewSummary)
      setIsPrivateWorkspace(shellHit.isPrivateWorkspace)
      setJobOwnerCompanyId(shellHit.jobOwnerCompanyId)
      setBriefText(shellHit.project.brief_ai_context ?? '')
      setLoading(false)
    }

    // Aggregate + local in parallel: paint from Supabase ASAP, upgrade when API returns.
    // (Awaiting the API first made cold opens feel stuck for up to ~timeout × host retries.)
    type ShellPayload = {
      access: string
      isOwner: boolean
      viewerFreelancerPlan?: string
      job: {
        description?: string | null
        is_solo_workspace?: boolean | null
        company_id?: string
        project_status?: string | null
      } | null
      project: ProjectRow | null
      counts?: { applicantsTotal?: number; acceptedCrew?: number }
      workspaceSummaryDraft?: string
    }
    const aggregatePromise = (async (): Promise<ShellPayload | null> => {
      try {
        const { data: shellJson, error: shellErr } = await fetchCreaApi<{ payload?: ShellPayload }>(
          `/api/app/job-workspace/${encodeURIComponent(id)}`,
          { timeoutMs: CREA_API_WORKSPACE_TIMEOUT_MS }
        )
        const shell = shellJson?.payload
        if (!shellErr && shell?.access === 'allowed' && shell.project) return shell
      } catch {
        // fall through — local path paints / decides forbidden
      }
      return null
    })()

    const [profileRes, projectRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('role, subscription_tier')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('projects')
        .select(
          'id, job_id, company_id, freelancer_id, title, status, budget_amount, budget_type, budget_currency, location, milestones_completed, milestones_total, brief_ai_context, frame_io_url, picdrop_url, brief_ai_outputs, scheduling_start_date, scheduling_end_date'
        )
        .eq('id', id)
        .maybeSingle(),
    ])
    const profile = profileRes.data
    const role = resolveAppRole(profile?.role, user)
    const freelancerPlan = resolveFreelancerPlanFromUser(user)
    const isStarterFreelancer = isFreelancerProfile(role) && isFreelancerStarterPlan(freelancerPlan)
    setStarterFreelancerPlan(isStarterFreelancer)

    let sunTrialIso: string | null = null
    if (
      isFreelancerProfile(role) &&
      (isFreelancerWorkspaceOnlyPlan(freelancerPlan) || isFreelancerStarterPlan(freelancerPlan))
    ) {
      const { data: trialData } = await supabase.rpc('touch_sun_planner_trial_start')
      sunTrialIso = typeof trialData === 'string' ? trialData : null
    }

    let companyPlan: 'free' | 'pro' = 'free'
    if (role === 'company') {
      const { data: cp } = await supabase
        .from('company_profiles')
        .select('subscription_plan')
        .eq('id', user.id)
        .maybeSingle()
      companyPlan = resolveCompanySubscriptionPlanFromSources(
        user,
        (profile as { subscription_tier?: string | null } | null)?.subscription_tier,
        (cp as { subscription_plan?: string } | null)?.subscription_plan
      )
    }
    const companySunAccess = role === 'company' && isCompanyPro(companyPlan)

    setWorkspaceOnlyPlan(
      isFreelancerProfile(role) && isFreelancerWorkspaceOnlyPlan(freelancerPlan)
    )

    const PROJECT_SHELL_SELECT =
      'id, job_id, company_id, freelancer_id, title, status, budget_amount, budget_type, budget_currency, location, milestones_completed, milestones_total, brief_ai_context, frame_io_url, picdrop_url, brief_ai_outputs, scheduling_start_date, scheduling_end_date'

    let row = projectRes.data
    let projErr = projectRes.error
    if (projErr || !row) {
      const ensured = await ensureSoloWorkspaceProjectRow(supabase, { projectOrJobId: id, userId: user.id })
      if (ensured.ok) {
        const again = await supabase.from('projects').select(PROJECT_SHELL_SELECT).eq('id', id).maybeSingle()
        row = again.data
        projErr = again.error
      }
    }
    if (projErr || !row) {
      const ensuredMarketplace = await ensureMarketplaceJobWorkspaceRow(supabase, {
        jobId: id,
        userId: user.id,
      })
      if (ensuredMarketplace.ok) {
        const again = await supabase.from('projects').select(PROJECT_SHELL_SELECT).eq('id', id).maybeSingle()
        row = again.data
        projErr = again.error
      }
    }
    if (projErr || !row) {
      // Local miss — still wait for aggregate (may resolve job→project mapping).
      const shellOnly = await aggregatePromise
      if (shellOnly?.project) {
        const ap = shellOnly.project
        const freelancerPlanAgg = resolveFreelancerPlanFromUser(user)
        const roleHint = shellOnly.isOwner ? 'company' : 'freelancer'
        setStarterFreelancerPlan(roleHint !== 'company' && isFreelancerStarterPlan(freelancerPlanAgg))
        setWorkspaceOnlyPlan(
          roleHint !== 'company' && isFreelancerWorkspaceOnlyPlan(freelancerPlanAgg)
        )
        setIsPrivateWorkspace(Boolean(shellOnly.job?.is_solo_workspace && shellOnly.isOwner))
        setJobOwnerCompanyId(
          typeof shellOnly.job?.company_id === 'string' ? shellOnly.job.company_id : ap.company_id
        )
        setProject(ap)
        setBriefText(ap.brief_ai_context ?? '')
        const aggOverview =
          (shellOnly.workspaceSummaryDraft || '').trim() ||
          (typeof shellOnly.job?.description === 'string' ? shellOnly.job.description.trim() : '') ||
          (ap.brief_ai_context ?? '').trim()
        setOverviewSummary(aggOverview)
        setOverviewBudgetAmount(typeof ap.budget_amount === 'number' ? String(ap.budget_amount) : '')
        setOverviewBudgetType(ap.budget_type ?? '')
        setOverviewStatus(ap.status)
        setScheduleStart(
          typeof ap.scheduling_start_date === 'string' ? ap.scheduling_start_date.slice(0, 10) : ''
        )
        setScheduleEnd(
          typeof ap.scheduling_end_date === 'string' ? ap.scheduling_end_date.slice(0, 10) : ''
        )
        setPipelineStatCount(
          shellOnly.isOwner
            ? shellOnly.job?.is_solo_workspace
              ? shellOnly.counts?.acceptedCrew ?? 0
              : shellOnly.counts?.applicantsTotal ?? 0
            : 0
        )
        {
          let nextSun = false
          let nextWeather = false
          let nextSunHint: string | null = null
          let nextWeatherHint: string | null = null
          if (role === 'company') {
            nextSun = companySunAccess
            nextWeather = companySunAccess
          } else if (isFreelancerProfile(role)) {
            nextSun = freelancerProductionSunAllowed(freelancerPlan, sunTrialIso)
            nextWeather = freelancerProductionWeatherAllowed(freelancerPlan, sunTrialIso)
            if (!nextSun) {
              nextSunHint = isFreelancerStarterPlan(freelancerPlan)
                ? 'Sun Planner: your 14-day trial has ended. Upgrade to Pro for full access.'
                : isFreelancerWorkspaceOnlyPlan(freelancerPlan)
                  ? 'Sun Planner is available on Pro. Upgrade to unlock production scheduling.'
                  : 'Sun Planner is not available on your current plan.'
            }
            if (!nextWeather) {
              nextWeatherHint =
                'Weather in production tools is available on Pro. Upgrade to unlock full access.'
            }
          }
          setSunPlannerEnabled(nextSun)
          setProductionWeatherEnabled(nextWeather)
          setSunPlannerLockedHint(nextSunHint)
          setProductionWeatherLockedHint(nextWeatherHint)
        }
        setForbidden(false)
        setLoading(false)
        cacheProjectShell(id, {
          project: ap,
          overviewSummary: aggOverview,
          isPrivateWorkspace: Boolean(shellOnly.job?.is_solo_workspace && shellOnly.isOwner),
          jobOwnerCompanyId:
            typeof shellOnly.job?.company_id === 'string' ? shellOnly.job.company_id : ap.company_id,
        })
        void persistProjectShellToDisk(id, {
          project: ap,
          overviewSummary: aggOverview,
          isPrivateWorkspace: Boolean(shellOnly.job?.is_solo_workspace && shellOnly.isOwner),
          jobOwnerCompanyId:
            typeof shellOnly.job?.company_id === 'string' ? shellOnly.job.company_id : ap.company_id,
        })
        return { hasJob: Boolean(ap.job_id), via: 'aggregate' as const }
      }
      setForbidden(true)
      setProject(null)
      setSunPlannerEnabled(false)
      setProductionWeatherEnabled(false)
      setSunPlannerLockedHint(null)
      setProductionWeatherLockedHint(null)
      setLoading(false)
      return
    }

    const p = row as ProjectRow

    const viewerIsCompanyOnProject = p.company_id === user.id

    const jobLookupId = p.job_id != null ? String(p.job_id).trim() : p.id
    const { data: jobPhase } = jobLookupId
      ? await supabase
          .from('jobs')
          .select('project_status, description, is_solo_workspace, company_id')
          .eq('id', jobLookupId)
          .maybeSingle()
      : { data: null }
    const soloPrivate = Boolean(
      jobPhase?.is_solo_workspace && String(jobPhase.company_id ?? '') === user.id
    )
    setIsPrivateWorkspace(soloPrivate)
    const jobCompanyId =
      jobPhase && typeof (jobPhase as { company_id?: string | null }).company_id === 'string'
        ? String((jobPhase as { company_id: string }).company_id).trim()
        : ''
    setJobOwnerCompanyId(jobCompanyId || null)
    let mergedStatus = (p.status || 'active').trim() || 'active'
    const ps =
      jobPhase && typeof (jobPhase as { project_status?: string | null }).project_status === 'string'
        ? String((jobPhase as { project_status: string }).project_status).trim()
        : ''
    if (ps) mergedStatus = ps

    let nextSun = false
    let nextWeather = false
    let nextSunHint: string | null = null
    let nextWeatherHint: string | null = null
    if (role === 'company') {
      nextSun = companySunAccess
      nextWeather = companySunAccess
    } else if (isFreelancerProfile(role)) {
      nextSun = freelancerProductionSunAllowed(freelancerPlan, sunTrialIso)
      nextWeather = freelancerProductionWeatherAllowed(freelancerPlan, sunTrialIso)
      if (!nextSun) {
        if (isFreelancerStarterPlan(freelancerPlan)) {
          nextSunHint =
            'Sun Planner: your 14-day trial has ended. Upgrade to Pro for full access.'
        } else if (isFreelancerWorkspaceOnlyPlan(freelancerPlan)) {
          nextSunHint =
            'Sun Planner is available on Pro. Upgrade to unlock production scheduling.'
        } else {
          nextSunHint = 'Sun Planner is not available on your current plan.'
        }
      }
      if (!nextWeather) {
        nextWeatherHint =
          'Weather in production tools is available on Pro. Upgrade to unlock full access.'
      }
    }
    setSunPlannerEnabled(nextSun)
    setProductionWeatherEnabled(nextWeather)
    setSunPlannerLockedHint(nextSunHint)
    setProductionWeatherLockedHint(nextWeatherHint)
    setProject({ ...p, status: mergedStatus })
    setBriefText(p.brief_ai_context ?? '')
    const workspaceSummary =
      p.brief_ai_outputs && typeof p.brief_ai_outputs.workspace_summary === 'string'
        ? p.brief_ai_outputs.workspace_summary.trim()
        : ''
    const jobListingDescription =
      jobPhase && typeof (jobPhase as { description?: string | null }).description === 'string'
        ? String((jobPhase as { description: string }).description).trim()
        : ''
    /** Same copy as web job listing / manage job: `jobs.description`. Fallback for legacy app-only edits. */
    const overviewText = p.job_id
      ? jobListingDescription || workspaceSummary || (p.brief_ai_context ?? '').trim()
      : workspaceSummary || (p.brief_ai_context ?? '').trim()
    setOverviewSummary(overviewText)
    setOverviewBudgetAmount(typeof p.budget_amount === 'number' ? String(p.budget_amount) : '')
    setOverviewBudgetType(p.budget_type ?? '')
    setOverviewStatus(mergedStatus)
    setScheduleStart(typeof p.scheduling_start_date === 'string' ? p.scheduling_start_date.slice(0, 10) : '')
    setScheduleEnd(typeof p.scheduling_end_date === 'string' ? p.scheduling_end_date.slice(0, 10) : '')
    setForbidden(false)

    if (viewerIsCompanyOnProject && p.job_id) {
      if (soloPrivate) {
        setPipelineStatCount(await countProjectCrewMembers(supabase, p.id))
      } else {
        const { count } = await supabase
          .from('job_applications')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', p.job_id)
        setPipelineStatCount(count ?? 0)
      }
    } else {
      setPipelineStatCount(0)
    }

    // Paint immediately from local Supabase — don't wait on cold serverless.
    setLoading(false)
    {
      const shellCache = {
        project: { ...p, status: mergedStatus },
        overviewSummary: overviewText,
        isPrivateWorkspace: soloPrivate,
        jobOwnerCompanyId: jobCompanyId || null,
      }
      cacheProjectShell(id, shellCache)
      void persistProjectShellToDisk(id, shellCache)
    }

    const shell = await aggregatePromise
    if (shell?.project) {
      const ap = shell.project
      const freelancerPlanAgg = resolveFreelancerPlanFromUser(user)
      const roleHint = shell.isOwner ? 'company' : 'freelancer'
      const isStarterFreelancerAgg =
        roleHint !== 'company' && isFreelancerStarterPlan(freelancerPlanAgg)
      setStarterFreelancerPlan(isStarterFreelancerAgg)
      setWorkspaceOnlyPlan(
        roleHint !== 'company' && isFreelancerWorkspaceOnlyPlan(freelancerPlanAgg)
      )
      setIsPrivateWorkspace(Boolean(shell.job?.is_solo_workspace && shell.isOwner))
      setJobOwnerCompanyId(
        typeof shell.job?.company_id === 'string' ? shell.job.company_id : ap.company_id
      )
      setProject(ap)
      setBriefText(ap.brief_ai_context ?? '')
      const aggOverview =
        (shell.workspaceSummaryDraft || '').trim() ||
        (typeof shell.job?.description === 'string' ? shell.job.description.trim() : '') ||
        (ap.brief_ai_context ?? '').trim()
      setOverviewSummary(aggOverview)
      setOverviewBudgetAmount(typeof ap.budget_amount === 'number' ? String(ap.budget_amount) : '')
      setOverviewBudgetType(ap.budget_type ?? '')
      setOverviewStatus(ap.status)
      setScheduleStart(
        typeof ap.scheduling_start_date === 'string' ? ap.scheduling_start_date.slice(0, 10) : ''
      )
      setScheduleEnd(
        typeof ap.scheduling_end_date === 'string' ? ap.scheduling_end_date.slice(0, 10) : ''
      )
      setPipelineStatCount(
        shell.isOwner
          ? shell.job?.is_solo_workspace
            ? shell.counts?.acceptedCrew ?? 0
            : shell.counts?.applicantsTotal ?? 0
          : 0
      )
      setForbidden(false)
      setLoading(false)
      cacheProjectShell(id, {
        project: ap,
        overviewSummary: aggOverview,
        isPrivateWorkspace: Boolean(shell.job?.is_solo_workspace && shell.isOwner),
        jobOwnerCompanyId:
          typeof shell.job?.company_id === 'string' ? shell.job.company_id : ap.company_id,
      })
      void persistProjectShellToDisk(id, {
        project: ap,
        overviewSummary: aggOverview,
        isPrivateWorkspace: Boolean(shell.job?.is_solo_workspace && shell.isOwner),
        jobOwnerCompanyId:
          typeof shell.job?.company_id === 'string' ? shell.job.company_id : ap.company_id,
      })
      return { hasJob: Boolean(ap.job_id), via: 'aggregate' as const }
    }

    return { hasJob: Boolean(p.job_id), via: 'local' as const }
    })
    if (__DEV__ && timed.value) {
      console.log(`[perf] project-workspace.meta: hasJob=${timed.value.hasJob}`)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (tab === 'overview') void refreshProjectCounts()
  }, [tab, refreshProjectCounts])


  useEffect(() => {
    if (!project) return
    // Match Production tab default (shoot list loads "today" until user changes the day there).
    setProductionApplyDate(todayLocalISODate())
  }, [project?.id])

  const viewerIsCompanyOnProject = Boolean(project && userId && project.company_id === userId)

  const linkedJobId = useMemo(() => {
    if (!project) return null
    const jid = project.job_id != null ? String(project.job_id).trim() : ''
    if (jid) return jid
    if (isPrivateWorkspace) return project.id
    return null
  }, [project, isPrivateWorkspace])

  const tabs = useMemo(() => {
    let list = [...BASE_TABS]
    if (viewerIsCompanyOnProject) {
      const ix = list.findIndex((t) => t.id === 'crew')
      const insertAt = ix >= 0 ? ix + 1 : list.length
      list = [...list.slice(0, insertAt), { id: 'budget' as const, label: 'Budget' }, ...list.slice(insertAt)]
    }
    return workspaceOnlyPlan ? list.filter((t) => t.id !== 'messages') : list
  }, [workspaceOnlyPlan, viewerIsCompanyOnProject])

  useEffect(() => {
    if (workspaceOnlyPlan && tab === 'messages') setTab('overview')
  }, [workspaceOnlyPlan, tab])

  useEffect(() => {
    if (tab === 'budget' && !viewerIsCompanyOnProject) setTab('overview')
  }, [tab, viewerIsCompanyOnProject])

  // Deep-link capture: /project/[id]?tab=milestones&tool=shotlist&day=2026-09-15
  useEffect(() => {
    const nextTab = (Array.isArray(tabParam) ? tabParam[0] : tabParam) as TabId | undefined
    if (
      nextTab &&
      ['overview', 'milestones', 'production', 'crew', 'budget', 'messages', 'files', 'review', 'brief'].includes(
        nextTab
      )
    ) {
      setTab(nextTab)
    }
    const nextTool = Array.isArray(toolParam) ? toolParam[0] : toolParam
    if (nextTool && ['tasks', 'shotlist', 'callsheet', 'gear', 'sun', 'weather'].includes(nextTool)) {
      setTool(nextTool)
    }
    const nextDay = Array.isArray(dayParam) ? dayParam[0] : dayParam
    if (typeof nextDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nextDay.trim())) {
      setShootDayParam(nextDay.trim().slice(0, 10))
    }
  }, [tabParam, toolParam, dayParam])

  const canManageCrew = useMemo(() => {
    if (!project || !userId) return false
    return project.company_id === userId || project.freelancer_id === userId
  }, [project, userId])

  /**
   * Phase (recruiting / active / completed): same source as web `jobs.project_status`.
   * Owner = `jobs.company_id` (web `isOwner`), not `projects.freelancer_id`.
   */
  const canEditJobProjectStatus = useMemo(() => {
    if (!project || !userId || !linkedJobId) return false
    const ownerId = (jobOwnerCompanyId && jobOwnerCompanyId.trim()) || project.company_id
    return ownerId === userId
  }, [project, userId, linkedJobId, jobOwnerCompanyId])

  const canEditProductionSchedule = useMemo(() => {
    if (!project || !userId) return false
    return project.company_id === userId
  }, [project, userId])

  const budgetLine = useMemo(() => {
    if (!project) return '—'
    return formatProjectBudgetLine({
      budget_amount: project.budget_amount,
      budget_type: project.budget_type,
      budget_currency: project.budget_currency,
    })
  }, [project])

  const currentOutput = project?.brief_ai_outputs?.[tool] ?? ''
  const canSyncProductionTool = tool === 'shotlist' || tool === 'callsheet'

  const invokeApplyBriefProduction = async (
    replaceShots: boolean,
    opts?: { date?: string; silentSuccess?: boolean }
  ) => {
    if (!project || !canSyncProductionTool) return
    const d = parseIsoDateInput((opts?.date ?? productionApplyDate).trim())
    if (!d) {
      Alert.alert('Date', 'Enter the shoot / production day as YYYY-MM-DD.')
      return
    }
    setApplyingProd(true)
    const { data, error } = await supabase.functions.invoke<ApplyBriefProdResult>('apply-brief-to-production', {
      body: { projectId: project.id, tool, shootDate: d, replaceShots },
    })
    setApplyingProd(false)
    if (error) {
      const details = await readFunctionErrorDetails(error)
      Alert.alert(
        'Apply failed',
        details
          ? [details.message, details.hint].filter(Boolean).join('\n\n')
          : `${error.message}\n\nDeploy the apply-brief-to-production Edge Function (see deploy-supabase.sh) and set ANTHROPIC_API_KEY.`
      )
      return
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
      const o = data as { error?: string; hint?: string }
      Alert.alert('Apply', [o.error, o.hint].filter(Boolean).join('\n\n'))
      return
    }
    if (data?.ok && tool === 'shotlist' && typeof data.shotsInserted === 'number') {
      if (!opts?.silentSuccess) {
        Alert.alert(
          'Shot list',
          `${data.shotsInserted} shot(s) for ${d}. Open the Production tab → Shotlist (same calendar day).`
        )
      }
      return
    }
    if (data?.ok && tool === 'callsheet') {
      const parts = [`Saved for ${d}.`]
      if (data.createdDay) parts.push('A production day was created.')
      parts.push(`${data.crewUpdated ?? 0} crew row(s) updated in the call sheet.`)
      if (!opts?.silentSuccess) Alert.alert('Call sheet', parts.join(' '))
      return
    }
    if (!opts?.silentSuccess) Alert.alert('Apply', 'Unexpected response from server.')
  }

  const onApplyShotlistChoices = () => {
    if (!currentOutput.trim()) {
      Alert.alert('Nothing to apply', 'Generate and save a shot list first.')
      return
    }
    const d = parseIsoDateInput(productionApplyDate.trim())
    if (!d) {
      Alert.alert('Date', 'Enter YYYY-MM-DD.')
      return
    }
    Alert.alert(
      'Apply to Production',
      `Add Brief AI shots to the Production shot list for ${d}. Append keeps existing rows for that day; Replace clears them first.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Append', onPress: () => void invokeApplyBriefProduction(false) },
        { text: 'Replace day', style: 'destructive', onPress: () => void invokeApplyBriefProduction(true) },
      ]
    )
  }

  const onApplyCallsheet = () => {
    if (!currentOutput.trim()) {
      Alert.alert('Nothing to apply', 'Generate and save a call sheet first.')
      return
    }
    const d = parseIsoDateInput(productionApplyDate.trim())
    if (!d) {
      Alert.alert('Date', 'Enter YYYY-MM-DD.')
      return
    }
    Alert.alert(
      'Apply to Production',
      `Merges call times into the production day for ${d}. If no day exists yet, it is created when you are the company on this project.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Apply', onPress: () => void invokeApplyBriefProduction(false) },
      ]
    )
  }

  const saveSchedule = async () => {
    if (!project) return
    const a = parseIsoDateInput(scheduleStart)
    const b = parseIsoDateInput(scheduleEnd)
    if (scheduleStart.trim() && !a) {
      Alert.alert('Schedule', 'Start date must be YYYY-MM-DD.')
      return
    }
    if (scheduleEnd.trim() && !b) {
      Alert.alert('Schedule', 'End date must be YYYY-MM-DD.')
      return
    }
    if (a && b && b < a) {
      Alert.alert('Schedule', 'End date must be on or after start date.')
      return
    }
    if ((a && !b) || (!a && b)) {
      Alert.alert('Schedule', 'Set both start and end, or clear both.')
      return
    }
    setSavingSchedule(true)
    const { error } = await supabase
      .from('projects')
      .update({
        scheduling_start_date: a,
        scheduling_end_date: b,
      })
      .eq('id', project.id)
    setSavingSchedule(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    setProject((prev) =>
      prev
        ? {
            ...prev,
            scheduling_start_date: a,
            scheduling_end_date: b,
          }
        : prev
    )
    Alert.alert('Saved', 'Production window updated.')
  }

  const clearSchedule = async () => {
    if (!project || !canEditProductionSchedule) return
    setSavingSchedule(true)
    const { error } = await supabase
      .from('projects')
      .update({
        scheduling_start_date: null,
        scheduling_end_date: null,
      })
      .eq('id', project.id)
    setSavingSchedule(false)
    if (error) {
      Alert.alert('Could not clear', error.message)
      return
    }
    setScheduleStart('')
    setScheduleEnd('')
    setProject((prev) =>
      prev ? { ...prev, scheduling_start_date: null, scheduling_end_date: null } : prev
    )
    Alert.alert('Cleared', 'Production dates removed.')
  }

  const saveBrief = async () => {
    if (!project) return
    setSavingBrief(true)
    const { error } = await supabase.rpc('project_update_brief', {
      p_project_id: project.id,
      p_context: briefText,
    })
    setSavingBrief(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    setProject((prev) => (prev ? { ...prev, brief_ai_context: briefText.trim() || null } : prev))
  }

  const persistJobProjectPhase = async (next: JobProjectPhase) => {
    if (!project || !linkedJobId || !canEditJobProjectStatus) return
    setSavingJobPhaseStatus(true)
    const { error: jErr } = await supabase
      .from('jobs')
      .update({ project_status: next })
      .eq('id', linkedJobId)
    if (jErr) {
      Alert.alert('Could not update status', jErr.message)
      setSavingJobPhaseStatus(false)
      return
    }
    const { error: pErr } = await supabase.from('projects').update({ status: next }).eq('id', project.id)
    setSavingJobPhaseStatus(false)
    if (pErr) {
      Alert.alert('Partial save', pErr.message)
      return
    }
    setProject((prev) => (prev ? { ...prev, status: next } : null))
    setOverviewStatus(next)
    if (next === 'completed' && linkedJobId) {
      void notifyExpoEvent({
        kind: 'workspace_activity',
        jobId: linkedJobId,
        activity: 'completed',
        detail: 'Project marked as completed',
      })
    }
  }

  const saveOverview = async () => {
    if (!project) return
    const rawBudget = overviewBudgetAmount.trim()
    const parsedBudget = rawBudget ? Number(rawBudget.replace(',', '.')) : null
    if (rawBudget && (!Number.isFinite(parsedBudget) || parsedBudget < 0)) {
      Alert.alert('Budget', 'Please enter a valid non-negative number.')
      return
    }
    let nextStatus = overviewStatus.trim() || 'active'
    if (project.job_id) {
      const lower = nextStatus.toLowerCase()
      nextStatus = JOB_PROJECT_PHASES.includes(lower as JobProjectPhase) ? lower : 'active'
    }
    const nextSummary = overviewSummary.trim()
    const prevOutputs = (project.brief_ai_outputs ?? {}) as Record<string, string>
    setSavingOverview(true)
    if (linkedJobId && canEditJobProjectStatus) {
      const { error: jobErr } = await supabase
        .from('jobs')
        .update({ project_status: nextStatus })
        .eq('id', linkedJobId)
      if (jobErr) {
        setSavingOverview(false)
        Alert.alert('Save failed', jobErr.message)
        return
      }
    }
    const { error } = await supabase
      .from('projects')
      .update({
        budget_amount: parsedBudget,
        budget_type: overviewBudgetType.trim() || null,
        status: nextStatus,
        brief_ai_outputs: { ...prevOutputs, workspace_summary: nextSummary },
      })
      .eq('id', project.id)
    if (error) {
      setSavingOverview(false)
      Alert.alert('Save failed', error.message)
      return
    }
    if (project.job_id) {
      const budgetType = overviewBudgetType.trim() || (parsedBudget != null ? 'fixed' : 'negotiable')
      const { error: jobBudgetErr } = await supabase
        .from('jobs')
        .update({
          budget_amount: parsedBudget,
          budget_type: budgetType,
          budget_currency: project.budget_currency ?? 'EUR',
        })
        .eq('id', project.job_id)
      if (jobBudgetErr) {
        setSavingOverview(false)
        Alert.alert('Partial save', `Overview saved, but job budget could not sync:\n${jobBudgetErr.message}`)
        return
      }
    }
    setSavingOverview(false)
    if (project.job_id && canEditProductionSchedule) {
      const { error: descErr } = await supabase
        .from('jobs')
        .update({ description: nextSummary })
        .eq('id', project.job_id)
      if (descErr) {
        Alert.alert(
          'Partial save',
          `Overview saved, but the job listing description could not sync:\n${descErr.message}`
        )
        return
      }
    }
    setProject((prev) =>
      prev
        ? {
            ...prev,
            budget_amount: parsedBudget,
            budget_type: overviewBudgetType.trim() || null,
            status: nextStatus,
            brief_ai_outputs: { ...prevOutputs, workspace_summary: nextSummary },
          }
        : prev
    )
    Alert.alert('Saved', 'Overview details were updated.')
  }

  const saveProjectSummary = async (): Promise<boolean> => {
    if (!project || !canEditProductionSchedule) return false
    const nextSummary = overviewSummary.trim()
    const prevOutputs = (project.brief_ai_outputs ?? {}) as Record<string, string>
    setSavingProjectSummary(true)
    const { error } = await supabase
      .from('projects')
      .update({
        brief_ai_outputs: { ...prevOutputs, workspace_summary: nextSummary },
      })
      .eq('id', project.id)
    setSavingProjectSummary(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return false
    }
    if (project.job_id) {
      const { error: jobDescErr } = await supabase
        .from('jobs')
        .update({ description: nextSummary })
        .eq('id', project.job_id)
      if (jobDescErr) {
        Alert.alert('Partial save', `Summary saved in the workspace, but not on the job listing:\n${jobDescErr.message}`)
        return false
      }
    }
    setProject((prev) =>
      prev
        ? {
            ...prev,
            brief_ai_outputs: { ...prevOutputs, workspace_summary: nextSummary },
          }
        : prev
    )
    Alert.alert('Saved', 'Project summary updated.')
    return true
  }

  const onGenerate = async () => {
    if (!project) return
    setGenerating(true)
    const { error: saveErr } = await supabase.rpc('project_update_brief', {
      p_project_id: project.id,
      p_context: briefText,
    })
    if (saveErr) {
      setGenerating(false)
      Alert.alert('Save failed', saveErr.message)
      return
    }
    setProject((prev) => (prev ? { ...prev, brief_ai_context: briefText.trim() || null } : prev))

    const { data, error } = await supabase.functions.invoke<{ content?: string; error?: string; hint?: string }>(
      'brief-ai',
      { body: { projectId: project.id, tool, context: briefText } }
    )
    setGenerating(false)

    if (error) {
      const details = await readFunctionErrorDetails(error)
      Alert.alert(
        'Generation failed',
        details
          ? [details.message, details.hint].filter(Boolean).join('\n\n')
          : `${error.message}\n\nDeploy the brief-ai Edge Function and set ANTHROPIC_API_KEY if you have not yet.`
      )
      return
    }

    if (data && typeof data === 'object' && 'error' in data && data.error) {
      Alert.alert('Brief AI', String(data.error))
      return
    }

    const content = data?.content
    if (typeof content !== 'string' || !content.trim()) {
      Alert.alert('Brief AI', 'No content returned. Check function logs and Anthropic billing.')
      return
    }

    const { error: mergeErr } = await supabase.rpc('project_merge_brief_output', {
      p_project_id: project.id,
      p_tool: tool,
      p_content: content,
    })
    if (mergeErr) {
      Alert.alert('Could not save output', mergeErr.message)
      return
    }

    setProject((prev) =>
      prev
        ? {
            ...prev,
            brief_ai_outputs: { ...(prev.brief_ai_outputs ?? {}), [tool]: content },
          }
        : prev
    )
    if (workspaceOnlyPlan && (tool === 'shotlist' || tool === 'callsheet')) {
      await invokeApplyBriefProduction(false)
    }
  }
  const focusOverviewSummary = useCallback(() => {
    if (tab !== 'overview') return
    // Wait a tick so keyboard animation starts before we reposition the form.
    setTimeout(() => {
      bodyScrollRef.current?.scrollTo({ y: 260, animated: true })
    }, 80)
  }, [tab])

  /** Opening workspace via replace/push can leave no stack — GO_BACK would warn in dev. */
  const exitProjectWorkspace = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    if (workspaceOnlyPlan || !project?.job_id) {
      router.replace('/(tabs)/workspace-projects')
      return
    }
    router.replace('/(tabs)/jobs')
  }, [router, workspaceOnlyPlan, project?.job_id])

  const exitProjectScreenFallbackHome = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/(tabs)/feed')
  }, [router])

  if (forbidden || (!loading && !project)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={exitProjectScreenFallbackHome}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Close</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.miss}>You don’t have access to this project.</Text>
        </View>
      </SafeAreaView>
    )
  }

  // Show shell as soon as we have a project (+ auth). Don't keep skeleton while API revalidates.
  if (!userId || !project) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={exitProjectScreenFallbackHome}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Close</Text>
        </TouchableOpacity>
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          {project?.title ? (
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12 }}>
              {project.title}
            </Text>
          ) : null}
          <ScreenListSkeleton rows={6} />
        </View>
      </SafeAreaView>
    )
  }

  const statusKey = projectStatusVariant(project.status)
  const pillTheme = PROJECT_STATUS_PILL[statusKey]

  const statsRow = (
    <View style={styles.statsRow}>
      {viewerIsCompanyOnProject && project.job_id ? (
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{isPrivateWorkspace ? 'Crew' : 'Applicants'}</Text>
          <Text style={styles.statValue}>{pipelineStatCount}</Text>
          <Text style={styles.statSub}>
            {isPrivateWorkspace ? crewMembersSubLabel(pipelineStatCount) : 'in crew pipeline'}
          </Text>
        </View>
      ) : null}
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Milestones</Text>
        <Text style={styles.statValue}>
          {project.milestones_completed}/{project.milestones_total}
        </Text>
        <Text style={styles.statSub}>completed</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Budget</Text>
        <Text style={styles.statValueBudget} numberOfLines={2}>
          {budgetLine}
        </Text>
        <Text style={styles.statSub}>total</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Status</Text>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: pillTheme.backgroundColor,
              borderColor: pillTheme.borderColor,
            },
          ]}
        >
          <Text style={[styles.statusPillText, { color: pillTheme.color }]}>
            {projectStatusDisplayLabel(project.status)}
          </Text>
        </View>
      </View>
    </View>
  )

  const needsFlexTab =
    tab === 'messages' ||
    tab === 'milestones' ||
    tab === 'production' ||
    tab === 'crew' ||
    tab === 'budget' ||
    tab === 'files'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={12}
      >
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={exitProjectWorkspace}>
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project.title}
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
          <View style={styles.tabRow}>
            {tabs.map((t) => {
              const active = tab === t.id
              const isBrief = t.id === 'brief'
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  {isBrief ? (
                    <View style={styles.tabInner}>
                      <Sparkles
                        size={12}
                        color={active ? '#FFDC00' : 'rgba(255,220,0,0.45)'}
                        strokeWidth={ICON_STROKE}
                      />
                      <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>
        </ScrollView>

        <View style={styles.bodyWrap}>
          {needsFlexTab ? (
            <View style={styles.flexFill}>
              <View style={styles.flexTabInner}>
                {tab === 'messages' && <ProjectMessagesTab projectId={project.id} userId={userId} />}
                {tab === 'milestones' && (
                  <ProjectMilestonesTab
                    projectId={project.id}
                    jobId={project.job_id}
                    onCountsChanged={refreshProjectCounts}
                    canManage={canManageCrew}
                  />
                )}
                {tab === 'production' && (
                  <ProductionTab
                    projectId={project.id}
                    userId={userId}
                    projectTitle={project.title}
                    projectLocation={project.location}
                    companyId={project.company_id}
                    briefContext={project.brief_ai_context}
                    briefOutputs={project.brief_ai_outputs}
                    canUseProductionWeather={productionWeatherEnabled}
                    canUseSunPlanner={sunPlannerEnabled}
                    productionWeatherLockedHint={productionWeatherLockedHint}
                    sunPlannerLockedHint={sunPlannerLockedHint}
                    productionWindowStart={scheduleStart}
                    productionWindowEnd={scheduleEnd}
                    initialFeature={
                      tool === 'shotlist'
                        ? 'shotlist'
                        : tool === 'callsheet'
                          ? 'call_sheet'
                          : tool === 'gear'
                            ? 'equipment'
                            : tool === 'tasks'
                              ? 'tasks'
                              : tool === 'sun'
                                ? 'sun'
                                : tool === 'weather'
                                  ? 'weather'
                                  : null
                    }
                    initialShootDay={shootDayParam || null}
                  />
                )}
                {tab === 'crew' && (
                  <ProjectCrewTab
                    projectId={project.id}
                    canManage={canManageCrew}
                    viewerIsCompany={canEditProductionSchedule}
                    viewerId={userId}
                    workspaceOnly={workspaceOnlyPlan}
                    proFeaturesEnabled={!starterFreelancerPlan}
                    productionWindowStart={scheduleStart}
                    productionWindowEnd={scheduleEnd}
                  />
                )}
                {tab === 'budget' && viewerIsCompanyOnProject ? (
                  <ProjectBudgetTab projectId={project.id} />
                ) : null}
                {tab === 'files' && (
                  <ProjectFilesTab
                    projectId={project.id}
                    jobId={linkedJobId}
                    userId={userId ?? ''}
                  />
                )}
              </View>
            </View>
          ) : (
            <ScrollView
              ref={bodyScrollRef}
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              automaticallyAdjustKeyboardInsets
            >
              {tab === 'overview' ? statsRow : null}

              {tab === 'overview' && linkedJobId ? (
                <View style={styles.jobPhaseCard}>
                  <Text style={styles.scheduleTitle}>Project status</Text>
                  <Text style={styles.scheduleSub}>
                    Matches the web job workspace (Recruiting → Active → Completed).
                  </Text>
                  <View style={styles.statusRow}>
                    {JOB_PROJECT_PHASES.map((s) => {
                      const active = (project.status || '').toLowerCase() === s
                      const locked = !canEditJobProjectStatus || savingJobPhaseStatus
                      const label =
                        s === 'recruiting' ? 'Recruiting' : s === 'active' ? 'Active' : 'Completed'
                      return (
                        <TouchableOpacity
                          key={s}
                          style={[styles.statusChip, active && styles.statusChipActive, locked && styles.statusChipLocked]}
                          onPress={() => {
                            if (!canEditJobProjectStatus || savingJobPhaseStatus) return
                            void persistJobProjectPhase(s)
                          }}
                          disabled={locked}
                        >
                          <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>{label}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  {!canEditJobProjectStatus ? (
                    <Text style={styles.scheduleLockedHint}>Only the job owner can change this.</Text>
                  ) : null}
                </View>
              ) : null}

            {tab === 'overview' && !workspaceOnlyPlan ? (
              <ProjectOverviewProductionWindow
                scheduleStart={scheduleStart}
                scheduleEnd={scheduleEnd}
                onChangeStart={setScheduleStart}
                onChangeEnd={setScheduleEnd}
                onSave={saveSchedule}
                onClear={clearSchedule}
                saving={savingSchedule}
                lockedByPlan={starterFreelancerPlan}
                readOnly={!canEditProductionSchedule}
              />
            ) : null}

            {tab === 'overview' && (
              <>
                <ProjectOverviewAbout
                  briefContext={overviewSummary}
                  canEdit={!workspaceOnlyPlan && canEditProductionSchedule}
                  onChangeBrief={setOverviewSummary}
                  onSaveBrief={saveProjectSummary}
                  saving={savingProjectSummary}
                />
                {workspaceOnlyPlan ? (
                  <>
                    <TouchableOpacity
                      style={styles.overviewEditToggleBtn}
                      onPress={() => setOverviewEditOpen((v) => !v)}
                    >
                      <Text style={styles.overviewEditToggleText}>
                        {overviewEditOpen ? 'Close edit overview' : 'Edit overview'}
                      </Text>
                    </TouchableOpacity>
                    {overviewEditOpen ? (
                      <View style={styles.overviewEditCard}>
                        <Text style={styles.overviewEditTitle}>Edit overview</Text>
                        <TextInput
                          style={styles.scheduleInput}
                          placeholder="Budget amount e.g. 2500"
                          placeholderTextColor="rgba(255,255,255,0.25)"
                          value={overviewBudgetAmount}
                          onChangeText={setOverviewBudgetAmount}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="decimal-pad"
                        />
                        <TextInput
                          style={styles.scheduleInput}
                          placeholder="Budget type e.g. fixed / negotiable / daily"
                          placeholderTextColor="rgba(255,255,255,0.25)"
                          value={overviewBudgetType}
                          onChangeText={setOverviewBudgetType}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <View style={styles.statusRow}>
                          {JOB_PROJECT_PHASES.map((s) => {
                            const active = overviewStatus.toLowerCase() === s
                            const locked = !canEditJobProjectStatus
                            const label =
                              s === 'recruiting' ? 'Recruiting' : s === 'active' ? 'Active' : 'Completed'
                            return (
                              <TouchableOpacity
                                key={s}
                                style={[
                                  styles.statusChip,
                                  active && styles.statusChipActive,
                                  locked && styles.statusChipLocked,
                                ]}
                                onPress={() => {
                                  if (locked) return
                                  setOverviewStatus(s)
                                }}
                                disabled={locked}
                              >
                                <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>{label}</Text>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                        <TextInput
                          style={[styles.briefInput, styles.overviewContentInput]}
                          multiline
                          placeholder="Project summary"
                          placeholderTextColor="rgba(255,255,255,0.25)"
                          value={overviewSummary}
                          onChangeText={setOverviewSummary}
                          onFocus={focusOverviewSummary}
                          textAlignVertical="top"
                        />
                        <TouchableOpacity
                          style={[styles.scheduleSaveBtn, savingOverview && styles.btnDim]}
                          onPress={saveOverview}
                          disabled={savingOverview}
                        >
                          <Text style={styles.scheduleSaveText}>{savingOverview ? 'Saving…' : 'Save overview'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </>
            )}

            {tab === 'review' && (
              <ProjectReviewTab
                projectId={project.id}
                jobId={project.job_id}
                frameIoUrl={project.frame_io_url}
                picdropUrl={project.picdrop_url ?? null}
                canEdit={canManageCrew}
                onSaved={(next) =>
                  setProject((prev) => (prev ? { ...prev, frame_io_url: next.frame_io_url, picdrop_url: next.picdrop_url } : prev))
                }
              />
            )}

            {tab === 'brief' && (
              <>
                <Text style={styles.sectionLabel}>Production documents</Text>
                <View style={styles.toolGrid}>
                  {TOOLS.map((x) => {
                    const Icon = x.icon
                    const active = tool === x.id
                    return (
                      <TouchableOpacity
                        key={x.id}
                        style={[styles.toolCard, active && styles.toolCardActive]}
                        onPress={() => setTool(x.id)}
                      >
                        <Icon size={26} color="#ffffff" strokeWidth={ICON_STROKE} />
                        <Text style={styles.toolTitle}>{x.title}</Text>
                        <Text style={styles.toolSub}>{x.sub}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>

                <View style={styles.contextCard}>
                  <Text style={styles.contextLabel}>
                    ADDITIONAL CONTEXT <Text style={styles.optional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={[styles.briefInput, styles.briefInputInCard]}
                    multiline
                    placeholder="Describe creative direction, references, deliverables, schedule…"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    value={briefText}
                    onChangeText={setBriefText}
                    textAlignVertical="top"
                  />
                </View>
                <View style={styles.briefActions}>
                  <TouchableOpacity
                    style={[styles.saveBtn, savingBrief && styles.btnDim]}
                    onPress={saveBrief}
                    disabled={savingBrief}
                  >
                    <Text style={styles.saveBtnText}>{savingBrief ? 'Saving…' : 'Save context'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.genBtn, generating && styles.btnDim]}
                    onPress={onGenerate}
                    disabled={generating}
                  >
                    {generating ? (
                      <ActivityIndicator color="#0a0a0a" />
                    ) : (
                      <Text style={styles.genBtnText}>Generate in app</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {!!currentOutput && (
                  <View style={styles.outputBox}>
                    <View style={styles.outputBoxHead}>
                      <View style={styles.outputIconWrap}>
                        <Sparkles size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      </View>
                      <View style={styles.outputBoxHeadText}>
                        <Text style={styles.outputLabel}>Generated</Text>
                        <Text style={styles.outputToolName}>{TOOLS.find((t) => t.id === tool)?.title}</Text>
                      </View>
                    </View>
                    <BriefAiFormattedOutput
                      content={currentOutput}
                      renderMode={tool === 'shotlist' ? 'shot-cards' : 'default'}
                    />
                  </View>
                )}

                {canSyncProductionTool ? (
                  <View style={styles.prodSyncCard}>
                    <View style={styles.prodSyncHead}>
                      <View style={styles.prodSyncIconWrap}>
                        <Sparkles size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      </View>
                      <View style={styles.prodSyncHeadText}>
                        <Text style={styles.prodSyncKicker}>Production sync</Text>
                        <Text style={styles.prodSyncLead}>
                          Push this tool into the same Production tables as the app.
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.prodSyncSub}>
                      Use the same date as Production → Shotlist / Call sheet (Load day). After Generate, tap Apply —
                      nothing copies by itself.
                    </Text>
                    <TextInput
                      style={styles.scheduleInput}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      value={productionApplyDate}
                      onChangeText={setProductionApplyDate}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!applyingProd}
                    />
                    <TouchableOpacity
                      style={[
                        styles.prodSyncBtn,
                        (!currentOutput.trim() || applyingProd) && styles.btnDim,
                      ]}
                      onPress={tool === 'shotlist' ? onApplyShotlistChoices : onApplyCallsheet}
                      disabled={!currentOutput.trim() || applyingProd}
                    >
                      {applyingProd ? (
                        <ActivityIndicator color="#FFDC00" />
                      ) : (
                        <Text style={styles.prodSyncBtnText}>
                          {tool === 'shotlist' ? 'Apply shot list to Production…' : 'Apply call sheet to Production…'}
                        </Text>
                      )}
                    </TouchableOpacity>
                    {!currentOutput.trim() ? (
                      <Text style={styles.prodSyncHint}>Generate first — then Apply appears here.</Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  keyboardWrap: { flex: 1 },
  bodyWrap: { flex: 1, paddingHorizontal: 16 },
  flexFill: { flex: 1 },
  flexTabInner: { flex: 1, minHeight: 0 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 12 },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  tabScroll: { flexGrow: 0, marginBottom: 12 },
  tabRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  tab: {
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  tabActive: {
    backgroundColor: 'transparent',
  },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  tabTextActive: { color: '#FFDC00', fontWeight: '700' },
  body: { flex: 1 },
  bodyContent: { paddingBottom: 40 },
  jobPhaseCard: {
    marginBottom: 20,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
  },
  scheduleTitle: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.6, marginBottom: 6 },
  scheduleSub: { fontSize: 11, color: 'rgba(255,255,255,0.38)', lineHeight: 16, marginBottom: 12 },
  scheduleLockedHint: { fontSize: 11, color: '#FFDC00', marginBottom: 10, fontWeight: '700' },
  scheduleInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    marginBottom: 10,
    backgroundColor: '#0a0a0a',
  },
  scheduleInputLocked: { opacity: 0.55 },
  scheduleSaveBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
  },
  scheduleSaveText: { fontSize: 13, fontWeight: '700', color: '#0a0a0a' },
  overviewEditCard: {
    marginBottom: 20,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
  },
  overviewEditToggleBtn: {
    alignSelf: 'flex-start',
    marginTop: -6,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#111',
  },
  overviewEditToggleText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  overviewEditTitle: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.6, marginBottom: 10 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#0f0f0f',
  },
  statusChipActive: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  statusChipText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  statusChipTextActive: { color: '#0a0a0a' },
  statusChipLocked: { opacity: 0.55 },
  overviewContentInput: { minHeight: 120 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  statValue: { fontSize: 22, fontWeight: '900', color: '#FFDC00' },
  statValueBudget: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFDC00',
    lineHeight: 20,
  },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
    marginTop: 2,
    marginBottom: 2,
  },
  statusPillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  statSub: { fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 },
  sectionLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  toolCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  toolCardActive: {
    borderColor: 'rgba(255,220,0,0.55)',
    backgroundColor: 'rgba(255,220,0,0.07)',
  },
  toolTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  toolSub: { fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 16 },
  outputBox: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderLeftWidth: 3,
    borderLeftColor: '#FFDC00',
    marginBottom: 20,
  },
  outputBoxHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  outputIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outputBoxHeadText: { flex: 1, minWidth: 0 },
  outputLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.38)',
    letterSpacing: 1.3,
    marginBottom: 2,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  outputToolName: { fontSize: 17, fontWeight: '800', color: '#fff' },
  contextLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  optional: { fontStyle: 'italic', letterSpacing: 0 },
  contextCard: {
    marginBottom: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  briefInput: {
    minHeight: 160,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  briefInputInCard: {
    marginBottom: 0,
    backgroundColor: '#0a0a0a',
  },
  briefActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  saveBtnText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
  genBtn: {
    flex: 1,
    minWidth: 160,
    backgroundColor: '#FFDC00',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  genBtnText: { color: '#0a0a0a', fontWeight: '800' },
  prodSyncCard: {
    marginTop: 20,
    marginBottom: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,220,0,0.9)',
    backgroundColor: '#141414',
  },
  prodSyncHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  prodSyncIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prodSyncHeadText: { flex: 1, minWidth: 0 },
  prodSyncKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,220,0,0.9)',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  prodSyncLead: { fontSize: 15, fontWeight: '800', color: '#fff', lineHeight: 20 },
  prodSyncSub: { fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 17, marginBottom: 12 },
  prodSyncBtn: {
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.4)',
    alignItems: 'center',
  },
  prodSyncBtnText: { color: '#FFDC00', fontWeight: '800', fontSize: 14 },
  prodSyncHint: {
    marginTop: 10,
    fontSize: 12,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 17,
  },
  btnDim: { opacity: 0.6 },
  miss: { color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
})

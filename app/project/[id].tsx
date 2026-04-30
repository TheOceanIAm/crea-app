import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
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
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { ProjectMilestonesTab } from '@/components/project/ProjectMilestonesTab'
import { ProjectMessagesTab } from '@/components/project/ProjectMessagesTab'
import { ProjectCrewTab } from '@/components/project/ProjectCrewTab'
import { ProjectFilesTab } from '@/components/project/ProjectFilesTab'
import { ProjectReviewTab } from '@/components/project/ProjectReviewTab'
import { ProductionTab } from '@/app/components/project/[projectId]/ProductionTab'
import { ProjectOverviewAbout } from '@/components/project/ProjectOverviewAbout'
import { BriefAiFormattedOutput } from '@/components/project/BriefAiFormattedOutput'
import { formatProjectBudgetLine } from '@/lib/budgetFormatting'
import {
  PROJECT_STATUS_PILL,
  projectStatusDisplayLabel,
  projectStatusVariant,
} from '@/lib/projectStatusDisplay'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'

type TabId =
  | 'overview'
  | 'milestones'
  | 'production'
  | 'crew'
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
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [workspaceOnlyPlan, setWorkspaceOnlyPlan] = useState(false)
  const [applicants, setApplicants] = useState(0)
  const [tab, setTab] = useState<TabId>('overview')
  const [tool, setTool] = useState<string>('tasks')
  const [briefText, setBriefText] = useState('')
  const [overviewSummary, setOverviewSummary] = useState('')
  const [overviewBudgetAmount, setOverviewBudgetAmount] = useState('')
  const [overviewBudgetType, setOverviewBudgetType] = useState('')
  const [overviewStatus, setOverviewStatus] = useState('active')
  const [overviewEditOpen, setOverviewEditOpen] = useState(false)
  const [savingBrief, setSavingBrief] = useState(false)
  const [savingOverview, setSavingOverview] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [scheduleStart, setScheduleStart] = useState('')
  const [scheduleEnd, setScheduleEnd] = useState('')
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [productionApplyDate, setProductionApplyDate] = useState('')
  const [applyingProd, setApplyingProd] = useState(false)
  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') {
      setLoading(false)
      return
    }
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setForbidden(true)
      setWorkspaceOnlyPlan(false)
      setLoading(false)
      return
    }
    setUserId(user.id)
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    const role = resolveAppRole(profile?.role, user)
    setWorkspaceOnlyPlan(
      isFreelancerProfile(role) && isFreelancerWorkspaceOnlyPlan(resolveFreelancerPlanFromUser(user))
    )

    const { data: row, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
    if (error || !row) {
      setForbidden(true)
      setProject(null)
      setLoading(false)
      return
    }

    const p = row as ProjectRow
    setProject(p)
    setBriefText(p.brief_ai_context ?? '')
    setOverviewSummary(
      p.brief_ai_outputs && typeof p.brief_ai_outputs.workspace_summary === 'string'
        ? p.brief_ai_outputs.workspace_summary
        : p.brief_ai_context ?? ''
    )
    setOverviewBudgetAmount(typeof p.budget_amount === 'number' ? String(p.budget_amount) : '')
    setOverviewBudgetType(p.budget_type ?? '')
    setOverviewStatus(p.status || 'active')
    setScheduleStart(typeof p.scheduling_start_date === 'string' ? p.scheduling_start_date.slice(0, 10) : '')
    setScheduleEnd(typeof p.scheduling_end_date === 'string' ? p.scheduling_end_date.slice(0, 10) : '')
    setForbidden(false)

    if (p.job_id) {
      const { count } = await supabase
        .from('job_applications')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', p.job_id)
      setApplicants(count ?? 0)
    } else {
      setApplicants(0)
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!project) return
    // Match Production tab default (shoot list loads "today" until user changes the day there).
    setProductionApplyDate(todayLocalISODate())
  }, [project?.id])

  const tabs = useMemo(
    () => (workspaceOnlyPlan ? BASE_TABS.filter((t) => t.id !== 'messages') : BASE_TABS),
    [workspaceOnlyPlan]
  )

  useEffect(() => {
    if (workspaceOnlyPlan && tab === 'messages') setTab('overview')
  }, [workspaceOnlyPlan, tab])

  const canManageCrew = useMemo(() => {
    if (!project || !userId) return false
    return project.company_id === userId || project.freelancer_id === userId
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

  const saveOverview = async () => {
    if (!project) return
    const rawBudget = overviewBudgetAmount.trim()
    const parsedBudget = rawBudget ? Number(rawBudget.replace(',', '.')) : null
    if (rawBudget && (!Number.isFinite(parsedBudget) || parsedBudget < 0)) {
      Alert.alert('Budget', 'Please enter a valid non-negative number.')
      return
    }
    const nextStatus = overviewStatus.trim() || 'active'
    const nextSummary = overviewSummary.trim()
    const prevOutputs = (project.brief_ai_outputs ?? {}) as Record<string, string>
    setSavingOverview(true)
    const { error } = await supabase
      .from('projects')
      .update({
        budget_amount: parsedBudget,
        budget_type: overviewBudgetType.trim() || null,
        status: nextStatus,
        brief_ai_outputs: { ...prevOutputs, workspace_summary: nextSummary },
      })
      .eq('id', project.id)
    setSavingOverview(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
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
      Alert.alert(
        'Generation failed',
        `${error.message}\n\nDeploy the brief-ai Edge Function and set ANTHROPIC_API_KEY if you have not yet.`
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (forbidden || !project || !userId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Close</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.miss}>You don’t have access to this project.</Text>
        </View>
      </SafeAreaView>
    )
  }

  const statusKey = projectStatusVariant(project.status)
  const pillTheme = PROJECT_STATUS_PILL[statusKey]

  const statsRow = (
    <View style={styles.statsRow}>
      {!workspaceOnlyPlan ? (
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Applicants</Text>
          <Text style={styles.statValue}>{applicants}</Text>
          <Text style={styles.statSub}>in crew pipeline</Text>
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
    tab === 'files'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
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
                    <Sparkles size={12} color={active ? '#0a0a0a' : '#FFDC00'} strokeWidth={ICON_STROKE} />
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
                  onCountsChanged={load}
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
                />
              )}
              {tab === 'crew' && <ProjectCrewTab projectId={project.id} canManage={canManageCrew} />}
              {tab === 'files' && <ProjectFilesTab projectId={project.id} />}
            </View>
          </View>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            {tab === 'overview' ? statsRow : null}

            {tab === 'overview' && (
              <>
                <ProjectOverviewAbout
                  briefContext={overviewSummary}
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
                          {['active', 'paused', 'completed', 'cancelled'].map((s) => {
                            const active = overviewStatus === s
                            return (
                              <TouchableOpacity
                                key={s}
                                style={[styles.statusChip, active && styles.statusChipActive]}
                                onPress={() => setOverviewStatus(s)}
                              >
                                <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>{s}</Text>
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
                {canManageCrew && !workspaceOnlyPlan ? (
                  <View style={styles.scheduleCard}>
                    <Text style={styles.scheduleTitle}>Public freelancer calendar</Text>
                    <Text style={styles.scheduleSub}>
                      Inclusive shoot dates (YYYY-MM-DD). They appear as busy on the freelancer&apos;s public profile
                      while this project is active.
                    </Text>
                    <TextInput
                      style={styles.scheduleInput}
                      placeholder="Start date e.g. 2026-05-12"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      value={scheduleStart}
                      onChangeText={setScheduleStart}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TextInput
                      style={styles.scheduleInput}
                      placeholder="End date e.g. 2026-05-14"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      value={scheduleEnd}
                      onChangeText={setScheduleEnd}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={[styles.scheduleSaveBtn, savingSchedule && styles.btnDim]}
                      onPress={saveSchedule}
                      disabled={savingSchedule}
                    >
                      <Text style={styles.scheduleSaveText}>{savingSchedule ? 'Saving…' : 'Save schedule'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                <Text style={styles.para}>
                  Milestones, crew, chat, files, Review (Frame.io + PicDrop), production tools, and Brief AI stay in sync
                  via Supabase for everyone on this project.
                </Text>
              </>
            )}

            {tab === 'review' && (
              <ProjectReviewTab
                projectId={project.id}
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
                    <BriefAiFormattedOutput content={currentOutput} />
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  bodyWrap: { flex: 1, paddingHorizontal: 16 },
  flexFill: { flex: 1 },
  flexTabInner: { flex: 1, minHeight: 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 12 },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  tabScroll: { maxHeight: 48, marginBottom: 8 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
  },
  tabActive: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  tabTextActive: { color: '#0a0a0a' },
  body: { flex: 1 },
  bodyContent: { paddingBottom: 40 },
  scheduleCard: {
    marginBottom: 20,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
  },
  scheduleTitle: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.6, marginBottom: 6 },
  scheduleSub: { fontSize: 11, color: 'rgba(255,255,255,0.38)', lineHeight: 16, marginBottom: 12 },
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
  briefActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
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
  para: { fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 20, marginBottom: 12 },
  miss: { color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
})

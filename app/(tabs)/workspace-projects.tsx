import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  SectionList,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { KeyboardFormModal } from '@/components/KeyboardFormModal'
import { useFloatingTabBarBottomInset } from '@/lib/floatingTabBarLayout'
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { getAuthUser } from '@/lib/getAuthUser'
import { createPrivateWorkspaceProject } from '@/lib/createPrivateWorkspaceProject'
import {
  JOB_LISTING_BUDGET_TYPES,
  parseJobListingBudgetInput,
  type JobListingBudgetType,
} from '@/lib/jobListingBudget'
import { deleteCompanyJob } from '@/lib/deleteCompanyJob'
import { deletePrivateWorkspaceProject } from '@/lib/deletePrivateWorkspaceProject'
import { supabase } from '@/lib/supabase'
import {
  canFreelancerCreatePrivateProjects,
  resolveFreelancerPlanFromUserAndProfileTier,
} from '@/lib/freelancerPlan'
import {
  cacheWorkspaceProjects,
  loadWorkspaceProjectsCache,
  persistWorkspaceProjectsToDisk,
  readCachedWorkspaceProjects,
} from '@/lib/workspaceProjectsLoad'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { runTimed } from '@/lib/perfMarks'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'
import { ResponsiveScreen } from '@/components/ResponsiveScreen'

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

function fmtDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

type ListingSection = {
  title: string
  subtitle: string
  data: ProjectListing[]
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
  const { create: createParam } = useLocalSearchParams<{ create?: string }>()
  const tabBarInset = useFloatingTabBarBottomInset()
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
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [budgetType, setBudgetType] = useState<JobListingBudgetType>('negotiable')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('EUR')
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
        return { active: 0, archived: 0 }
      }

      // Instant paint from the warm mem cache while we revalidate in the background.
      let hydratedCache = false
      if (!opts?.force) {
        const wc = readCachedWorkspaceProjects(user.id)
        if (wc && Array.isArray(wc.listings) && Array.isArray(wc.archivedListings)) {
          setAllowed(true)
          setDenyKind(null)
          setViewerRole(wc.viewerRole)
          setCanCreatePrivate(wc.canCreatePrivate)
          setListings(wc.listings)
          setArchivedListings(wc.archivedListings)
          setLoading(false)
          hydratedCache = true
        }
      }
      if (!hydratedCache && !hasLoadedRef.current) setLoading(true)

      const res = await loadWorkspaceProjectsCache(user)
      if (!res) {
        setAllowed(false)
        setDenyKind('role')
        setListings([])
        setArchivedListings([])
        setLoading(false)
        return { active: 0, archived: 0 }
      }

      setAllowed(true)
      setDenyKind(null)
      setViewerRole(res.viewerRole)
      setCanCreatePrivate(res.canCreatePrivate)
      setListings(res.listings)
      setArchivedListings(res.archivedListings)
      cacheWorkspaceProjects(user.id, res)
      void persistWorkspaceProjectsToDisk(user.id, res)
      setLoading(false)
      hasLoadedRef.current = true
      lastLoadedAtRef.current = Date.now()
      return { active: res.listings.length, archived: res.archivedListings.length }
    })
    if (__DEV__) {
      console.log(
        `[perf] workspace-projects.rows: active=${timed.value?.active ?? 0} archived=${timed.value?.archived ?? 0}`
      )
    }
  }, [router])

  useFocusEffect(
    useCallback(() => {
      // Always revalidate on focus so web deletes/archives show up without waiting on cache cooldown.
      void load({ force: true })
    }, [load])
  )

  useFocusEffect(
    useCallback(() => {
      if (createParam !== '1') return
      setCreateOpen(true)
      router.setParams({ create: undefined })
    }, [createParam, router])
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

  const resetCreateForm = () => {
    setTitle('')
    setNotes('')
    setBudgetType('negotiable')
    setBudgetAmount('')
    setBudgetCurrency('EUR')
  }

  const onCreate = async () => {
    const t = title.trim()
    if (!t || creating) return
    const budgetParsed = parseJobListingBudgetInput({
      budgetType,
      budgetAmount,
      budgetCurrency,
    })
    if (!budgetParsed.ok) {
      Alert.alert('Budget', budgetParsed.error)
      return
    }
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
    const result = await createPrivateWorkspaceProject(supabase, u.id, {
      title: t,
      notes: notes.trim() || undefined,
      budget_type: budgetParsed.budget_type,
      budget_amount: budgetParsed.budget_amount,
      budget_currency: budgetParsed.budget_currency,
    })
    setCreating(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCreateOpen(false)
    resetCreateForm()
    router.push(`/project/${result.projectId}` as Href)
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
    const isCompany = viewerRole === 'company'
    Alert.alert(
      isCompany ? 'Delete job' : 'Delete project',
      isCompany
        ? 'This permanently deletes the job and everything linked to it (applications, workspace, crew, milestones, files, messages). Continue?'
        : 'This removes the project permanently. Continue?',
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
              const result = isCompany
                ? await deleteCompanyJob(supabase, user.id, item.id)
                : await deletePrivateWorkspaceProject(supabase, user.id, item.id)
              setActingId(null)
              if (!result.ok) {
                setError(result.error)
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
    <View style={styles.card}>
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
        <ResponsiveScreen>
        <View style={styles.loadingShell}>
          <ScreenListSkeleton rows={6} />
        </View>
        </ResponsiveScreen>
      </SafeAreaView>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <ResponsiveScreen>
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
        </ResponsiveScreen>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ResponsiveScreen>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Dashboard</Text>
        </TouchableOpacity>
        <View style={styles.topActions}>
          {viewerRole === 'company' ? (
            <TouchableOpacity
              style={styles.postListingBtn}
              onPress={() => router.push('/(tabs)/company-post-job' as Href)}
            >
              <Plus size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
              <Text style={styles.postListingBtnText}>Post listing</Text>
            </TouchableOpacity>
          ) : null}
          {canCreatePrivate ? (
            <TouchableOpacity style={styles.newBtn} onPress={() => setCreateOpen(true)}>
              <Plus size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
              <Text style={styles.newBtnText}>New project</Text>
            </TouchableOpacity>
          ) : viewerRole !== 'company' ? (
            <View style={styles.newBtnPlaceholder} />
          ) : null}
        </View>
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
        contentContainerStyle={[styles.list, { paddingBottom: tabBarInset + 24 }]}
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

      <KeyboardFormModal visible={createOpen} onClose={() => { setCreateOpen(false); resetCreateForm() }}>
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
              returnKeyType="next"
            />

            <Text style={styles.fieldLabel}>Budget</Text>
            <View style={styles.chipRow}>
              {JOB_LISTING_BUDGET_TYPES.map((b) => {
                const sel = budgetType === b.id
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.chip, sel && styles.chipSelected]}
                    onPress={() => setBudgetType(b.id)}
                  >
                    <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{b.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            {budgetType !== 'negotiable' ? (
              <>
                <Text style={styles.fieldLabel}>Currency (ISO)</Text>
                <TextInput
                  style={styles.input}
                  value={budgetCurrency}
                  onChangeText={(x) => setBudgetCurrency(x.toUpperCase().replace(/[^A-Za-z]/g, '').slice(0, 3))}
                  placeholder="EUR"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="characters"
                  maxLength={3}
                />
                <Text style={styles.fieldLabel}>{budgetType === 'day_rate' ? 'Day rate' : 'Fixed budget'}</Text>
                <TextInput
                  style={styles.input}
                  value={budgetAmount}
                  onChangeText={setBudgetAmount}
                  placeholder="e.g. 1200"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="decimal-pad"
                />
              </>
            ) : null}

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
                onPress={() => { setCreateOpen(false); resetCreateForm() }}
                disabled={creating}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAccent, (!title.trim() || creating) && styles.dim]}
                onPress={onCreate}
                disabled={!title.trim() || creating}
              >
                <Text style={styles.modalBtnAccentText}>{creating ? 'Creating…' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
      </KeyboardFormModal>

      <KeyboardFormModal visible={editOpen} onClose={() => setEditOpen(false)}>
            <Text style={styles.modalTitle}>Edit project</Text>
            <Text style={styles.modalSub}>Update project title and notes for this private workspace project.</Text>

            <Text style={styles.fieldLabel}>Project name</Text>
            <TextInput
              style={styles.input}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Project name"
              placeholderTextColor="rgba(255,255,255,0.3"
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
      </KeyboardFormModal>
      </ResponsiveScreen>
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
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postListingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#FFDC00',
  },
  postListingBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 12 },
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  cardMain: { padding: 14 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  logo: { width: 48, height: 48, backgroundColor: '#1a1a1a' },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#1c1c1c',
  },
  chipSelected: {
    borderColor: 'rgba(255,220,0,0.45)',
    backgroundColor: 'rgba(255,220,0,0.1)',
  },
  chipText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700' },
  chipTextSelected: { color: '#FFDC00' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtn: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  modalBtnGhostText: { color: 'rgba(255,255,255,0.8)', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  modalBtnAccent: { backgroundColor: '#FFDC00' },
  modalBtnAccentText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  dim: { opacity: 0.6 },
})

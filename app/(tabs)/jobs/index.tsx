import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  TextInput,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { PlusCircle, Lock } from 'lucide-react-native'
import * as Linking from 'expo-linking'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'
import {
  freelancerCanApplyToJobs,
  resolveFreelancerPlanFromUserAndProfileTier,
} from '@/lib/freelancerPlan'
import { ensureMarketplaceJobWorkspaceRow } from '@/lib/ensureMarketplaceJobWorkspace'
import { publishCeoExternalJob } from '@/lib/ceoExternalJobsApi'
import { instagramUrl, linkedinUrl } from '@/lib/profilePublicLinks'
import {
  cacheJobsFeed,
  loadJobsFeed,
  readCachedJobsFeed,
  type ExternalJobRow,
  type JobFeedRow,
} from '@/lib/jobsFeedLoad'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'

type Job = JobFeedRow
type ExternalJob = ExternalJobRow

function companyInitial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

function jobStatusLabel(s: string) {
  const t = (s || '').toLowerCase()
  if (t === 'active') return 'Active'
  if (t === 'closed' || t === 'filled') return 'Closed'
  if (t === 'draft') return 'Draft'
  return s ? s : '—'
}

function openExternalUrl(url: string, label: string) {
  void Linking.openURL(url).catch(() => {
    Alert.alert(`${label} did not open`, 'Copy the link from the listing and open it in your browser.')
  })
}

function normalizeRateLabel(rate: string | null): string | null {
  if (!rate) return null
  return rate
    .replace(/\/\s*tag\b/gi, '/day')
    .replace(/\bpro\s+tag\b/gi, 'per day')
    .replace(/\btagessatz\b/gi, 'day rate')
}

function externalJobRateLabel(rate: string | null | undefined): string {
  return normalizeRateLabel(rate ?? null) || 'Rate TBD'
}

function isCreaJobItem(item: Job | ExternalJob): item is Job {
  return 'company_name' in item
}

function readInitialJobsFeed(): { jobs: Job[]; externalJobs: ExternalJob[]; loading: boolean } {
  const uid = peekWarmedOverview()?.userId
  if (!uid) return { jobs: [], externalJobs: [], loading: true }
  const cached = readCachedJobsFeed(uid, 'crea', false)
  if (!cached) return { jobs: [], externalJobs: [], loading: true }
  return { jobs: cached.jobs, externalJobs: cached.externalJobs, loading: false }
}

export default function JobsListScreen() {
  const router = useRouter()
  const bootJobs = useRef(readInitialJobsFeed()).current
  const hasLoadedRef = useRef(!bootJobs.loading)
  const lastLoadedAtRef = useRef(0)
  const RELOAD_COOLDOWN_MS = 15000
  const [jobs, setJobs] = useState<Job[]>(bootJobs.jobs)
  const [loading, setLoading] = useState(bootJobs.loading)
  const [isCompanyUser, setIsCompanyUser] = useState(false)
  const [isCeoUser, setIsCeoUser] = useState(false)
  const [isFreeFreelancer, setIsFreeFreelancer] = useState(false)
  const [feedTab, setFeedTab] = useState<'crea' | 'external'>('crea')
  const [search, setSearch] = useState('')
  const [externalJobs, setExternalJobs] = useState<ExternalJob[]>(bootJobs.externalJobs)
  const [activeExternalJob, setActiveExternalJob] = useState<ExternalJob | null>(null)

  /** CEO-only: manual external listing (parity with CREA web). */
  const [addExternalOpen, setAddExternalOpen] = useState(false)
  const [ceoExtSaving, setCeoExtSaving] = useState(false)
  const [ceoTitle, setCeoTitle] = useState('')
  const [ceoLocation, setCeoLocation] = useState('')
  const [ceoRate, setCeoRate] = useState('')
  const [ceoRoleLine, setCeoRoleLine] = useState('')
  const [ceoCompany, setCeoCompany] = useState('')
  const [ceoNeededWhen, setCeoNeededWhen] = useState('')
  const [ceoIntel, setCeoIntel] = useState('')
  const [ceoContactName, setCeoContactName] = useState('')
  const [ceoContactEmail, setCeoContactEmail] = useState('')
  const [ceoLinkedIn, setCeoLinkedIn] = useState('')
  const [ceoInstagram, setCeoInstagram] = useState('')

  const [refreshing, setRefreshing] = useState(false)

  const loadJobs = useCallback(
    async (opts?: { bypassCooldown?: boolean }) => {
      const now = Date.now()
      if (
        !opts?.bypassCooldown &&
        hasLoadedRef.current &&
        now - lastLoadedAtRef.current < RELOAD_COOLDOWN_MS
      )
        return

      const user = await getAuthUser()
      let role: string | null = null
      if (user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('role, subscription_tier')
          .eq('id', user.id)
          .maybeSingle()
        role = resolveAppRole(prof?.role, user)
        const plan = resolveFreelancerPlanFromUserAndProfileTier(user, prof?.subscription_tier)
        setIsFreeFreelancer(isFreelancerProfile(role) && !freelancerCanApplyToJobs(plan))
      } else {
        setIsFreeFreelancer(false)
        setIsCeoUser(false)
      }
      const companyOnly = Boolean(user && isCompanyProfile(role))
      setIsCompanyUser(companyOnly)
      setIsCeoUser(Boolean(user && isCeoProfile(role)))

      if (user && !opts?.bypassCooldown) {
        const hit = readCachedJobsFeed(user.id, feedTab, companyOnly)
        if (hit && !hasLoadedRef.current) {
          setJobs(hit.jobs)
          setExternalJobs(hit.externalJobs)
          setLoading(false)
        }
      }
      if (!hasLoadedRef.current && !(user && readCachedJobsFeed(user.id, feedTab, companyOnly))) {
        setLoading(true)
      }

      if (!user) {
        setLoading(false)
        return
      }

      const loaded = await loadJobsFeed(user, { feedTab })
      if (!loaded) {
        setLoading(false)
        return
      }
      setJobs(loaded.data.jobs)
      setExternalJobs(loaded.data.externalJobs)
      cacheJobsFeed(user.id, loaded.feedTab, loaded.companyOnly, loaded.data)
      setLoading(false)
      hasLoadedRef.current = true
      lastLoadedAtRef.current = Date.now()
    },
    [feedTab]
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadJobs({ bypassCooldown: true })
    } finally {
      setRefreshing(false)
    }
  }, [loadJobs])

  useEffect(() => {
    hasLoadedRef.current = false
    lastLoadedAtRef.current = 0
  }, [feedTab])

  useFocusEffect(
    useCallback(() => {
      void loadJobs()
    }, [loadJobs])
  )

  const filteredCreaJobs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return jobs
    return jobs.filter((j) =>
      j.title.toLowerCase().includes(needle) ||
      j.category.toLowerCase().includes(needle) ||
      j.location_type.toLowerCase().includes(needle) ||
      j.company_name.toLowerCase().includes(needle)
    )
  }, [jobs, search])

  const filteredExternalJobs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return externalJobs
    return externalJobs.filter((j) =>
      j.title.toLowerCase().includes(needle) ||
      j.company.toLowerCase().includes(needle) ||
      String(j.location ?? '').toLowerCase().includes(needle) ||
      String(j.role ?? '').toLowerCase().includes(needle)
    )
  }, [externalJobs, search])

  const currentItemsCount = !isCompanyUser && feedTab === 'external' ? filteredExternalJobs.length : filteredCreaJobs.length
  const countLabel = isCompanyUser ? `${currentItemsCount} listing${currentItemsCount === 1 ? '' : 's'}` : `${currentItemsCount} open`

  const showExternalFeed = !isCompanyUser && feedTab === 'external'
  const feedListData: (Job | ExternalJob)[] = showExternalFeed ? filteredExternalJobs : filteredCreaJobs

  const showInitialSkeleton =
    loading && (showExternalFeed ? externalJobs.length === 0 : jobs.length === 0)

  async function submitCeoExternalListing() {
    const t = ceoTitle.trim()
    const email = ceoContactEmail.trim()
    if (!t) {
      Alert.alert('Title required', 'Please enter a project title.')
      return
    }
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      Alert.alert('Email required', 'Please enter a valid contact email.')
      return
    }
    setCeoExtSaving(true)
    const result = await publishCeoExternalJob({
      title: t,
      company: ceoCompany.trim() || undefined,
      location: ceoLocation.trim() || undefined,
      role: ceoRoleLine.trim() || undefined,
      rate: ceoRate.trim() || undefined,
      needed_when: ceoNeededWhen.trim() || undefined,
      intel_brief: ceoIntel.trim() || undefined,
      contact_name: ceoContactName.trim() || undefined,
      contact_email: email,
      contact_linkedin: ceoLinkedIn.trim() || undefined,
      contact_instagram: ceoInstagram.trim() || undefined,
    })
    setCeoExtSaving(false)
    if (result.ok === false) {
      Alert.alert('Could not publish', result.message)
      return
    }
    setCeoTitle('')
    setCeoLocation('')
    setCeoRate('')
    setCeoRoleLine('')
    setCeoCompany('')
    setCeoNeededWhen('')
    setCeoIntel('')
    setCeoContactName('')
    setCeoContactEmail('')
    setCeoLinkedIn('')
    setCeoInstagram('')
    setAddExternalOpen(false)
    hasLoadedRef.current = false
    lastLoadedAtRef.current = 0
    setFeedTab('external')
    void loadJobs()
    Alert.alert('Published', 'The listing appears in External.')
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{isCompanyUser ? 'Projects' : 'Jobs'}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{countLabel}</Text>
        </View>
      </View>

      {isCompanyUser ? (
        <TouchableOpacity
          style={styles.postJobBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/(tabs)/company-post-job')}
        >
          <PlusCircle size={22} color="#0a0a0a" strokeWidth={ICON_STROKE} />
          <Text style={styles.postJobBtnText}>Post project</Text>
        </TouchableOpacity>
      ) : null}

      {isCeoUser ? (
        <TouchableOpacity
          style={styles.ceoAddExternalBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add listing to external job pool"
          onPress={() => setAddExternalOpen(true)}
        >
          <PlusCircle size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.ceoAddExternalBtnText}>Add external job</Text>
        </TouchableOpacity>
      ) : null}

      {!isCompanyUser ? (
        <View style={styles.feedTabs}>
          <TouchableOpacity
            style={[styles.feedTabBtn, feedTab === 'crea' && styles.feedTabBtnActive]}
            onPress={() => setFeedTab('crea')}
            activeOpacity={0.85}
          >
            <Text style={[styles.feedTabText, feedTab === 'crea' && styles.feedTabTextActive]}>Job pool</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.feedTabBtn, feedTab === 'external' && styles.feedTabBtnActive]}
            onPress={() => setFeedTab('external')}
            activeOpacity={0.85}
          >
            <Text style={[styles.feedTabText, feedTab === 'external' && styles.feedTabTextActive]}>External</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={
            !isCompanyUser && feedTab === 'external'
              ? 'Search external jobs...'
              : 'Search jobs...'
          }
          placeholderTextColor="rgba(255,255,255,0.32)"
          style={styles.searchInput}
        />
      </View>

      <FlatList<Job | ExternalJob>
        data={feedListData}
        keyExtractor={(j) => j.id}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={8}
        removeClippedSubviews
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#FFDC00" />
        }
        contentContainerStyle={[styles.list, feedListData.length === 0 && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => {
              if (showExternalFeed && !isCreaJobItem(item)) {
                setActiveExternalJob(item)
                return
              }
              if (isCompanyUser && isCreaJobItem(item)) {
                void (async () => {
                  const { data: { user } } = await supabase.auth.getUser()
                  if (user) {
                    const ensured = await ensureMarketplaceJobWorkspaceRow(supabase, {
                      jobId: item.id,
                      userId: user.id,
                    })
                    const pid = ensured.projectId ?? item.id
                    router.push(`/project/${pid}`)
                  } else {
                    router.push(`/(tabs)/jobs/${item.id}`)
                  }
                })()
                return
              }
              router.push(`/(tabs)/jobs/${item.id}`)
            }}
          >
            {showExternalFeed && !isCreaJobItem(item) ? (
              <>
                <View style={styles.companyRow}>
                  <View style={styles.companyLogoPlaceholder}>
                    <Text style={styles.companyLogoLetter}>{companyInitial(item.company)}</Text>
                  </View>
                  <Text style={styles.companyName} numberOfLines={1}>
                    {item.company}
                  </Text>
                </View>
                <View style={styles.cardTop}>
                  <Text style={styles.jobTitle}>{item.title}</Text>
                  <View style={styles.budgetBadge}>
                    <Text style={styles.budgetText}>{normalizeRateLabel(item.rate) || 'Rate TBD'}</Text>
                  </View>
                </View>
                <Text style={styles.jobMeta}>
                  {item.role || 'Role n/a'} · {item.location || 'Location n/a'}
                </Text>
                {item.needed_when ? (
                  <Text style={styles.jobMeta}>Needed: {item.needed_when}</Text>
                ) : null}
                <View style={styles.externalActions}>
                  <TouchableOpacity
                    style={styles.externalActionBtn}
                    activeOpacity={0.85}
                    onPress={() => setActiveExternalJob(item)}
                  >
                    <Text style={styles.externalActionBtnText}>View contact</Text>
                  </TouchableOpacity>
                  {item.source_url ? (
                    <TouchableOpacity
                      style={styles.externalGhostBtn}
                      activeOpacity={0.85}
                      onPress={() => {
                        const url = item.source_url
                        if (url) void Linking.openURL(url)
                      }}
                    >
                      <Text style={styles.externalGhostBtnText}>View source</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            ) : isCreaJobItem(item) ? (
              <>
                <View style={styles.companyRow}>
                  {item.company_logo_url ? (
                    <Image source={{ uri: item.company_logo_url }} style={styles.companyLogo} />
                  ) : (
                    <View style={styles.companyLogoPlaceholder}>
                      <Text style={styles.companyLogoLetter}>{companyInitial(item.company_name)}</Text>
                    </View>
                  )}
                  <Text style={styles.companyName} numberOfLines={1}>
                    {item.company_name}
                  </Text>
                  {isCompanyUser ? (
                    <View style={styles.statusPill}>
                      <Text style={styles.statusPillText}>{jobStatusLabel(item.status)}</Text>
                    </View>
                  ) : isFreeFreelancer ? (
                    <View style={styles.lockPill}>
                      <Lock size={11} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      <Text style={styles.lockPillText}>Pro</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.cardTop}>
                  <Text style={styles.jobTitle}>{item.title}</Text>
                  <View style={styles.budgetBadge}>
                    <Text style={styles.budgetText}>
                      {formatBudgetDisplay({
                        budget_type: item.budget_type,
                        budget_amount: item.budget_amount,
                        budget_currency: item.budget_currency,
                      })}
                    </Text>
                  </View>
                </View>
                <Text style={styles.jobMeta}>
                  {item.category} · {item.location_type}
                </Text>
              </>
            ) : null}
          </TouchableOpacity>
        )}
        ListHeaderComponent={
          isFreeFreelancer ? (
            <View style={styles.freePlanBanner}>
              <Text style={styles.freePlanBannerTitle}>Browse mode</Text>
              <Text style={styles.freePlanBannerText}>
                You can browse all listings on Free. Upgrade to Pro to apply to jobs.
              </Text>
              <TouchableOpacity
                style={styles.freePlanBannerBtn}
                activeOpacity={0.85}
                onPress={() => router.push('/paywall')}
              >
                <Text style={styles.freePlanBannerBtnText}>Upgrade to Pro</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        ListEmptyComponent={
          showInitialSkeleton ? (
            <ScreenListSkeleton rows={5} />
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                {isCompanyUser
                  ? 'No projects yet. Post one above.'
                  : feedTab === 'external'
                    ? 'No external jobs found'
                    : 'No jobs found'}
              </Text>
            </View>
          )
        }
      />

      <Modal visible={!!activeExternalJob} transparent animationType="fade" onRequestClose={() => setActiveExternalJob(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <Text style={styles.modalKicker}>View contact</Text>
              <Text style={styles.modalTitle}>{activeExternalJob?.title}</Text>
              <Text style={styles.modalSub}>{activeExternalJob?.company}</Text>

              <View style={styles.modalDetailsCard}>
                <Text style={styles.modalContactLabel}>Job details</Text>
                <View style={styles.modalDetailRow}>
                  <Text style={styles.modalDetailLabel}>Budget</Text>
                  <Text style={styles.modalDetailValueHighlight}>
                    {externalJobRateLabel(activeExternalJob?.rate)}
                  </Text>
                </View>
                {activeExternalJob?.role ? (
                  <View style={styles.modalDetailRow}>
                    <Text style={styles.modalDetailLabel}>Role</Text>
                    <Text style={styles.modalDetailValue}>{activeExternalJob.role}</Text>
                  </View>
                ) : null}
                {activeExternalJob?.location ? (
                  <View style={styles.modalDetailRow}>
                    <Text style={styles.modalDetailLabel}>Location</Text>
                    <Text style={styles.modalDetailValue}>{activeExternalJob.location}</Text>
                  </View>
                ) : null}
                {activeExternalJob?.region ? (
                  <View style={styles.modalDetailRow}>
                    <Text style={styles.modalDetailLabel}>Region</Text>
                    <Text style={styles.modalDetailValue}>{activeExternalJob.region}</Text>
                  </View>
                ) : null}
                {activeExternalJob?.needed_when ? (
                  <View style={styles.modalDetailRow}>
                    <Text style={styles.modalDetailLabel}>Needed when</Text>
                    <Text style={styles.modalDetailValue}>{activeExternalJob.needed_when}</Text>
                  </View>
                ) : null}
                {activeExternalJob?.source_platform ? (
                  <View style={styles.modalDetailRow}>
                    <Text style={styles.modalDetailLabel}>Source</Text>
                    <Text style={styles.modalDetailValue}>{activeExternalJob.source_platform}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.modalContactCard}>
                <Text style={styles.modalContactLabel}>Contact</Text>
                <Text style={styles.modalContactName}>{activeExternalJob?.contact_name || 'n/a'}</Text>
                {activeExternalJob?.contact_email ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => openExternalUrl(`mailto:${activeExternalJob.contact_email!.trim()}`, 'Email')}
                  >
                    <Text style={styles.modalContactMail}>{activeExternalJob.contact_email}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.modalContactMuted}>No email available</Text>
                )}
                {(() => {
                  const linkedIn = linkedinUrl(activeExternalJob?.contact_linkedin ?? '')
                  const instagram = instagramUrl(activeExternalJob?.contact_instagram ?? '')
                  if (!linkedIn && !instagram) return null
                  return (
                    <View style={styles.modalContactLinksRow}>
                      {linkedIn ? (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => openExternalUrl(linkedIn, 'LinkedIn')}
                        >
                          <Text style={styles.modalContactLink}>LinkedIn</Text>
                        </TouchableOpacity>
                      ) : null}
                      {instagram ? (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => openExternalUrl(instagram, 'Instagram')}
                        >
                          <Text style={styles.modalContactLink}>Instagram</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  )
                })()}
              </View>
              <View style={styles.modalIntelCard}>
                <Text style={styles.modalContactLabel}>Intel brief</Text>
                <Text style={styles.modalIntel}>
                  {(activeExternalJob?.intel_brief ?? '').trim() || 'No intel brief available yet.'}
                </Text>
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalGhost} onPress={() => setActiveExternalJob(null)} activeOpacity={0.85}>
                <Text style={styles.modalGhostText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimary}
                onPress={() => {
                  const email = activeExternalJob?.contact_email?.trim()
                  if (!email) return
                  openExternalUrl(`mailto:${email}`, 'Email')
                }}
                activeOpacity={0.85}
                disabled={!activeExternalJob?.contact_email}
              >
                <Text style={styles.modalPrimaryText}>Open email</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={addExternalOpen}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => {
          if (!ceoExtSaving) setAddExternalOpen(false)
        }}
      >
        <SafeAreaView style={styles.ceoModalSafe} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <View style={styles.ceoModalHeader}>
              <Text style={styles.ceoModalTitle}>External job</Text>
              <TouchableOpacity
                onPress={() => {
                  if (!ceoExtSaving) setAddExternalOpen(false)
                }}
                hitSlop={12}
                disabled={ceoExtSaving}
              >
                <Text style={styles.ceoModalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.ceoModalHint}>Published to External — same visibility as freelancer pool.</Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.ceoFormScroll}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.ceoLabel}>Title — required</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoTitle}
                onChangeText={setCeoTitle}
                placeholder="e.g. Logo design"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
              <Text style={styles.ceoLabel}>Contact email — required</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoContactEmail}
                onChangeText={setCeoContactEmail}
                placeholder="producer@agency.com"
                placeholderTextColor="rgba(255,255,255,0.25)"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.ceoLabel}>Company / client</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoCompany}
                onChangeText={setCeoCompany}
                placeholder="Optional"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
              <Text style={styles.ceoLabel}>Location</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoLocation}
                onChangeText={setCeoLocation}
                placeholder="Berlin · Remote…"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
              <Text style={styles.ceoLabel}>Budget / rate</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoRate}
                onChangeText={setCeoRate}
                placeholder="e.g. €450/day"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
              <Text style={styles.ceoLabel}>Role line</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoRoleLine}
                onChangeText={setCeoRoleLine}
                placeholder="Optional"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
              <Text style={styles.ceoLabel}>Timing</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoNeededWhen}
                onChangeText={setCeoNeededWhen}
                placeholder="ASAP, next month…"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
              <Text style={styles.ceoLabel}>Contact name</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoContactName}
                onChangeText={setCeoContactName}
                placeholder="Optional"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
              <Text style={styles.ceoLabel}>LinkedIn</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoLinkedIn}
                onChangeText={setCeoLinkedIn}
                placeholder="Optional URL"
                placeholderTextColor="rgba(255,255,255,0.25)"
                autoCapitalize="none"
              />
              <Text style={styles.ceoLabel}>Instagram</Text>
              <TextInput
                style={styles.ceoInput}
                value={ceoInstagram}
                onChangeText={setCeoInstagram}
                placeholder="Optional @handle"
                placeholderTextColor="rgba(255,255,255,0.25)"
                autoCapitalize="none"
              />
              <Text style={styles.ceoLabel}>Intel brief</Text>
              <TextInput
                style={[styles.ceoInput, styles.ceoTextArea]}
                value={ceoIntel}
                onChangeText={setCeoIntel}
                placeholder="Details shown alongside contact info"
                placeholderTextColor="rgba(255,255,255,0.25)"
                multiline
              />
              <TouchableOpacity
                style={[styles.ceoPublishBtn, ceoExtSaving && styles.ceoPublishBtnDisabled]}
                activeOpacity={0.85}
                disabled={ceoExtSaving}
                onPress={() => void submitCeoExternalListing()}
              >
                {ceoExtSaving ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.ceoPublishBtnText}>Publish to External</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: { fontSize: 28, fontWeight: '900', color: '#ffffff', letterSpacing: 1 },
  badge: {
    backgroundColor: 'rgba(255,220,0,0.12)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: '#FFDC00', fontSize: 11, fontWeight: '700' },
  postJobBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#FFDC00',
  },
  postJobBtnText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  feedTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 4,
  },
  feedTabBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  feedTabBtnActive: {
    backgroundColor: '#FFDC00',
  },
  feedTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
  },
  feedTabTextActive: {
    color: '#0a0a0a',
  },
  searchWrap: {
    marginHorizontal: 20,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#fff',
  },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  listEmpty: { flexGrow: 1 },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  companyLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
  },
  companyLogoPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,220,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyLogoLetter: { fontSize: 15, fontWeight: '800', color: '#FFDC00' },
  companyName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.2,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  statusPillText: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.5 },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    backgroundColor: 'rgba(255,220,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.28)',
  },
  lockPillText: { fontSize: 10, fontWeight: '800', color: '#FFDC00', letterSpacing: 0.5 },
  emptyWrap: { paddingVertical: 32, alignItems: 'center' },
  freePlanBanner: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
  },
  freePlanBannerTitle: { fontSize: 13, fontWeight: '800', color: '#FFDC00', marginBottom: 6 },
  freePlanBannerText: { fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 19, marginBottom: 12 },
  freePlanBannerBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFDC00',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  freePlanBannerBtnText: { fontSize: 13, fontWeight: '800', color: '#0a0a0a' },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  jobTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#ffffff', marginRight: 8 },
  budgetBadge: {
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  budgetText: { color: '#FFDC00', fontSize: 11, fontWeight: '600' },
  jobMeta: { fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: 0.5 },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 15 },
  externalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  externalActionBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  externalActionBtnText: {
    color: '#0a0a0a',
    fontSize: 11,
    fontWeight: '800',
  },
  externalGhostBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  externalGhostBtnText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: '#161616',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    maxHeight: '88%',
  },
  modalScrollContent: {
    paddingBottom: 4,
  },
  modalKicker: {
    color: '#FFDC00',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  modalSub: {
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    marginBottom: 10,
  },
  modalDetailsCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    gap: 8,
  },
  modalDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  modalDetailLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  modalDetailValue: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  modalDetailValueHighlight: {
    fontSize: 13,
    color: '#FFDC00',
    fontWeight: '800',
    flex: 1,
    textAlign: 'right',
  },
  modalIntelCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  modalIntel: {
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 22,
  },
  modalContactCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  modalContactLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 6,
  },
  modalContactName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalContactMail: {
    color: '#FFDC00',
    fontSize: 13,
    fontWeight: '600',
  },
  modalContactMuted: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
  },
  modalContactLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 10,
  },
  modalContactLink: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  modalGhost: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalGhostText: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '700',
    fontSize: 12,
  },
  modalPrimary: {
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalPrimaryText: {
    color: '#0a0a0a',
    fontWeight: '800',
    fontSize: 12,
  },
  ceoAddExternalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    backgroundColor: 'rgba(255,220,0,0.06)',
  },
  ceoAddExternalBtnText: { fontSize: 15, fontWeight: '800', color: '#FFDC00', letterSpacing: 0.2 },
  ceoModalSafe: { flex: 1, backgroundColor: '#0a0a0a' },
  ceoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  ceoModalTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.3 },
  ceoModalClose: { fontSize: 16, fontWeight: '700', color: '#FFDC00' },
  ceoModalHint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
  },
  ceoFormScroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 6 },
  ceoLabel: {
    marginTop: 10,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.38)',
    fontWeight: '700',
  },
  ceoInput: {
    marginTop: 4,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#fff',
  },
  ceoTextArea: { minHeight: 110, textAlignVertical: 'top' },
  ceoPublishBtn: {
    marginTop: 22,
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  ceoPublishBtnDisabled: { opacity: 0.65 },
  ceoPublishBtnText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
})

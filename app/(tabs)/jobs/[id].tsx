import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useGlobalSearchParams, useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Share2, Lock } from 'lucide-react-native'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { getCreaWebBaseUrl, openProjectOnWeb } from '@/lib/creaWeb'
import { jobShareUrl } from '@/lib/shareLinks'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'
import { freelancerCanApplyToJobs, resolveFreelancerPlanFromUserAndProfileTier } from '@/lib/freelancerPlan'
import {
  findBookingReplyStatus,
  bookingOpenDeepLinkMatchesJob,
  parseBookingDm,
  type BookingDmPayloadV1,
  type BookingReplyStatus,
} from '@/lib/bookingDm'
import { replyToBookingMessage } from '@/lib/replyToBookingMessage'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { ensureMarketplaceJobWorkspaceRow } from '@/lib/ensureMarketplaceJobWorkspace'
import { applyToJobViaWebApi, fetchJobApplicationStatus, type JobApplicationStatus } from '@/lib/applyToJobApi'
import { parseJobCategoryRoles } from '@/lib/jobCategoryRoles'
import { resolveAppliedRoleForSubmit } from '@/lib/jobApplicationRole'

type BookingDeepState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | {
      kind: 'ready'
      payload: BookingDmPayloadV1
      msgId: string
      convId: string
      replyStatus: BookingReplyStatus | null
    }

type JobRow = {
  id: string
  title: string
  category: string
  budget_type: string
  budget_amount: number | null
  budget_currency: string | null
  location_type: string
  description: string | null
  company_id: string
  status: string
  is_solo_workspace?: boolean | null
}

function companyInitial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

function formatBookingRangeShort(isoA: string, isoB: string): string {
  if (isoA === isoB) return isoA
  return `${isoA} → ${isoB}`
}

/** Expo Router may pass a repeated query key as string[]. */
function firstSearchParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return v[0]
  return undefined
}

export default function JobDetailScreen() {
  const local = useLocalSearchParams<{
    id?: string | string[]
    bookingMsg?: string | string[]
    conv?: string | string[]
  }>()
  const global = useGlobalSearchParams<{
    bookingMsg?: string | string[]
    conv?: string | string[]
  }>()
  /** Nested stack: invite query often appears only on global URL, not local — merge both. */
  const id = firstSearchParam(local.id)
  const bookingMsgId =
    firstSearchParam(local.bookingMsg) ??
    firstSearchParam(global.bookingMsg)
  const convIdParam = firstSearchParam(local.conv) ?? firstSearchParam(global.conv)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<JobRow | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [applicationStatus, setApplicationStatus] = useState<JobApplicationStatus>('none')
  const [applyBusy, setApplyBusy] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [hasWorkspaceAccess, setHasWorkspaceAccess] = useState(false)
  const [applicantsCount, setApplicantsCount] = useState(0)
  const [companyName, setCompanyName] = useState('Company')
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [bookingDeep, setBookingDeep] = useState<BookingDeepState>({ kind: 'none' })
  const [bookingBusy, setBookingBusy] = useState(false)
  const [rolePickerOpen, setRolePickerOpen] = useState(false)
  const [selectedApplyRole, setSelectedApplyRole] = useState('')
  const [freelancerPlan, setFreelancerPlan] = useState<'free' | 'pro'>('free')

  /** Params can hydrate after first paint — bump `none` → `loading` when invite query appears. */
  useEffect(() => {
    if (!bookingMsgId || !convIdParam) {
      setBookingDeep({ kind: 'none' })
      return
    }
    setBookingDeep((prev) => (prev.kind === 'none' ? { kind: 'loading' } : prev))
  }, [bookingMsgId, convIdParam])
  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') {
      setLoading(false)
      return
    }
    setAccessDenied(false)
    setApplied(false)
    setApplicationStatus('none')
    setHasWorkspaceAccess(false)
    setProjectId(null)
    const { data: { user } } = await supabase.auth.getUser()
    setUid(user?.id ?? null)

    let resolvedRole: string | null = null
    if (user) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('role, subscription_tier')
        .eq('id', user.id)
        .single()
      resolvedRole = resolveAppRole(prof?.role, user)
      setRole(prof?.role ?? null)
      const plan = resolveFreelancerPlanFromUserAndProfileTier(user, prof?.subscription_tier)
      setFreelancerPlan(plan)
    } else {
      setRole(null)
    }

    const { data: row, error } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle()

    if (error || !row) {
      setAccessDenied(false)
      setJob(null)
      setCompanyName('Company')
      setCompanyLogoUrl(null)
      setLoading(false)
      return
    }

    const ownerId = String((row as JobRow).company_id || '').trim()
    const isWorkspaceOnly = Boolean((row as JobRow).is_solo_workspace)
    if (isWorkspaceOnly) {
      setAccessDenied(true)
      setJob(null)
      setCompanyName('Company')
      setCompanyLogoUrl(null)
      setLoading(false)
      return
    }
    if (user && isCompanyProfile(resolvedRole) && ownerId && user.id !== ownerId) {
      setAccessDenied(true)
      setJob(null)
      setCompanyName('Company')
      setCompanyLogoUrl(null)
      setLoading(false)
      return
    }

    setAccessDenied(false)
    setJob(row as JobRow)

    const cid = String((row as JobRow).company_id || '').trim()
    if (cid) {
      const { data: cp } = await supabase.from('profiles').select('name, avatar_url').eq('id', cid).maybeSingle()
      if (cp) {
        setCompanyName((cp.name || 'Company').trim() || 'Company')
        const u = cp.avatar_url?.trim()
        setCompanyLogoUrl(u && /^https?:\/\//i.test(u) ? u : null)
      } else {
        setCompanyName('Company')
        setCompanyLogoUrl(null)
      }
    } else {
      setCompanyName('Company')
      setCompanyLogoUrl(null)
    }

    if (user) {
      const appStatus = await fetchJobApplicationStatus(id)
      setApplied(appStatus.applied)
      setApplicationStatus(appStatus.status)
      setApplicantsCount(appStatus.applicantCount)
      if (appStatus.projectId) setProjectId(appStatus.projectId)
      setHasWorkspaceAccess(appStatus.hasWorkspaceAccess)

      const ownerIdRow = String((row as JobRow).company_id || '').trim()
      if (resolvedRole && isCompanyProfile(resolvedRole) && ownerIdRow === user.id) {
        await ensureMarketplaceJobWorkspaceRow(supabase, { jobId: id, userId: user.id })
      }

      if (!appStatus.projectId) {
        const { data: proj } = await supabase.from('projects').select('id').eq('job_id', id).maybeSingle()
        let pid = proj?.id ?? null
        if (!pid) {
          const { data: projById } = await supabase.from('projects').select('id').eq('id', id).maybeSingle()
          pid = projById?.id ?? null
        }
        if (pid) {
          setProjectId(pid)
          if (!appStatus.hasWorkspaceAccess) {
            const { data: inProject } = await supabase.rpc('user_in_project', {
              p_project_id: pid,
              p_user: user.id,
            })
            setHasWorkspaceAccess(Boolean(inProject))
          }
        }
      }
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!id || typeof id !== 'string' || !bookingMsgId || !convIdParam) {
        setBookingDeep({ kind: 'none' })
        return
      }
      if (loading || !uid || !job) {
        return
      }
      if (!isFreelancerProfile(role ?? undefined)) {
        setBookingDeep({ kind: 'none' })
        return
      }
      if (uid === job.company_id) {
        setBookingDeep({ kind: 'none' })
        return
      }
      setBookingDeep({ kind: 'loading' })
      const { data: msg, error: mErr } = await supabase
        .from('messages')
        .select('id, sender_id, body, content')
        .eq('id', bookingMsgId)
        .eq('conversation_id', convIdParam)
        .maybeSingle()
      if (cancelled) return
      if (mErr || !msg) {
        setBookingDeep({ kind: 'invalid' })
        return
      }
      const raw = msg.body ?? msg.content ?? ''
      const payload = parseBookingDm(typeof raw === 'string' ? raw : '')
      if (!payload || !bookingOpenDeepLinkMatchesJob(payload.openDeepLink, id)) {
        setBookingDeep({ kind: 'invalid' })
        return
      }
      if (String(msg.sender_id) !== job.company_id) {
        setBookingDeep({ kind: 'invalid' })
        return
      }
      const { data: msgs } = await supabase
        .from('messages')
        .select('id, sender_id, created_at, body, content')
        .eq('conversation_id', convIdParam)
        .order('created_at', { ascending: true })
      if (cancelled) return
      const replyStatus = findBookingReplyStatus(msgs ?? [], bookingMsgId, uid)
      setBookingDeep({
        kind: 'ready',
        payload,
        msgId: bookingMsgId,
        convId: convIdParam,
        replyStatus,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [id, bookingMsgId, convIdParam, uid, job, role, loading])

  const publicJobUrl = useMemo(() => {
    if (!id || typeof id !== 'string') return ''
    return jobShareUrl(id)
  }, [id])

  const jobShareMessage = useMemo(() => {
    if (!job) return ''
    const label = isCompanyProfile(role ?? undefined) ? 'Project' : 'Job'
    return `${label} on Crea: ${job.title}${companyName && companyName !== 'Company' ? ` — ${companyName}` : ''}`
  }, [job, companyName, role])

  const webBase = getCreaWebBaseUrl()
  const isOwner = job != null && uid === job.company_id
  const freelancer = isFreelancerProfile(role ?? undefined)
  const company = isCompanyProfile(role ?? undefined)
  const listingWord = company ? 'Project' : 'Job'
  const listingWordPlural = company ? 'Projects' : 'Jobs'

  const openedFromBooking = Boolean(bookingMsgId && convIdParam)

  /** Owners / accepted crew skip job listing and open workspace directly. */
  const [detailReady, setDetailReady] = useState(false)
  useEffect(() => {
    setDetailReady(false)
  }, [id])

  useEffect(() => {
    if (loading) return

    if (accessDenied || !job) {
      setDetailReady(true)
      return
    }

    const isCoOwner = isCompanyProfile(role ?? undefined) && uid === job.company_id
    if (isCoOwner && projectId) {
      router.replace(`/project/${projectId}`)
      return
    }

    const bookingAccepted =
      openedFromBooking &&
      bookingDeep.kind === 'ready' &&
      bookingDeep.replyStatus === 'accepted'
    const crewHasWorkspace =
      Boolean(projectId) &&
      (hasWorkspaceAccess || (freelancer && applicationStatus === 'accepted'))

    if (bookingAccepted && crewHasWorkspace && projectId) {
      router.replace(`/project/${projectId}`)
      return
    }

    setDetailReady(true)
  }, [
    loading,
    accessDenied,
    job,
    uid,
    role,
    projectId,
    openedFromBooking,
    bookingDeep,
    hasWorkspaceAccess,
    applicationStatus,
    freelancer,
    router,
  ])

  const pendingBookingGate = bookingDeep.kind === 'ready' && bookingDeep.replyStatus === null

  /** Hide “Apply” for invite URLs until we fall back to `invalid` (broken/stale link). */
  const hideApplyForInviteDeepLink = openedFromBooking && bookingDeep.kind !== 'invalid'

  const canApplyToJobs = freelancerCanApplyToJobs(freelancerPlan)

  const canShowApply =
    freelancer &&
    canApplyToJobs &&
    !isOwner &&
    job?.status === 'active' &&
    !pendingBookingGate &&
    !hideApplyForInviteDeepLink &&
    applicationStatus === 'none' &&
    !hasWorkspaceAccess

  const showUpgradeForApply =
    freelancer &&
    !canApplyToJobs &&
    !isOwner &&
    job?.status === 'active' &&
    !pendingBookingGate &&
    !hideApplyForInviteDeepLink &&
    applicationStatus === 'none' &&
    !hasWorkspaceAccess

  const showWorkspace = Boolean(
    projectId &&
      (hasWorkspaceAccess ||
        (company && isOwner) ||
        (freelancer && applicationStatus === 'accepted'))
  )

  const onBookingRespond = async (status: BookingReplyStatus) => {
    if (bookingDeep.kind !== 'ready') return
    setBookingBusy(true)
    const convId = bookingDeep.convId
    const title = bookingDeep.payload.title.trim() || 'Project'
    const r = await replyToBookingMessage({
      conversationId: convId,
      bookingMessageId: bookingDeep.msgId,
      status,
      projectTitle: title,
    })
    setBookingBusy(false)
    if (r.ok === false) {
      Alert.alert('Could not send', r.error)
      return
    }
    if (status === 'declined') {
      Alert.alert('Declined', 'The company has been notified in Messages.')
      router.back()
      return
    }
    const { data: proj } = await supabase.from('projects').select('id').eq('job_id', id).maybeSingle()
    if (proj?.id) {
      router.replace(`/project/${proj.id}`)
      return
    }
    Alert.alert(
      'Booking accepted',
      'The company has been notified. You can follow up in Messages — the workspace will open here once it’s created.'
    )
    router.push(`/conversation/${convId}`)
  }

  const jobRoles = useMemo(() => parseJobCategoryRoles(job?.category), [job?.category])

  const submitApplication = async (appliedRole: string | null) => {
    if (!uid || !job) return
    setApplyBusy(true)
    try {
      const result = await applyToJobViaWebApi(job.id, appliedRole)
      if (!result.ok) {
        const msg = result.error ?? ''
        if (msg === 'applied_role_required') {
          Alert.alert('Choose a role', 'Please select which role you are applying for.')
          setRolePickerOpen(true)
          return
        }
        if (msg === 'invalid_applied_role') {
          Alert.alert('Invalid role', 'That role is not listed on this job.')
          return
        }
        if (msg === 'already_applied') {
          Alert.alert('Already applied', 'You have already applied to this job.')
          setApplied(true)
          setApplicationStatus('pending')
          return
        }
        if (msg === 'cannot_apply_to_own_job') {
          Alert.alert('Could not apply', 'You cannot apply to your own job listing.')
          return
        }
        if (msg === 'pro_plan_required') {
          Alert.alert(
            'Pro required to apply',
            'Browsing is free. Upgrade to Pro to apply to jobs.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Upgrade to Pro', onPress: () => router.push('/paywall') },
            ]
          )
          return
        }
        if (msg === 'job_not_active' || msg === 'job_not_found') {
          Alert.alert('Could not apply', 'This job is no longer open for applications.')
          return
        }
        if (msg === 'freelancer_profile_required') {
          Alert.alert(
            'Profile required',
            'Complete your freelancer profile before applying to marketplace jobs.'
          )
          return
        }
        if (msg === 'beta_trial_ended_new_job_work_not_allowed') {
          Alert.alert(
            'Trial ended',
            'Your beta trial has ended. Upgrade your plan to apply to new jobs.'
          )
          return
        }
        if (msg === 'missing_web_url' || msg === 'network_error' || msg === 'network_timeout') {
          Alert.alert(
            'Could not apply',
            'Could not reach CREA. Check your connection and try again.'
          )
          return
        }
        Alert.alert('Could not apply', msg || 'Something went wrong. Please try again.')
        return
      }
      if (result.alreadyApplied) {
        Alert.alert('Already applied', 'You have already applied to this job.')
        setApplied(true)
        setApplicationStatus('pending')
        return
      }
      setApplied(true)
      setApplicationStatus('pending')
      setRolePickerOpen(false)
      setApplicantsCount((c) => c + 1)
      if (result.applicationId) {
        void notifyExpoEvent({ kind: 'job_application', applicationId: result.applicationId })
      }
      Alert.alert('Applied', 'The company will see your application.')
    } finally {
      setApplyBusy(false)
    }
  }

  const onApply = () => {
    if (!uid || !job) return
    const resolved = resolveAppliedRoleForSubmit(job.category, null)
    if (!resolved.ok) {
      setSelectedApplyRole('')
      setRolePickerOpen(true)
      return
    }
    void submitApplication(resolved.role)
  }

  const openWorkspace = () => {
    if (projectId) router.push(`/project/${projectId}`)
  }

  if (loading || !detailReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (accessDenied) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>{listingWordPlural}</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.missTitle}>Not available</Text>
          <Text style={styles.missSub}>You can only view projects posted by your company.</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!job) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>{listingWordPlural}</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.missTitle}>{listingWord} not found</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>{listingWordPlural}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.shareIconBtn}
          onPress={() => setShareOpen(true)}
          hitSlop={12}
          accessibilityLabel={`Share ${listingWord.toLowerCase()}`}
        >
          <Share2 size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
      </View>

      <Modal visible={rolePickerOpen} transparent animationType="fade" onRequestClose={() => setRolePickerOpen(false)}>
        <View style={styles.roleBackdrop}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.roleScroll}>
            <View style={styles.roleCard}>
              <Text style={styles.roleTitle}>Apply for role</Text>
              <Text style={styles.roleHint}>
                Pick the role you&apos;re applying for on this job.
              </Text>
              <View style={styles.roleChips}>
                {jobRoles.map((r) => {
                  const on = selectedApplyRole === r
                  return (
                    <TouchableOpacity
                      key={r}
                      style={[styles.roleChip, on && styles.roleChipOn]}
                      onPress={() => setSelectedApplyRole(r)}
                      disabled={applyBusy}
                    >
                      <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{r}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
              <View style={styles.roleActions}>
                <TouchableOpacity style={styles.roleCancel} onPress={() => setRolePickerOpen(false)} disabled={applyBusy}>
                  <Text style={styles.roleCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleConfirm, (!selectedApplyRole || applyBusy) && styles.btnDisabled]}
                  disabled={!selectedApplyRole || applyBusy}
                  onPress={() => {
                    const resolved = resolveAppliedRoleForSubmit(job?.category, selectedApplyRole)
                    if (!resolved.ok) {
                      Alert.alert('Choose a role', 'Please select one of the roles listed on this job.')
                      return
                    }
                    void submitApplication(resolved.role)
                  }}
                >
                  {applyBusy ? (
                    <ActivityIndicator color="#0a0a0a" />
                  ) : (
                    <Text style={styles.roleConfirmText}>Send application</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <ShareSheetModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        sheetTitle={`Share ${listingWord.toLowerCase()}`}
        shareMessage={jobShareMessage}
        shareUrl={publicJobUrl}
        mailSubject={`Crea ${listingWord.toLowerCase()}: ${job.title}`}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {bookingDeep.kind === 'loading' && freelancer && !isOwner && bookingMsgId && convIdParam ? (
          <View style={styles.bookingLoading}>
            <ActivityIndicator color="#FFDC00" />
            <Text style={styles.bookingLoadingText}>Loading booking…</Text>
          </View>
        ) : null}

        {bookingDeep.kind === 'ready' && freelancer && !isOwner ? (
          <View style={styles.bookingGate}>
            <Text style={styles.bookingGateKicker}>Booking request</Text>
            <Text style={styles.bookingGateTitle}>{bookingDeep.payload.title}</Text>
            <Text style={styles.bookingGateDates}>
              {formatBookingRangeShort(bookingDeep.payload.isoStartDate, bookingDeep.payload.isoEndDate)}
              {' · '}
              {bookingDeep.payload.selectedIsoDates?.length ?? 0} day
              {(bookingDeep.payload.selectedIsoDates?.length ?? 0) === 1 ? '' : 's'}
            </Text>
            {bookingDeep.replyStatus ? (
              <View
                style={[
                  styles.bookingResolvedPill,
                  bookingDeep.replyStatus === 'accepted'
                    ? styles.bookingResolvedYes
                    : styles.bookingResolvedNo,
                ]}
              >
                <Text style={styles.bookingResolvedText}>
                  You {bookingDeep.replyStatus === 'accepted' ? 'accepted' : 'declined'} this request
                </Text>
              </View>
            ) : (
              <View style={styles.bookingActions}>
                <TouchableOpacity
                  style={[styles.bookingDeclineBtn, bookingBusy && styles.btnDisabled]}
                  onPress={() => void onBookingRespond('declined')}
                  disabled={bookingBusy}
                >
                  <Text style={styles.bookingDeclineText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bookingAcceptBtn, bookingBusy && styles.btnDisabled]}
                  onPress={() => void onBookingRespond('accepted')}
                  disabled={bookingBusy}
                >
                  {bookingBusy ? (
                    <ActivityIndicator color="#0a0a0a" />
                  ) : (
                    <Text style={styles.bookingAcceptText}>Accept</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.bookingGateHint}>Details below if you need them.</Text>
          </View>
        ) : null}

        <View style={styles.companyRow}>
          {companyLogoUrl ? (
            <Image source={{ uri: companyLogoUrl }} style={styles.companyLogo} />
          ) : (
            <View style={styles.companyLogoPlaceholder}>
              <Text style={styles.companyLogoLetter}>{companyInitial(companyName)}</Text>
            </View>
          )}
          <View style={styles.companyTextCol}>
            <Text style={styles.companyPosted}>Posted by</Text>
            <Text style={styles.companyName} numberOfLines={2}>
              {companyName}
            </Text>
          </View>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>{job.title}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{job.status}</Text>
          </View>
        </View>
        <Text style={styles.budget}>
          {formatBudgetDisplay({
            budget_type: job.budget_type,
            budget_amount: job.budget_amount,
            budget_currency: job.budget_currency,
          })}
        </Text>
        <Text style={styles.meta}>
          {job.category} · {job.location_type}
          {isOwner ? ' · Your listing' : ''}
        </Text>

        {job.description ? <Text style={styles.body}>{job.description}</Text> : null}

        {company && isOwner ? (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Applicants</Text>
            <Text style={styles.panelValue}>{applicantsCount}</Text>
          </View>
        ) : null}

        {canShowApply ? (
          <TouchableOpacity
            style={[styles.primaryBtn, applyBusy && styles.btnDisabled]}
            onPress={onApply}
            disabled={applyBusy}
          >
            {applyBusy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.primaryBtnText}>Apply now</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {showUpgradeForApply ? (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.lockedApplyBtn]}
              onPress={() => router.push('/paywall')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Apply now — Pro required"
            >
              <Lock size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
              <Text style={styles.primaryBtnText}>Apply now</Text>
            </TouchableOpacity>
            <Text style={styles.lockedApplyHint}>
              Browsing is free. Upgrade to Pro to apply and unlock production tools.
            </Text>
          </>
        ) : null}

        {freelancer && !isOwner && applicationStatus === 'pending' ? (
          <View style={[styles.applicationStatusPill, styles.applicationStatusPillPending]}>
            <Text style={styles.applicationStatusPending}>Application pending</Text>
          </View>
        ) : null}

        {freelancer && !isOwner && applicationStatus === 'declined' ? (
          <View style={[styles.applicationStatusPill, styles.applicationStatusPillDeclined]}>
            <Text style={styles.applicationStatusDeclined}>Application not selected</Text>
          </View>
        ) : null}

        {company && isOwner && openedFromBooking ? (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                if (convIdParam) router.push(`/conversation/${convIdParam}`)
              }}
              accessibilityRole="button"
              accessibilityLabel="Open Messages"
            >
              <Text style={styles.primaryBtnText}>Open Messages</Text>
            </TouchableOpacity>
            <Text style={styles.bookingCompanyExplainer}>
              The freelancer taps Accept or Decline in this chat. Your project workspace is available below — they only get access after accepting or once you accept their application.
            </Text>
          </>
        ) : null}

        {showWorkspace ? (
          <>
            <TouchableOpacity style={styles.primaryBtn} onPress={openWorkspace}>
              <Text style={styles.primaryBtnText}>Open project workspace</Text>
            </TouchableOpacity>
            {webBase ? (
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => openProjectOnWeb(projectId, '?tool=brief')}
              >
                <Text style={styles.linkBtnText}>Full Brief AI on web →</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.hint}>
                Set EXPO_PUBLIC_CREA_WEB_URL in .env to open the web workspace (Brief AI, Frame.io, files).
              </Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  shareIconBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  companyLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
  },
  companyLogoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyLogoLetter: { fontSize: 18, fontWeight: '800', color: '#FFDC00' },
  companyTextCol: { flex: 1 },
  companyPosted: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  companyName: { fontSize: 17, fontWeight: '800', color: 'rgba(255,255,255,0.9)' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 24, fontWeight: '900', color: '#ffffff', lineHeight: 30 },
  badge: {
    backgroundColor: 'rgba(255,220,0,0.12)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  badgeText: { color: '#FFDC00', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  budget: { fontSize: 20, fontWeight: '800', color: '#FFDC00', marginTop: 12 },
  meta: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 8 },
  body: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 22,
    marginTop: 20,
  },
  panel: {
    marginTop: 24,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  panelLabel: { fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, marginBottom: 6 },
  panelValue: { fontSize: 28, fontWeight: '900', color: '#FFDC00' },
  primaryBtn: {
    marginTop: 24,
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  lockedApplyBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  lockedApplyHint: {
    marginTop: 10,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 18,
    textAlign: 'center',
  },
  upgradePanel: {
    marginTop: 24,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
  },
  upgradePanelTitle: { fontSize: 14, fontWeight: '800', color: '#FFDC00', marginBottom: 6 },
  upgradePanelText: { fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 19, marginBottom: 14 },
  secondaryBtn: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: '#FFDC00' },
  linkBtn: { marginTop: 14, paddingVertical: 8 },
  linkBtnText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,220,0,0.85)' },
  hint: { marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 18 },
  bookingLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
    paddingVertical: 12,
  },
  bookingLoadingText: { fontSize: 13, color: 'rgba(255,255,255,0.45)' },
  bookingGate: {
    marginBottom: 22,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    backgroundColor: '#111',
    gap: 10,
  },
  bookingGateKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: 'rgba(255,220,0,0.85)',
    textTransform: 'uppercase',
  },
  bookingGateTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  bookingGateDates: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  bookingGateHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  bookingCompanyExplainer: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.42)',
    paddingHorizontal: 4,
  },
  bookingActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  bookingDeclineBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
  },
  bookingDeclineText: { fontSize: 15, fontWeight: '800', color: 'rgba(255,255,255,0.9)' },
  bookingAcceptBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  bookingAcceptText: { fontSize: 15, fontWeight: '800', color: '#0a0a0a' },
  bookingResolvedPill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  bookingResolvedYes: { backgroundColor: 'rgba(21,128,61,0.28)' },
  bookingResolvedNo: { backgroundColor: 'rgba(180,83,9,0.25)' },
  bookingResolvedText: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.9)' },
  btnDisabled: { opacity: 0.55 },
  applicationStatusPill: {
    marginTop: 24,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
  applicationStatusPillPending: {
    borderColor: 'rgba(255,220,0,0.35)',
  },
  applicationStatusPillDeclined: {
    borderColor: 'rgba(255,255,255,0.15)',
  },
  applicationStatusPending: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255,220,0,0.85)',
  },
  applicationStatusDeclined: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
  },
  missTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  missSub: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 24,
  },
  roleBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  roleScroll: { flexGrow: 1, justifyContent: 'center' },
  roleCard: {
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 20,
  },
  roleTitle: { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 8 },
  roleHint: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 19, marginBottom: 16 },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  roleChipOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  roleChipText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  roleChipTextOn: { color: '#0a0a0a' },
  roleActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  roleCancel: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  roleCancelText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  roleConfirm: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#FFDC00',
    minWidth: 140,
    alignItems: 'center',
  },
  roleConfirmText: { fontSize: 14, fontWeight: '800', color: '#0a0a0a' },
})

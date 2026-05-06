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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Share2 } from 'lucide-react-native'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { getCreaWebBaseUrl, openProjectOnWeb } from '@/lib/creaWeb'
import { jobShareUrl } from '@/lib/shareLinks'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUserAndProfileTier } from '@/lib/freelancerPlan'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'

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

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<JobRow | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [applicantsCount, setApplicantsCount] = useState(0)
  const [companyName, setCompanyName] = useState('Company')
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') {
      setLoading(false)
      return
    }
    setAccessDenied(false)
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
      if (
        resolvedRole === 'freelancer' &&
        isFreelancerWorkspaceOnlyPlan(resolveFreelancerPlanFromUserAndProfileTier(user, prof?.subscription_tier))
      ) {
        setAccessDenied(true)
        setJob(null)
        setCompanyName('Company')
        setCompanyLogoUrl(null)
        setLoading(false)
        return
      }
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
      const { data: existing } = await supabase
        .from('job_applications')
        .select('id')
        .eq('job_id', id)
        .eq('freelancer_id', user.id)
        .maybeSingle()
      setApplied(!!existing)

      const { count } = await supabase
        .from('job_applications')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', id)
      setApplicantsCount(count ?? 0)

      const { data: proj } = await supabase.from('projects').select('id').eq('job_id', id).maybeSingle()
      setProjectId(proj?.id ?? null)
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

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

  const onApply = async () => {
    if (!uid || !job) return
    setApplyBusy(true)
    const { data: insertedApp, error } = await supabase
      .from('job_applications')
      .insert({
        job_id: job.id,
        freelancer_id: uid,
        status: 'pending',
      })
      .select('id')
      .single()
    setApplyBusy(false)
    if (error) {
      Alert.alert('Could not apply', error.message)
      return
    }
    setApplied(true)
    setApplicantsCount((c) => c + 1)
    if (insertedApp?.id) {
      void notifyExpoEvent({ kind: 'job_application', applicationId: insertedApp.id })
    }
    Alert.alert('Applied', 'The company will see your application.')
  }

  const onCreateWorkspace = async () => {
    if (!uid || !job || !isOwner || !isCompanyProfile(role ?? undefined)) return
    setCreateBusy(true)
    const { data: apps, error: aerr } = await supabase
      .from('job_applications')
      .select('freelancer_id')
      .eq('job_id', job.id)
      .order('created_at', { ascending: true })
      .limit(1)

    if (aerr || !apps?.length) {
      setCreateBusy(false)
      Alert.alert(
        'No applicants yet',
        'Once a freelancer applies to this project, you can create a workspace here.'
      )
      return
    }

    const freelancerId = apps[0].freelancer_id
    const { data: inserted, error: perr } = await supabase
      .from('projects')
      .insert({
        job_id: job.id,
        company_id: uid,
        freelancer_id: freelancerId,
        title: job.title,
        status: 'active',
        budget_amount: job.budget_amount,
        budget_type: job.budget_type,
        budget_currency: job.budget_currency ?? 'EUR',
        location: job.location_type,
      })
      .select('id')
      .single()

    setCreateBusy(false)
    if (perr) {
      Alert.alert('Could not create workspace', perr.message)
      return
    }
    setProjectId(inserted.id)
    void notifyExpoEvent({ kind: 'workspace_ready', projectId: inserted.id })
    Alert.alert('Workspace ready', 'Open it to use milestones, crew chat, files, and Brief AI in the app.')
  }

  const openWorkspace = () => {
    if (projectId) router.push(`/project/${projectId}`)
  }

  if (loading) {
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

      <ShareSheetModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        sheetTitle={`Share ${listingWord.toLowerCase()}`}
        shareMessage={jobShareMessage}
        shareUrl={publicJobUrl}
        mailSubject={`Crea ${listingWord.toLowerCase()}: ${job.title}`}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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

        {freelancer && !isOwner && job.status === 'active' ? (
          <TouchableOpacity
            style={[styles.primaryBtn, (applied || applyBusy) && styles.btnDisabled]}
            onPress={onApply}
            disabled={applied || applyBusy}
          >
            {applyBusy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.primaryBtnText}>{applied ? 'Applied' : 'Apply now'}</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {company && isOwner && !projectId ? (
          <TouchableOpacity
            style={[styles.secondaryBtn, createBusy && styles.btnDisabled]}
            onPress={onCreateWorkspace}
            disabled={createBusy}
          >
            {createBusy ? (
              <ActivityIndicator color="#FFDC00" />
            ) : (
              <Text style={styles.secondaryBtnText}>Create project workspace</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {projectId ? (
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
  btnDisabled: { opacity: 0.55 },
  missTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  missSub: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 24,
  },
})

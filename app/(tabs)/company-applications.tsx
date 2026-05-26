import { useCallback, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  companyCanReviewApplications,
  companyPlanWithPlatformTrial,
} from '@/lib/company-plan'
import { resolveCompanySubscriptionPlanFromSources } from '@/lib/companyPlanFromSession'
import { isWithinPlatformTrialPeriod } from '@/lib/platformTrial'

type Row = {
  id: string
  jobId: string
  jobTitle: string
  freelancerId: string
  freelancerName: string
  avatarUrl: string | null
  status: string
  createdAt: string
}

function initial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

export default function CompanyApplicationsScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [proRequired, setProRequired] = useState(false)
  const [rows, setRows] = useState<Row[]>([])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      router.replace('/login')
      return
    }
    const { data: p } = await supabase
      .from('profiles')
      .select('role, trial_ends_at, created_at, subscription_tier')
      .eq('id', user.id)
      .single()
    const role = resolveAppRole(p?.role, user)
    if (!isCompanyProfile(role)) {
      setAllowed(false)
      setProRequired(false)
      setRows([])
      setLoading(false)
      return
    }
    setAllowed(true)

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
      setProRequired(true)
      setRows([])
      setLoading(false)
      return
    }
    setProRequired(false)

    const { data: jobs, error: jerr } = await supabase
      .from('jobs')
      .select('id, title')
      .eq('company_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (jerr || !jobs?.length) {
      setRows([])
      setLoading(false)
      return
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
      setRows([])
      setLoading(false)
      return
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

    setRows(
      apps.map((a) => {
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
    )
    setLoading(false)
  }, [router])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.blockTitle}>Companies only</Text>
          <Text style={styles.blockSub}>Only company accounts can review job applications.</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (proRequired) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Tools</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.blockTitle}>Unlock with Pro</Text>
          <Text style={styles.blockSub}>
            Free includes posting one job listing. Review applicants, accept crew, and manage hiring on Pro.
          </Text>
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => router.push('/paywall')} activeOpacity={0.9}>
            <Text style={styles.upgradeBtnText}>View Pro plans</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Tools</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Applications</Text>
        <Text style={styles.count}>{rows.length} total</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No applications yet. Post a project to receive applicants.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.75}
            onPress={() => router.push(`/(tabs)/jobs/${item.jobId}`)}
          >
            <View style={styles.row}>
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPh}>
                  <Text style={styles.avatarLetter}>{initial(item.freelancerName)}</Text>
                </View>
              )}
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.freelancerName}
                </Text>
                <Text style={styles.jobLine} numberOfLines={2}>
                  {item.jobTitle}
                </Text>
                <View style={styles.footer}>
                  <Text style={styles.status}>{item.status}</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff' },
  count: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 6 },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#222' },
  avatarPh: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,220,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 18, fontWeight: '800', color: '#FFDC00' },
  body: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  jobLine: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },
  footer: { marginTop: 8 },
  status: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  emptyText: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center', paddingVertical: 32 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },
  upgradeBtn: {
    marginTop: 20,
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  upgradeBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '800' },
})

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
import { PlusCircle } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'

type Job = {
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

export default function JobsListScreen() {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [isCompanyUser, setIsCompanyUser] = useState(false)
  const [workspaceOnly, setWorkspaceOnly] = useState(false)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    let role: string | null = null
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      role = resolveAppRole(prof?.role, user)
      const isWorkspaceFreelancer =
        role === 'freelancer' && isFreelancerWorkspaceOnlyPlan(resolveFreelancerPlanFromUser(user))
      setWorkspaceOnly(isWorkspaceFreelancer)
      if (isWorkspaceFreelancer) {
        setJobs([])
        setLoading(false)
        return
      }
    } else {
      setWorkspaceOnly(false)
    }
    const companyOnly = Boolean(user && isCompanyProfile(role))
    setIsCompanyUser(companyOnly)

    let q = supabase
      .from('jobs')
      .select(
        'id, title, category, budget_type, budget_amount, budget_currency, location_type, company_id, status, is_solo_workspace'
      )
      .order('created_at', { ascending: false })
      .limit(companyOnly ? 100 : 30)

    if (companyOnly) {
      q = q.eq('company_id', user!.id)
    } else {
      q = q.eq('status', 'active')
    }
    q = q.eq('is_solo_workspace', false)

    const { data: jobRows, error } = await q

    if (error || !jobRows?.length) {
      setJobs([])
      setLoading(false)
      return
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

    const list: Job[] = jobRows.map((j) => {
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

    setJobs(list)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadJobs()
    }, [loadJobs])
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  const countLabel = isCompanyUser ? `${jobs.length} listing${jobs.length === 1 ? '' : 's'}` : `${jobs.length} open`

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Jobs</Text>
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
          <Text style={styles.postJobBtnText}>Post job</Text>
        </TouchableOpacity>
      ) : null}

      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={[styles.list, jobs.length === 0 && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => router.push(`/(tabs)/jobs/${item.id}`)}
          >
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
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {workspaceOnly
                ? 'Workspace plan: marketplace jobs are hidden.'
                : isCompanyUser
                  ? 'No jobs yet. Post one above.'
                  : 'No jobs found'}
            </Text>
          </View>
        }
      />
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
  emptyWrap: { paddingVertical: 32, alignItems: 'center' },
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
})

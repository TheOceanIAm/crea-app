import { useCallback, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { projectStatusDisplayLabel } from '@/lib/projectStatusDisplay'

type JobRow = {
  id: string
  title: string
  category: string
  status: string
  created_at: string
  /** Hiring workspace linked via `projects.job_id` (at most one per job). */
  workspace: { id: string; status: string } | null
}

function statusLabel(s: string) {
  const t = (s || '').toLowerCase()
  if (t === 'active') return 'Active'
  if (t === 'closed' || t === 'filled') return 'Closed'
  if (t === 'draft') return 'Draft'
  return s || '—'
}

export default function CompanyMyJobsScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [rows, setRows] = useState<JobRow[]>([])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      router.replace('/login')
      return
    }
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = resolveAppRole(p?.role, user)
    if (!isCompanyProfile(role)) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      return
    }
    setAllowed(true)
    const { data, error } = await supabase
      .from('jobs')
      .select('id, title, category, status, created_at')
      .eq('company_id', user.id)
      .eq('is_solo_workspace', false)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error || !data) setRows([])
    else {
      const jobs: JobRow[] = data.map((r) => ({
        id: r.id as string,
        title: String(r.title ?? ''),
        category: String(r.category ?? ''),
        status: String(r.status ?? ''),
        created_at: String(r.created_at ?? ''),
        workspace: null,
      }))
      const jobIds = jobs.map((j) => j.id).filter(Boolean)
      const wsByJob = new Map<string, { id: string; status: string }>()
      if (jobIds.length > 0) {
        const { data: prows } = await supabase
          .from('projects')
          .select('id, job_id, status')
          .in('job_id', jobIds)
        for (const pr of prows ?? []) {
          const jid = pr.job_id as string | null
          if (jid)
            wsByJob.set(jid, { id: String(pr.id), status: String((pr as { status?: string }).status ?? '') })
        }
      }
      setRows(jobs.map((j) => ({ ...j, workspace: wsByJob.get(j.id) ?? null })))
    }
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
          <Text style={styles.blockSub}>Only company accounts can manage project listings.</Text>
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
        <Text style={styles.title}>My projects</Text>
        <Text style={styles.count}>{rows.length} listing{rows.length === 1 ? '' : 's'}</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No projects yet.</Text>
            <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/company-post-job')}>
              <Text style={styles.ctaText}>Post your first project</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => router.push(`/(tabs)/jobs/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.jobTitle} numberOfLines={2}>
                  {item.title.trim() || 'Untitled'}
                </Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{statusLabel(item.status)}</Text>
                </View>
              </View>
              <Text style={styles.meta}>{item.category}</Text>
            </TouchableOpacity>
            {item.workspace ? (
              <TouchableOpacity
                style={styles.workspaceRow}
                activeOpacity={0.75}
                onPress={() => router.push(`/project/${item.workspace!.id}` as Href)}
              >
                <Text style={styles.workspaceLabel}>Open workspace</Text>
                <View style={styles.wsBadge}>
                  <Text style={styles.wsBadgeText}>{projectStatusDisplayLabel(item.workspace.status)}</Text>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff' },
  count: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 6 },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  jobTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#fff' },
  badge: {
    backgroundColor: 'rgba(255,220,0,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#FFDC00', letterSpacing: 0.5 },
  meta: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  workspaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  workspaceLabel: { fontSize: 13, fontWeight: '700', color: '#FFDC00' },
  wsBadge: {
    backgroundColor: 'rgba(255,220,0,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  wsBadgeText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,220,0,0.85)' },
  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', marginBottom: 16 },
  cta: {
    backgroundColor: 'rgba(255,220,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  ctaText: { color: '#FFDC00', fontWeight: '700', fontSize: 15 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
})

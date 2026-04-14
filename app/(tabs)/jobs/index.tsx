import { useEffect, useState } from 'react'
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
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'

type Job = {
  id: string
  title: string
  category: string
  budget_type: string
  budget_amount: number | null
  location_type: string
  company_id: string | null
  company_name: string
  company_logo_url: string | null
}

function budgetLabel(job: Job) {
  if (job.budget_type === 'negotiable') return 'Negotiable'
  if (job.budget_type === 'day_rate') return job.budget_amount ? `€${job.budget_amount}/day` : 'Rate TBD'
  if (job.budget_type === 'fixed') return job.budget_amount ? `€${job.budget_amount.toLocaleString('en-US')}` : 'Budget TBD'
  return '—'
}

function companyInitial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

export default function JobsListScreen() {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: jobRows, error } = await supabase
        .from('jobs')
        .select('id, title, category, budget_type, budget_amount, location_type, company_id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(30)

      if (cancelled) return

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
          id: j.id,
          title: j.title,
          category: j.category,
          budget_type: j.budget_type,
          budget_amount: j.budget_amount,
          location_type: j.location_type,
          company_id: cid,
          company_name: c?.name ?? 'Company',
          company_logo_url: c?.avatar_url ?? null,
        }
      })

      setJobs(list)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Jobs</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{jobs.length} open</Text>
        </View>
      </View>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={styles.list}
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
            </View>
            <View style={styles.cardTop}>
              <Text style={styles.jobTitle}>{item.title}</Text>
              <View style={styles.budgetBadge}>
                <Text style={styles.budgetText}>{budgetLabel(item)}</Text>
              </View>
            </View>
            <Text style={styles.jobMeta}>
              {item.category} · {item.location_type}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No jobs found</Text>
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
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
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

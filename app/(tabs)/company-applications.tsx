import { useCallback, useRef, useState } from 'react'
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
import { getAuthUser } from '@/lib/getAuthUser'
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  readCachedCompanyApplications,
  loadCompanyApplicationsCache,
  cacheCompanyApplications,
  type CompanyApplicationRow,
} from '@/lib/companyApplicationsLoad'
import { peekWarmedOverview } from '@/lib/warmAppCaches'

type Row = CompanyApplicationRow

function initial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

function readInitialApplications(): {
  loading: boolean
  allowed: boolean
  proRequired: boolean
  rows: Row[]
} {
  const uid = peekWarmedOverview()?.userId
  if (!uid) return { loading: true, allowed: false, proRequired: false, rows: [] }
  const cached = readCachedCompanyApplications(uid)
  if (!cached) return { loading: true, allowed: false, proRequired: false, rows: [] }
  return {
    loading: false,
    allowed: cached.allowed,
    proRequired: cached.proRequired,
    rows: cached.rows,
  }
}

export default function CompanyApplicationsScreen() {
  const router = useRouter()
  const boot = useRef(readInitialApplications()).current
  const lastFetchedAt = useRef(boot.loading ? 0 : Date.now())
  const [loading, setLoading] = useState(boot.loading)
  const [allowed, setAllowed] = useState(boot.allowed)
  const [proRequired, setProRequired] = useState(boot.proRequired)
  const [rows, setRows] = useState<Row[]>(boot.rows)

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (
      !opts?.force &&
      lastFetchedAt.current > 0 &&
      Date.now() - lastFetchedAt.current < 30_000
    ) {
      return
    }
    const user = await getAuthUser()
    if (!user) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      router.replace('/login')
      return
    }
    const cached = readCachedCompanyApplications(user.id)
    if (cached && loading) {
      setAllowed(cached.allowed)
      setProRequired(cached.proRequired)
      setRows(cached.rows)
      setLoading(false)
    }
    const data = await loadCompanyApplicationsCache(user)
    setAllowed(data.allowed)
    setProRequired(data.proRequired)
    setRows(data.rows)
    cacheCompanyApplications(user.id, data)
    lastFetchedAt.current = Date.now()
    setLoading(false)
  }, [loading, router])

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
            Free includes one job listing per month. Review applicants, accept crew, and manage hiring on Pro.
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

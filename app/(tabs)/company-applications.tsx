import { useCallback, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { getAuthUser } from '@/lib/getAuthUser'
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  readCachedCompanyApplications,
  loadCompanyApplicationsCache,
  cacheCompanyApplications,
  companyApplicationsCacheKey,
  type CompanyApplicationRow,
} from '@/lib/companyApplicationsLoad'
import {
  acceptCompanyJobApplication,
  declineCompanyJobApplication,
} from '@/lib/companyApplicantActions'
import { deleteCache } from '@/lib/appCache'
import { peekWarmedOverview } from '@/lib/warmAppCaches'

type Row = CompanyApplicationRow

type StatusFilter = 'all' | 'pending' | 'accepted' | 'declined'

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'all', label: 'All' },
]

function statusKey(status: string): StatusFilter {
  const s = status.toLowerCase()
  if (s === 'accepted') return 'accepted'
  if (s === 'declined') return 'declined'
  return 'pending'
}

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
  const [filter, setFilter] = useState<StatusFilter>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, accepted: 0, declined: 0 }
    for (const r of rows) c[statusKey(r.status)] += 1
    return c
  }, [rows])

  const visibleRows = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => statusKey(r.status) === filter)),
    [rows, filter]
  )

  const applyStatusLocally = useCallback(
    (applicationId: string, nextStatus: string) => {
      setRows((prev) =>
        prev.map((r) => (r.id === applicationId ? { ...r, status: nextStatus } : r))
      )
    },
    []
  )

  const bustCache = useCallback(async () => {
    const user = await getAuthUser()
    if (user) deleteCache(companyApplicationsCacheKey(user.id))
    lastFetchedAt.current = 0
  }, [])

  const openWorkspace = useCallback(
    (row: Row) => {
      const target = row.projectId ? `/project/${row.projectId}` : `/(tabs)/jobs/${row.jobId}`
      router.push(target as Href)
    },
    [router]
  )

  const onAccept = useCallback(
    (row: Row) => {
      if (busyId) return
      Alert.alert(
        'Accept application',
        `Accept ${row.freelancerName} for «${row.jobTitle}»? They'll get access to the project workspace.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Accept',
            onPress: () => {
              void (async () => {
                setBusyId(row.id)
                const prevStatus = row.status
                applyStatusLocally(row.id, 'accepted')
                const res = await acceptCompanyJobApplication({
                  applicationId: row.id,
                  freelancerId: row.freelancerId,
                })
                setBusyId(null)
                if (!res.ok) {
                  applyStatusLocally(row.id, prevStatus)
                  Alert.alert('Could not accept', res.error ?? 'Please try again.')
                  return
                }
                await bustCache()
              })()
            },
          },
        ]
      )
    },
    [busyId, applyStatusLocally, bustCache]
  )

  const onDecline = useCallback(
    (row: Row) => {
      if (busyId) return
      Alert.alert(
        'Decline application',
        `Decline ${row.freelancerName} for «${row.jobTitle}»? They won't get workspace access.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Decline',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setBusyId(row.id)
                const prevStatus = row.status
                applyStatusLocally(row.id, 'declined')
                const res = await declineCompanyJobApplication(row.id)
                setBusyId(null)
                if (!res.ok) {
                  applyStatusLocally(row.id, prevStatus)
                  Alert.alert('Could not decline', res.error ?? 'Please try again.')
                  return
                }
                await bustCache()
              })()
            },
          },
        ]
      )
    },
    [busyId, applyStatusLocally, bustCache]
  )

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

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.id
          const n = counts[f.id]
          return (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(f.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {f.label}
                {n > 0 ? ` ${n}` : ''}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <FlatList
        data={visibleRows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {filter === 'pending'
              ? 'No pending applications. New applicants show up here.'
              : rows.length === 0
                ? 'No applications yet. Post a project to receive applicants.'
                : 'Nothing here for this filter.'}
          </Text>
        }
        renderItem={({ item }) => {
          const sk = statusKey(item.status)
          const isBusy = busyId === item.id
          return (
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.75}
                onPress={() => router.push(`/profile/${item.freelancerId}` as Href)}
              >
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
                    {item.appliedRole ? `${item.appliedRole} · ` : ''}
                    {item.jobTitle}
                  </Text>
                  <View style={styles.footer}>
                    <View
                      style={[
                        styles.statusPill,
                        sk === 'accepted'
                          ? styles.statusPillAccepted
                          : sk === 'declined'
                            ? styles.statusPillDeclined
                            : styles.statusPillPending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          sk === 'accepted'
                            ? styles.statusPillTextAccepted
                            : sk === 'declined'
                              ? styles.statusPillTextDeclined
                              : styles.statusPillTextPending,
                        ]}
                      >
                        {sk === 'accepted' ? 'Accepted' : sk === 'declined' ? 'Declined' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                </View>
                <ChevronRight size={18} color="rgba(255,255,255,0.25)" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>

              {sk === 'pending' ? (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.declineBtn, isBusy && styles.actionDisabled]}
                    onPress={() => onDecline(item)}
                    disabled={isBusy}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.declineBtnText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.acceptBtn, isBusy && styles.actionDisabled]}
                    onPress={() => onAccept(item)}
                    disabled={isBusy}
                    activeOpacity={0.85}
                  >
                    {isBusy ? (
                      <ActivityIndicator color="#0a0a0a" size="small" />
                    ) : (
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : sk === 'accepted' ? (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.workspaceBtn]}
                    onPress={() => openWorkspace(item)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.workspaceBtnText}>Open workspace</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          )
        }}
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
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 14 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111',
  },
  filterChipActive: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  filterChipText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  filterChipTextActive: { color: '#0a0a0a', fontWeight: '800' },
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
  footer: { marginTop: 8, flexDirection: 'row' },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillPending: { backgroundColor: 'rgba(255,220,0,0.1)', borderColor: 'rgba(255,220,0,0.3)' },
  statusPillAccepted: { backgroundColor: 'rgba(40,205,65,0.12)', borderColor: 'rgba(40,205,65,0.3)' },
  statusPillDeclined: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.16)' },
  statusPillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  statusPillTextPending: { color: '#FFDC00' },
  statusPillTextAccepted: { color: '#5fe07a' },
  statusPillTextDeclined: { color: 'rgba(255,255,255,0.5)' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDisabled: { opacity: 0.6 },
  acceptBtn: { backgroundColor: '#FFDC00' },
  acceptBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  declineBtn: { borderWidth: 1, borderColor: 'rgba(255,120,120,0.4)', backgroundColor: 'rgba(255,80,80,0.06)' },
  declineBtnText: { color: '#ff8e8e', fontWeight: '800', fontSize: 14 },
  workspaceBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  workspaceBtnText: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 14 },
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

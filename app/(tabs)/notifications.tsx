import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '@/lib/supabase'
import {
  fetchAlertReadKeys,
  loadNotificationFeed,
  markAlertRead,
  type NotificationRow,
} from '@/lib/notificationsFeed'
import { respondToCrewInvite } from '@/lib/crewInvites'
import { readCachedNotifications, cacheNotifications } from '@/lib/notificationsCache'
import { invalidateAlertsBadge, subscribeAlertsLivePatch } from '@/lib/invalidateAlerts'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { runTimed } from '@/lib/perfMarks'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'
import { TabScreenHeader } from '@/components/TabScreenHeader'
import { resolveAppRole } from '@/lib/profileRole'
import { formatTimeAgo } from '@/lib/formatTimeAgo'

const TIME_AGO_TICK_MS = 30_000

/** Unique Supabase Realtime topic — reusing the same name returns an already-subscribed channel. */
let alertsRealtimeTopicSeq = 0

function readInitialNotifications(): {
  rows: NotificationRow[]
  readKeys: Set<string>
  loading: boolean
} {
  const uid = peekWarmedOverview()?.userId
  if (!uid) return { rows: [], readKeys: new Set(), loading: true }
  const cached = readCachedNotifications(uid)
  if (!cached) return { rows: [], readKeys: new Set(), loading: true }
  return { rows: cached.rows, readKeys: new Set(cached.reads), loading: false }
}

export default function NotificationsScreen() {
  const router = useRouter()
  const boot = useRef(readInitialNotifications()).current
  const [rows, setRows] = useState<NotificationRow[]>(boot.rows)
  const [readKeys, setReadKeys] = useState<Set<string>>(boot.readKeys)
  const [loading, setLoading] = useState(boot.loading)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [showMessages, setShowMessages] = useState(true)
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadInFlight = useRef<Promise<void> | null>(null)
  const needsReloadAfter = useRef(false)
  const initialDone = useRef(!boot.loading)
  const userIdRef = useRef<string | null>(null)
  userIdRef.current = userId

  const load = useCallback(async (_opts?: { silent?: boolean }) => {
    if (loadInFlight.current) {
      needsReloadAfter.current = true
      return loadInFlight.current
    }
    loadInFlight.current = (async () => {
      try {
        const timed = await runTimed('notifications.load', async () => {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (!user) {
            setRows([])
            setReadKeys(new Set())
            setUserId(null)
            return
          }
          setUserId(user.id)
          const { data: profile } = await supabase
            .from('profiles')
            .select('role, subscription_tier')
            .eq('id', user.id)
            .maybeSingle()
          const role = resolveAppRole(profile?.role, user)
          setShowMessages(true)
          const cached = readCachedNotifications(user.id)
          if (!initialDone.current && cached) {
            setRows(cached.rows)
            setReadKeys(new Set(cached.reads))
            setLoading(false)
            initialDone.current = true
          }
          const [feed, reads] = await Promise.all([
            loadNotificationFeed(user.id),
            fetchAlertReadKeys(user.id),
          ])
          setRows(feed)
          setReadKeys(reads)
          cacheNotifications(user.id, { rows: feed, reads: Array.from(reads) })
          return { feed: feed.length, reads: reads.size }
        })
        if (__DEV__ && timed.value) {
          console.log(`[perf] notifications.rows: feed=${timed.value.feed} reads=${timed.value.reads}`)
        }
      } finally {
        initialDone.current = true
        setLoading(false)
      }
    })()
    try {
      await loadInFlight.current
    } finally {
      loadInFlight.current = null
      if (needsReloadAfter.current) {
        needsReloadAfter.current = false
        void load()
      }
    }
  }, [])

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => {
      void load({ silent: true })
      reloadTimer.current = null
    }, 280)
  }, [load])

  const scheduleReloadRef = useRef(scheduleReload)
  scheduleReloadRef.current = scheduleReload

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange(() => void load())
    return () => sub.data.subscription.unsubscribe()
  }, [load])

  useEffect(() => {
    return subscribeAlertsLivePatch((patch) => {
      const uid = userIdRef.current
      if (uid && patch.userId !== uid) return
      if (!uid) setUserId(patch.userId)
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === patch.row.id)
        if (idx === -1) return [patch.row, ...prev]
        if (prev[idx] === patch.row) return prev
        const next = prev.slice()
        next[idx] = patch.row
        return next
      })
    })
  }, [])

  useFocusEffect(
    useCallback(() => {
      setNowTick(Date.now())
      const tickId = setInterval(() => setNowTick(Date.now()), TIME_AGO_TICK_MS)
      // Always silent-refresh on focus so Alerts stay live (no 30s stale skip).
      void load({ silent: true }).finally(() => invalidateAlertsBadge())
      return () => clearInterval(tickId)
    }, [load])
  )

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return
      const topic = `alerts-feed-refresh-${user?.id ?? 'anon'}-${++alertsRealtimeTopicSeq}`
      const onChange = () => scheduleReloadRef.current()
      channel = supabase
        .channel(topic)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_messages' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'job_applications' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_crew_invites' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_milestones' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_alert_reads' }, onChange)
        .subscribe()
    })()

    return () => {
      cancelled = true
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const emptyText = useMemo(() => 'No alerts yet.', [])

  const respondInvite = useCallback(
    async (item: NotificationRow, action: 'accept' | 'decline') => {
      const inviteId = item.targetId
      if (!inviteId || busyInviteId) return
      setBusyInviteId(item.id)
      const res = await respondToCrewInvite(inviteId, action)
      setBusyInviteId(null)
      if (!res.ok) {
        Alert.alert('Could not respond', res.error ?? 'Please try again.')
        return
      }
      // Optimistically drop the invite row, then revalidate the feed.
      setRows((prev) => prev.filter((r) => r.id !== item.id))
      void load()
      invalidateAlertsBadge()
      if (action === 'accept' && item.projectId) {
        router.push(`/project/${item.projectId}`)
      }
    },
    [busyInviteId, load, router]
  )

  const onPressRow = useCallback(
    async (item: NotificationRow) => {
      // Crew invitations are actioned via the inline Accept/Decline buttons and
      // reference a project the user cannot open yet — don't navigate.
      if (item.kind === 'crew_invite') return
      if (userId) {
        await markAlertRead(userId, item.id)
        let nextReadKeys: Set<string> = new Set()
        setReadKeys((prev) => {
          nextReadKeys = new Set(prev)
          nextReadKeys.add(item.id)
          return nextReadKeys
        })
        cacheNotifications(userId, {
          rows,
          reads: Array.from(nextReadKeys),
        })
        invalidateAlertsBadge()
      }
      if (item.kind === 'invoice_incoming' || item.kind === 'invoice_freelancer') {
        if (item.targetId) router.push(`/(tabs)/invoices/${item.targetId}`)
        return
      }
      if (item.kind === 'job_application') {
        router.push('/(tabs)/company-applications')
        return
      }
      if (item.kind === 'workspace_ready' && item.projectId) {
        router.push(`/project/${item.projectId}`)
        return
      }
      if (item.projectId) router.push(`/project/${item.projectId}`)
    },
    [router, userId, rows]
  )

  const showInitialSkeleton = loading && rows.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TabScreenHeader title="Alerts" showMessages={showMessages} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        initialNumToRender={14}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFDC00" />}
        renderItem={({ item }) => {
          const unread = !readKeys.has(item.id)
          const isInviteAction = item.kind === 'crew_invite'
          const inviteBusy = busyInviteId === item.id
          return (
            <TouchableOpacity
              style={[styles.card, unread && styles.cardUnread]}
              activeOpacity={isInviteAction ? 1 : 0.85}
              onPress={() => void onPressRow(item)}
            >
              <View style={styles.kickerRow}>
                <Text style={styles.kicker}>
                  {item.kind === 'invite' || item.kind === 'crew_invite'
                    ? 'Invitation'
                    : item.kind === 'project_message'
                      ? 'Project chat'
                      : item.kind === 'project_completed'
                        ? 'Completed'
                        : item.kind === 'job_application'
                          ? 'Application'
                          : item.kind === 'invoice_incoming' || item.kind === 'invoice_freelancer'
                            ? 'Invoice'
                            : item.kind === 'workspace_ready'
                              ? 'Workspace'
                              : 'Project'}
                </Text>
                <Text style={styles.time}>{formatTimeAgo(item.at, nowTick)}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              {isInviteAction ? (
                <View style={styles.inviteActions}>
                  <TouchableOpacity
                    style={[styles.inviteBtn, styles.inviteDecline, inviteBusy && styles.inviteDim]}
                    onPress={() => void respondInvite(item, 'decline')}
                    disabled={inviteBusy}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.inviteDeclineText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inviteBtn, styles.inviteAccept, inviteBusy && styles.inviteDim]}
                    onPress={() => void respondInvite(item, 'accept')}
                    disabled={inviteBusy}
                    activeOpacity={0.85}
                  >
                    {inviteBusy ? (
                      <ActivityIndicator color="#0a0a0a" size="small" />
                    ) : (
                      <Text style={styles.inviteAcceptText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          showInitialSkeleton ? (
            <ScreenListSkeleton rows={6} />
          ) : (
            <View style={styles.center}>
              <Text style={styles.empty}>{emptyText}</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { paddingHorizontal: 20, paddingBottom: 36, flexGrow: 1, paddingTop: 4 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    padding: 12,
    marginBottom: 10,
  },
  cardUnread: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,220,0,0.15)',
  },
  kickerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  kicker: { color: '#FFDC00', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  time: { color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  body: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 17 },
  inviteActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  inviteBtn: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  inviteDim: { opacity: 0.6 },
  inviteAccept: { backgroundColor: '#FFDC00' },
  inviteAcceptText: { color: '#0a0a0a', fontWeight: '800', fontSize: 13 },
  inviteDecline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  inviteDeclineText: { color: 'rgba(255,255,255,0.8)', fontWeight: '700', fontSize: 13 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
})

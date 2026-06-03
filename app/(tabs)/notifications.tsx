import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { readCachedNotifications, cacheNotifications } from '@/lib/notificationsCache'
import { invalidateAlertsBadge } from '@/lib/invalidateAlerts'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { runTimed } from '@/lib/perfMarks'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'
import { TabScreenHeader } from '@/components/TabScreenHeader'
import { resolveAppRole } from '@/lib/profileRole'

function timeAgo(str: string) {
  const t = new Date(str).getTime()
  if (Number.isNaN(t)) return 'now'
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const ALERTS_STALE_MS = 30_000

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
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadInFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef(boot.loading ? 0 : Date.now())
  const initialDone = useRef(!boot.loading)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (loadInFlight.current) return loadInFlight.current
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
          lastFetchedAt.current = Date.now()
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
    }
  }, [])

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => {
      void load()
      reloadTimer.current = null
    }, 280)
  }, [load])

  const scheduleReloadRef = useRef(scheduleReload)
  scheduleReloadRef.current = scheduleReload

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange(() => void load())
    return () => sub.data.subscription.unsubscribe()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      if (!initialDone.current) {
        void load().finally(() => invalidateAlertsBadge())
        return
      }
      if (lastFetchedAt.current > 0 && Date.now() - lastFetchedAt.current < ALERTS_STALE_MS) {
        invalidateAlertsBadge()
        return
      }
      void load({ silent: true }).finally(() => invalidateAlertsBadge())
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

  const onPressRow = useCallback(
    async (item: NotificationRow) => {
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
    [router, userId]
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
          return (
            <TouchableOpacity
              style={[styles.card, unread && styles.cardUnread]}
              activeOpacity={0.85}
              onPress={() => void onPressRow(item)}
            >
              <View style={styles.kickerRow}>
                <Text style={styles.kicker}>
                  {item.kind === 'invite'
                    ? 'Invitation'
                    : item.kind === 'project_message'
                      ? 'Project chat'
                      : item.kind === 'job_application'
                        ? 'Application'
                        : item.kind === 'invoice_incoming' || item.kind === 'invoice_freelancer'
                          ? 'Invoice'
                          : item.kind === 'workspace_ready'
                            ? 'Workspace'
                            : 'Project'}
                </Text>
                <Text style={styles.time}>{timeAgo(item.at)}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
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
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
})

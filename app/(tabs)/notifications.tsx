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
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { authUserIdKey, notificationsKey } from '@/lib/queryKeys'
import {
  fetchAlertReadKeys,
  loadNotificationFeed,
  markAlertRead,
  type NotificationRow,
} from '@/lib/notificationsFeed'
import { respondToCrewInvite } from '@/lib/crewInvites'
import {
  cacheNotifications,
  hydrateNotificationsFromDisk,
  persistNotificationsToDisk,
  readCachedNotifications,
  type NotificationsCache,
} from '@/lib/notificationsCache'
import { invalidateAlertsBadge, subscribeAlertsLivePatch } from '@/lib/invalidateAlerts'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'
import { TabScreenHeader } from '@/components/TabScreenHeader'
import { formatTimeAgo } from '@/lib/formatTimeAgo'
import { applyMilestoneInsertAlert } from '@/lib/alertsLivePatch'
import { LIST_STALE_MS } from '@/lib/cachePolicy'

const TIME_AGO_TICK_MS = 30_000

/** Unique Supabase Realtime topic — reusing the same name returns an already-subscribed channel. */
let alertsRealtimeTopicSeq = 0

export default function NotificationsScreen() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const authQuery = useQuery({
    queryKey: authUserIdKey,
    queryFn: async () => {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    },
    staleTime: 5 * 60_000,
    initialData: () => peekWarmedOverview()?.userId ?? undefined,
  })
  const userId = authQuery.data ?? null
  const enabled = Boolean(userId)

  const cachedBoot = userId ? readCachedNotifications(userId) : null

  const alertsQuery = useQuery({
    queryKey: notificationsKey(userId),
    enabled,
    staleTime: LIST_STALE_MS,
    placeholderData: (prev) => prev,
    initialData: (): NotificationsCache | undefined => cachedBoot ?? undefined,
    // Fresh enough to paint instantly; background refetch after LIST_STALE_MS / focus.
    initialDataUpdatedAt: cachedBoot ? Date.now() : undefined,
    queryFn: async (): Promise<NotificationsCache> => {
      const uid = userId as string
      const [feed, reads] = await Promise.all([loadNotificationFeed(uid), fetchAlertReadKeys(uid)])
      const data: NotificationsCache = { rows: feed, reads: Array.from(reads) }
      cacheNotifications(uid, data)
      void persistNotificationsToDisk(uid, data)
      return data
    },
  })

  // If mem cache missed (TTL), pull disk into QueryClient before network returns.
  useEffect(() => {
    if (!userId) return
    if (alertsQuery.data?.rows?.length) return
    let cancelled = false
    void hydrateNotificationsFromDisk(userId).then((ok) => {
      if (cancelled || !ok) return
      const hit = readCachedNotifications(userId)
      if (hit && !queryClient.getQueryData(notificationsKey(userId))) {
        queryClient.setQueryData(notificationsKey(userId), hit)
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId, alertsQuery.data?.rows?.length])

  const rows = alertsQuery.data?.rows ?? []
  const readKeys = useMemo(() => new Set(alertsQuery.data?.reads ?? []), [alertsQuery.data?.reads])
  const loading = authQuery.isLoading || (enabled && alertsQuery.isLoading && rows.length === 0)

  const scheduleInvalidate = useCallback(() => {
    if (!userId) return
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) })
      reloadTimer.current = null
    }, 320)
  }, [userId])

  // Live row patches from badge bridge (project messages) + local milestone inserts.
  useEffect(() => {
    return subscribeAlertsLivePatch((patch) => {
      if (userId && patch.userId !== userId) return
      queryClient.setQueryData<NotificationsCache>(notificationsKey(patch.userId), (prev) => {
        const base = prev ?? readCachedNotifications(patch.userId) ?? { rows: [], reads: [] }
        const idx = base.rows.findIndex((r) => r.id === patch.row.id)
        let nextRows: NotificationRow[]
        if (idx === -1) nextRows = [patch.row, ...base.rows]
        else {
          nextRows = base.rows.slice()
          nextRows[idx] = patch.row
        }
        const next = { rows: nextRows, reads: base.reads }
        cacheNotifications(patch.userId, next)
        return next
      })
    })
  }, [userId])

  useFocusEffect(
    useCallback(() => {
      setNowTick(Date.now())
      const tickId = setInterval(() => setNowTick(Date.now()), TIME_AGO_TICK_MS)
      invalidateAlertsBadge()
      if (userId) {
        void queryClient.refetchQueries({ queryKey: notificationsKey(userId), stale: true })
      }
      return () => clearInterval(tickId)
    }, [userId])
  )

  useEffect(() => {
    if (!userId) return
    const topic = `alerts-feed-refresh-${userId}-${++alertsRealtimeTopicSeq}`
    const onSoftChange = () => scheduleInvalidate()
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onSoftChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, onSoftChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_messages' }, onSoftChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_messages' }, onSoftChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'project_messages' }, onSoftChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_applications' }, onSoftChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, onSoftChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, onSoftChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_crew_invites' }, onSoftChange)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_milestones' },
        (payload) => {
          applyMilestoneInsertAlert(userId, (payload.new ?? {}) as Record<string, unknown>)
          scheduleInvalidate()
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_milestones' }, onSoftChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, onSoftChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_alert_reads' }, onSoftChange)
      .subscribe()

    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [userId, scheduleInvalidate])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await alertsQuery.refetch()
    } finally {
      setRefreshing(false)
    }
  }, [alertsQuery])

  const emptyText = useMemo(() => 'No alerts yet.', [])

  const respondInvite = useCallback(
    async (item: NotificationRow, action: 'accept' | 'decline') => {
      const inviteId = item.targetId
      if (!inviteId || busyInviteId || !userId) return
      setBusyInviteId(item.id)
      const res = await respondToCrewInvite(inviteId, action)
      setBusyInviteId(null)
      if (!res.ok) {
        Alert.alert('Could not respond', res.error ?? 'Please try again.')
        return
      }
      queryClient.setQueryData<NotificationsCache>(notificationsKey(userId), (prev) => {
        if (!prev) return prev
        const next = { ...prev, rows: prev.rows.filter((r) => r.id !== item.id) }
        cacheNotifications(userId, next)
        return next
      })
      void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) })
      invalidateAlertsBadge()
      if (action === 'accept' && item.projectId) {
        router.push(`/project/${item.projectId}`)
      }
    },
    [busyInviteId, router, userId]
  )

  const onPressRow = useCallback(
    async (item: NotificationRow) => {
      if (item.kind === 'crew_invite') return
      if (userId) {
        await markAlertRead(userId, item.id)
        queryClient.setQueryData<NotificationsCache>(notificationsKey(userId), (prev) => {
          const base = prev ?? { rows, reads: Array.from(readKeys) }
          if (base.reads.includes(item.id)) return base
          const next = { ...base, reads: [...base.reads, item.id] }
          cacheNotifications(userId, next)
          void persistNotificationsToDisk(userId, next)
          return next
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
    [router, userId, rows, readKeys]
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TabScreenHeader title="Alerts" showMessages />
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
          loading ? (
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

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '@/lib/supabase'
import { loadDirectMessageInbox, type ConvoRow } from '@/lib/messagesInboxLoad'
import { readCachedMessages, cacheMessages } from '@/lib/messagesCache'
import { invalidateDmBadge } from '@/lib/invalidateDmBadge'
import { deleteCache } from '@/lib/appCache'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { runTimed } from '@/lib/perfMarks'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'

const MESSAGES_STALE_MS = 30_000

/** Unique Supabase Realtime topic — reusing the same name returns an already-subscribed channel. */
let messagesRealtimeTopicSeq = 0

function readInitialMessages(): { inbox: ConvoRow[]; archived: ConvoRow[]; loading: boolean } {
  const uid = peekWarmedOverview()?.userId
  if (!uid) return { inbox: [], archived: [], loading: true }
  const cached = readCachedMessages(uid)
  if (!cached) return { inbox: [], archived: [], loading: true }
  return { inbox: cached.inbox, archived: cached.archived, loading: false }
}

export default function MessagesScreen() {
  const router = useRouter()
  const boot = useRef(readInitialMessages()).current
  const [convos, setConvos] = useState<ConvoRow[]>(boot.inbox)
  const [loading, setLoading] = useState(boot.loading)
  const [refreshing, setRefreshing] = useState(false)
  const [signedIn, setSignedIn] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [archived, setArchived] = useState<ConvoRow[]>(boot.archived)
  const [showArchived, setShowArchived] = useState(false)

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const initialLoadingDone = useRef(!boot.loading)
  const lastFetchedAt = useRef(boot.loading ? 0 : Date.now())

  const refreshList = useCallback(async (opts?: { silent?: boolean }) => {
    if (refreshInFlight.current) return refreshInFlight.current
    refreshInFlight.current = (async () => {
      try {
        const timed = await runTimed('messages.refreshList', async () => {
        setLoadError(null)
        const { data: auth } = await supabase.auth.getUser()
        const user = auth.user
        if (!user) {
          setSignedIn(false)
          setConvos([])
          setArchived([])
          return
        }
        setSignedIn(true)
        const cached = readCachedMessages(user.id)
        if (!initialLoadingDone.current && cached) {
          setConvos(cached.inbox)
          setArchived(cached.archived)
          setLoading(false)
          initialLoadingDone.current = true
        }

        const result = await loadDirectMessageInbox(user.id)
        if (result.ok === false) {
          setLoadError(result.error)
          setConvos([])
          setArchived([])
          return
        }
        setLoadError(null)
        setConvos(result.inbox)
        setArchived(result.archived)
        cacheMessages(user.id, { inbox: result.inbox, archived: result.archived })
        lastFetchedAt.current = Date.now()
        return { inbox: result.inbox.length, archived: result.archived.length }
        })
        if (__DEV__ && timed.value) {
          console.log(
            `[perf] messages.rows: inbox=${timed.value.inbox} archived=${timed.value.archived}`
          )
        }
      } finally {
        if (!initialLoadingDone.current) {
          initialLoadingDone.current = true
          setLoading(false)
        }
      }
    })()
    try {
      await refreshInFlight.current
    } finally {
      refreshInFlight.current = null
    }
  }, [])

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => void refreshList(), 320)
  }, [refreshList])

  const scheduleReloadRef = useRef(scheduleReload)
  scheduleReloadRef.current = scheduleReload

  useFocusEffect(
    useCallback(() => {
      if (!initialLoadingDone.current) {
        void refreshList()
        invalidateDmBadge()
        return () => {
          if (reloadTimer.current) clearTimeout(reloadTimer.current)
        }
      }
      if (lastFetchedAt.current > 0 && Date.now() - lastFetchedAt.current < MESSAGES_STALE_MS) {
        invalidateDmBadge()
        return () => {
          if (reloadTimer.current) clearTimeout(reloadTimer.current)
        }
      }
      void refreshList({ silent: true })
      invalidateDmBadge()
      return () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current)
      }
    }, [refreshList])
  )

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return
      const topic = `messages-list-${user?.id ?? 'anon'}-${++messagesRealtimeTopicSeq}`
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'conversations' },
          () => scheduleReloadRef.current()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'messages' },
          () => scheduleReloadRef.current()
        )
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
      await refreshList()
    } finally {
      setRefreshing(false)
    }
  }, [refreshList])

  const archiveConversation = useCallback(async (conversationId: string, nextArchived: boolean) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) return
    const payload = {
      user_id: user.id,
      conversation_id: conversationId,
      archived: nextArchived,
      archived_at: nextArchived ? new Date().toISOString() : null,
    }
    const { error } = await supabase.from('conversation_archives').upsert(payload, {
      onConflict: 'user_id,conversation_id',
    })
    if (error) {
      Alert.alert('Could not update', error.message)
      return
    }
    deleteCache(`messages:${user.id}`)
    await refreshList()
  }, [refreshList])

  const deleteConversation = useCallback(async (conversationId: string) => {
    Alert.alert('Delete conversation', 'Delete all messages in this conversation?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { data: auth } = await supabase.auth.getUser()
          const user = auth.user
          if (user) deleteCache(`messages:${user.id}`)
          const { error } = await supabase.from('messages').delete().eq('conversation_id', conversationId)
          if (error) {
            Alert.alert('Could not delete', error.message)
            return
          }
          await archiveConversation(conversationId, true)
        },
      },
    ])
  }, [archiveConversation, refreshList])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.title}>Messages</Text>
        <ScreenListSkeleton rows={6} />
      </SafeAreaView>
    )
  }

  if (!signedIn) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.title}>Messages</Text>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Sign in to see your messages.</Text>
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.push('/login')} activeOpacity={0.85}>
            <Text style={styles.loginBtnText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Messages</Text>
      <View style={styles.topActions}>
        <TouchableOpacity
          style={styles.archivedToggle}
          onPress={() => setShowArchived((v) => !v)}
        >
          <Text style={styles.archivedToggleText}>
            {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
          </Text>
        </TouchableOpacity>
      </View>
      {loadError ? (
        <Text style={styles.errorBanner}>{loadError}</Text>
      ) : null}
      <FlatList
        data={convos}
        keyExtractor={(c) => c.id}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={8}
        removeClippedSubviews
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFDC00" />}
        renderItem={({ item }) => (
          <Swipeable
            friction={1.2}
            rightThreshold={28}
            overshootRight={false}
            renderRightActions={(progress) => (
              <Animated.View
                style={[
                  styles.swipeActions,
                  {
                    opacity: progress.interpolate({
                      inputRange: [0, 0.12, 1],
                      outputRange: [0, 0.5, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        translateX: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [46, 0],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              >
                <TouchableOpacity style={styles.archiveAction} onPress={() => void archiveConversation(item.id, true)}>
                  <Text style={styles.swipeActionText}>Archive</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteAction} onPress={() => deleteConversation(item.id)}>
                  <Text style={styles.swipeActionText}>Delete</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          >
            <TouchableOpacity
              style={[styles.card, item.unread && styles.cardUnread]}
              activeOpacity={0.7}
              onPress={() => router.push(`/conversation/${item.id}`)}
            >
              <View style={styles.avatarWrap}>
                {item.avatar ? (
                  <Image source={{ uri: item.avatar }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarLetter}>{item.name.charAt(0).toUpperCase() || '?'}</Text>
                  </View>
                )}
                {item.unread ? <View style={styles.dot} /> : null}
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={[styles.name, item.unread && styles.nameUnread]}>{item.name}</Text>
                  <Text style={styles.time}>{item.time}</Text>
                </View>
                <Text style={styles.preview} numberOfLines={1}>
                  {item.lastMessage}
                </Text>
              </View>
            </TouchableOpacity>
          </Swipeable>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No conversations yet.</Text>
            <Text style={styles.emptySub}>Start a chat from a profile or job.</Text>
          </View>
        }
      />
      {showArchived ? (
        <View style={styles.archivedSection}>
          <Text style={styles.archivedTitle}>Archived</Text>
          <FlatList
            data={archived}
            keyExtractor={(c) => `arch-${c.id}`}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={6}
            removeClippedSubviews
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Swipeable
                friction={1.2}
                rightThreshold={28}
                overshootRight={false}
                renderRightActions={(progress) => (
                  <Animated.View
                    style={[
                      styles.swipeActions,
                      {
                        opacity: progress.interpolate({
                          inputRange: [0, 0.12, 1],
                          outputRange: [0, 0.5, 1],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            translateX: progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [46, 0],
                              extrapolate: 'clamp',
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <TouchableOpacity style={styles.archiveAction} onPress={() => void archiveConversation(item.id, false)}>
                      <Text style={styles.swipeActionText}>Unarchive</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteAction} onPress={() => deleteConversation(item.id)}>
                      <Text style={styles.swipeActionText}>Delete</Text>
                    </TouchableOpacity>
                  </Animated.View>
                )}
              >
                <TouchableOpacity
                  style={styles.card}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/conversation/${item.id}`)}
                >
                  <View style={styles.avatarWrap}>
                    {item.avatar ? (
                      <Image source={{ uri: item.avatar }} style={styles.avatar} />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarLetter}>{item.name.charAt(0).toUpperCase() || '?'}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <Text style={styles.name}>{item.name}</Text>
                      <Text style={styles.time}>{item.time}</Text>
                    </View>
                    <Text style={styles.preview} numberOfLines={1}>
                      {item.lastMessage}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Swipeable>
            )}
            ListEmptyComponent={<Text style={styles.emptySub}>No archived conversations.</Text>}
          />
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', marginTop: 24, paddingHorizontal: 24 },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  topActions: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  archivedToggle: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#111',
  },
  archivedToggleText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    fontSize: 13,
    color: 'rgba(255,180,180,0.9)',
  },
  list: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  cardUnread: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { color: '#FFDC00', fontSize: 18, fontWeight: '700' },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFDC00',
    borderWidth: 2,
    borderColor: '#0a0a0a',
  },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  name: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  nameUnread: { color: '#ffffff', fontWeight: '700' },
  time: { fontSize: 11, color: 'rgba(255,255,255,0.25)' },
  preview: { fontSize: 13, color: 'rgba(255,255,255,0.3)' },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    marginTop: 10,
    marginBottom: 10,
  },
  archiveAction: {
    backgroundColor: '#3a3a3a',
    justifyContent: 'center',
    alignItems: 'center',
    width: 78,
    height: '100%',
    borderRadius: 10,
    marginRight: 6,
  },
  deleteAction: {
    backgroundColor: '#b91c1c',
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    height: '100%',
    borderRadius: 10,
  },
  swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  archivedSection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 8 },
  archivedTitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', paddingHorizontal: 20, marginBottom: 6 },
  emptyText: { color: 'rgba(255,255,255,0.45)', fontSize: 15, textAlign: 'center' },
  emptySub: { color: 'rgba(255,255,255,0.28)', fontSize: 13, marginTop: 8, textAlign: 'center' },
  loginBtn: {
    marginTop: 20,
    backgroundColor: '#FFDC00',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  loginBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 15 },
})

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
import { useFloatingTabBarBottomInset } from '@/lib/floatingTabBarLayout'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { loadDirectMessageInbox, type ConvoRow } from '@/lib/messagesInboxLoad'
import {
  cacheMessages,
  hydrateMessagesFromDisk,
  messagesCacheKey,
  persistMessagesToDisk,
  readCachedMessages,
} from '@/lib/messagesCache'
import { invalidateDmBadge } from '@/lib/invalidateDmBadge'
import { deleteCache } from '@/lib/appCache'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'
import { messagesKey } from '@/lib/queryKeys'
import { prefetchConversation } from '@/lib/conversationCache'
import { LIST_STALE_MS } from '@/lib/cachePolicy'

/** Unique Supabase Realtime topic — reusing the same name returns an already-subscribed channel. */
let messagesRealtimeTopicSeq = 0

type MessagesData = { inbox: ConvoRow[]; archived: ConvoRow[] }

/** Move one conversation between inbox/archived lists (optimistic archive/unarchive). */
function moveConversation(
  data: MessagesData,
  conversationId: string,
  toArchived: boolean,
): MessagesData {
  const item = toArchived
    ? data.inbox.find((c) => c.id === conversationId)
    : data.archived.find((c) => c.id === conversationId)
  if (!item) return data
  if (toArchived) {
    return {
      inbox: data.inbox.filter((c) => c.id !== conversationId),
      archived: [item, ...data.archived],
    }
  }
  return {
    inbox: [item, ...data.inbox],
    archived: data.archived.filter((c) => c.id !== conversationId),
  }
}

/** Drop a conversation from both lists (optimistic delete). */
function removeConversation(data: MessagesData, conversationId: string): MessagesData {
  return {
    inbox: data.inbox.filter((c) => c.id !== conversationId),
    archived: data.archived.filter((c) => c.id !== conversationId),
  }
}

export default function MessagesScreen() {
  const router = useRouter()
  const tabBarInset = useFloatingTabBarBottomInset()
  const [showArchived, setShowArchived] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auth user id — seeded synchronously from the warm bootstrap cache for instant paint.
  const authQuery = useQuery({
    queryKey: ['authUserId'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    },
    staleTime: 5 * 60_000,
    initialData: () => peekWarmedOverview()?.userId ?? undefined,
  })
  const userId = authQuery.data ?? null
  const enabled = Boolean(userId)

  const cachedBoot = userId ? readCachedMessages(userId) : null

  const inboxQuery = useQuery({
    queryKey: messagesKey(userId),
    enabled,
    staleTime: LIST_STALE_MS,
    placeholderData: (prev) => prev,
    initialData: (): MessagesData | undefined => cachedBoot ?? undefined,
    initialDataUpdatedAt: cachedBoot ? Date.now() : undefined,
    queryFn: async (): Promise<MessagesData> => {
      const result = await loadDirectMessageInbox(userId as string)
      if (result.ok === false) throw new Error(result.error)
      const data: MessagesData = { inbox: result.inbox, archived: result.archived }
      cacheMessages(userId as string, data)
      void persistMessagesToDisk(userId as string, data)
      return data
    },
  })

  useEffect(() => {
    if (!userId) return
    if ((inboxQuery.data?.inbox.length ?? 0) + (inboxQuery.data?.archived.length ?? 0) > 0) return
    let cancelled = false
    void hydrateMessagesFromDisk(userId).then((ok) => {
      if (cancelled || !ok) return
      const hit = readCachedMessages(userId)
      if (hit && !queryClient.getQueryData(messagesKey(userId))) {
        queryClient.setQueryData(messagesKey(userId), hit)
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId, inboxQuery.data?.inbox.length, inboxQuery.data?.archived.length])

  const convos = inboxQuery.data?.inbox ?? []
  const archived = inboxQuery.data?.archived ?? []
  const loadError = inboxQuery.error ? (inboxQuery.error as Error).message : null
  const loading =
    authQuery.isLoading ||
    (enabled && inboxQuery.isLoading && convos.length === 0 && archived.length === 0)
  const signedIn = !(authQuery.isSuccess && userId === null)

  // Live updates: a DB change marks the inbox stale and refetches (debounced to avoid storms).
  useEffect(() => {
    if (!userId) return
    const topic = `messages-list-${userId}-${++messagesRealtimeTopicSeq}`
    const schedule = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: messagesKey(userId) })
      }, 320)
    }
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, schedule)
      .subscribe()
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [userId])

  // Refresh the tab badge on focus, and revalidate the inbox only if it has gone stale.
  useFocusEffect(
    useCallback(() => {
      invalidateDmBadge()
      if (userId) {
        void queryClient.refetchQueries({ queryKey: messagesKey(userId), stale: true })
      }
    }, [userId]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await inboxQuery.refetch()
    } finally {
      setRefreshing(false)
    }
  }, [inboxQuery])

  const archiveMutation = useMutation({
    mutationFn: async ({
      conversationId,
      nextArchived,
    }: {
      conversationId: string
      nextArchived: boolean
    }) => {
      if (!userId) throw new Error('Not signed in')
      const { error } = await supabase.from('conversation_archives').upsert(
        {
          user_id: userId,
          conversation_id: conversationId,
          archived: nextArchived,
          archived_at: nextArchived ? new Date().toISOString() : null,
        },
        { onConflict: 'user_id,conversation_id' },
      )
      if (error) throw new Error(error.message)
    },
    onMutate: async ({ conversationId, nextArchived }) => {
      await queryClient.cancelQueries({ queryKey: messagesKey(userId) })
      const prev = queryClient.getQueryData<MessagesData>(messagesKey(userId))
      if (prev) {
        queryClient.setQueryData(
          messagesKey(userId),
          moveConversation(prev, conversationId, nextArchived),
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(messagesKey(userId), ctx.prev)
      Alert.alert('Could not update', 'Please try again.')
    },
    onSettled: () => {
      if (userId) deleteCache(messagesCacheKey(userId))
      void queryClient.invalidateQueries({ queryKey: messagesKey(userId) })
      invalidateDmBadge()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string }) => {
      if (!userId) throw new Error('Not signed in')
      const { error: delErr } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId)
      if (delErr) throw new Error(delErr.message)
      const { error: archErr } = await supabase.from('conversation_archives').upsert(
        {
          user_id: userId,
          conversation_id: conversationId,
          archived: true,
          archived_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,conversation_id' },
      )
      if (archErr) throw new Error(archErr.message)
    },
    onMutate: async ({ conversationId }) => {
      await queryClient.cancelQueries({ queryKey: messagesKey(userId) })
      const prev = queryClient.getQueryData<MessagesData>(messagesKey(userId))
      if (prev) {
        queryClient.setQueryData(messagesKey(userId), removeConversation(prev, conversationId))
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(messagesKey(userId), ctx.prev)
      Alert.alert('Could not delete', 'Please try again.')
    },
    onSettled: () => {
      if (userId) deleteCache(messagesCacheKey(userId))
      void queryClient.invalidateQueries({ queryKey: messagesKey(userId) })
      invalidateDmBadge()
    },
  })

  const archiveConversation = useCallback(
    (conversationId: string, nextArchived: boolean) => {
      archiveMutation.mutate({ conversationId, nextArchived })
    },
    [archiveMutation],
  )

  const deleteConversation = useCallback(
    (conversationId: string) => {
      Alert.alert('Delete conversation', 'Delete all messages in this conversation?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate({ conversationId }),
        },
      ])
    },
    [deleteMutation],
  )

  const renderRow = useCallback(
    (item: ConvoRow, isArchived: boolean) => (
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
            <TouchableOpacity
              style={styles.archiveAction}
              onPress={() => void archiveConversation(item.id, !isArchived)}
            >
              <Text style={styles.swipeActionText}>{isArchived ? 'Unarchive' : 'Archive'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteAction} onPress={() => deleteConversation(item.id)}>
              <Text style={styles.swipeActionText}>Delete</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      >
        <TouchableOpacity
          style={[styles.card, !isArchived && item.unread && styles.cardUnread]}
          activeOpacity={0.7}
          onPressIn={() => {
            if (userId) prefetchConversation(item.id, userId)
          }}
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
            {!isArchived && item.unread ? <View style={styles.dot} /> : null}
          </View>
          <View style={styles.cardBody}>
            <View style={styles.cardTop}>
              <Text style={[styles.name, !isArchived && item.unread && styles.nameUnread]}>{item.name}</Text>
              <Text style={styles.time}>{item.time}</Text>
            </View>
            <Text style={styles.preview} numberOfLines={1}>
              {item.lastMessage}
            </Text>
          </View>
        </TouchableOpacity>
      </Swipeable>
    ),
    [archiveConversation, deleteConversation, router, userId],
  )

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
        contentContainerStyle={[styles.list, { paddingBottom: tabBarInset + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFDC00" />}
        renderItem={({ item }) => renderRow(item, false)}
        ListEmptyComponent={
          <View style={showArchived && archived.length > 0 ? styles.emptyInline : styles.center}>
            <Text style={styles.emptyText}>No conversations yet.</Text>
            <Text style={styles.emptySub}>Start a chat from a profile or job.</Text>
          </View>
        }
        ListFooterComponent={
          showArchived ? (
            <View style={styles.archivedSection}>
              <Text style={styles.archivedTitle}>Archived</Text>
              {archived.length > 0 ? (
                archived.map((item) => (
                  <View key={`arch-${item.id}`}>{renderRow(item, true)}</View>
                ))
              ) : (
                <Text style={styles.emptySub}>No archived conversations.</Text>
              )}
            </View>
          ) : null
        }
      />
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
  emptyInline: { alignItems: 'center', paddingTop: 48, paddingBottom: 28 },
  archivedSection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 12, marginTop: 8 },
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

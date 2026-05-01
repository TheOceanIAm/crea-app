import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  RefreshControl,
  Alert,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '@/lib/supabase'

type Convo = { id: string; name: string; avatar: string; lastMessage: string; time: string; unread: boolean }

function timeAgo(str: string | null | undefined) {
  if (!str) return '—'
  const t = new Date(str).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

async function unreadCountForConversation(conversationId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('read', false)
    .neq('sender_id', userId)
  if (error) {
    console.warn('[messages] unread count', conversationId, error.message)
    return 0
  }
  return count ?? 0
}

export default function MessagesScreen() {
  const router = useRouter()
  const [convos, setConvos] = useState<Convo[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [signedIn, setSignedIn] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [archived, setArchived] = useState<Convo[]>([])
  const [showArchived, setShowArchived] = useState(false)

  const loadConvos = useCallback(async () => {
    setLoadError(null)
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) {
      setSignedIn(false)
      setConvos([])
      return
    }
    setSignedIn(true)

    const { data: rows, error } = await supabase
      .from('conversations')
      .select('id, participant_1, participant_2, last_message, last_message_at')
      .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(50)

    if (error) {
      console.warn('[messages] conversations query', error.message)
      setLoadError(error.message)
      setConvos([])
      return
    }

    const { data: archivedRows } = await supabase
      .from('conversation_archives')
      .select('conversation_id')
      .eq('user_id', user.id)
      .eq('archived', true)
    const archivedIds = new Set((archivedRows ?? []).map((r) => String(r.conversation_id)))

    const inbox: Convo[] = []
    const archivedConvos: Convo[] = []
    for (const row of rows ?? []) {
      const otherId = row.participant_1 === user.id ? row.participant_2 : row.participant_1
      const { data: p } = await supabase
        .from('profiles')
        .select('name, avatar_url')
        .eq('id', otherId)
        .maybeSingle()

      const unread = await unreadCountForConversation(String(row.id), user.id)

      const convo = {
        id: String(row.id),
        name: (p?.name && String(p.name).trim()) || 'User',
        avatar: typeof p?.avatar_url === 'string' ? p.avatar_url : '',
        lastMessage: typeof row.last_message === 'string' && row.last_message.trim() ? row.last_message : 'No messages yet',
        time: timeAgo(row.last_message_at),
        unread: unread > 0,
      }
      if (archivedIds.has(convo.id)) archivedConvos.push(convo)
      else inbox.push(convo)
    }
    setConvos(inbox)
    setArchived(archivedConvos)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await loadConvos()
    } finally {
      setLoading(false)
    }
  }, [loadConvos])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    const channel = supabase
      .channel('messages-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => void loadConvos()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => void loadConvos()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadConvos])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadConvos()
    } finally {
      setRefreshing(false)
    }
  }, [loadConvos])

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
    await loadConvos()
  }, [loadConvos])

  const deleteConversation = useCallback(async (conversationId: string) => {
    Alert.alert('Delete conversation', 'Delete all messages in this conversation?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('messages').delete().eq('conversation_id', conversationId)
          if (error) {
            Alert.alert('Could not delete', error.message)
            return
          }
          await archiveConversation(conversationId, true)
          await loadConvos()
        },
      },
    ])
  }, [archiveConversation, loadConvos])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
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
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFDC00" />}
        renderItem={({ item }) => (
          <Swipeable
            friction={2}
            overshootRight={false}
            renderRightActions={() => (
              <View style={styles.swipeActions}>
                <TouchableOpacity style={styles.archiveAction} onPress={() => void archiveConversation(item.id, true)}>
                  <Text style={styles.swipeActionText}>Archive</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteAction} onPress={() => deleteConversation(item.id)}>
                  <Text style={styles.swipeActionText}>Delete</Text>
                </TouchableOpacity>
              </View>
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
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Swipeable
                friction={2}
                overshootRight={false}
                renderRightActions={() => (
                  <View style={styles.swipeActions}>
                    <TouchableOpacity style={styles.archiveAction} onPress={() => void archiveConversation(item.id, false)}>
                      <Text style={styles.swipeActionText}>Unarchive</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteAction} onPress={() => deleteConversation(item.id)}>
                      <Text style={styles.swipeActionText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
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
    alignItems: 'stretch',
    marginVertical: 4,
  },
  archiveAction: {
    backgroundColor: '#3a3a3a',
    justifyContent: 'center',
    alignItems: 'center',
    width: 86,
    borderRadius: 10,
    marginRight: 6,
  },
  deleteAction: {
    backgroundColor: '#b91c1c',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 10,
  },
  swipeActionText: { color: '#fff', fontSize: 12, fontWeight: '800' },
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

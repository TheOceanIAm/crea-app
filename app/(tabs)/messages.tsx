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
} from 'react-native'
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

    const result: Convo[] = []
    for (const row of rows ?? []) {
      const otherId = row.participant_1 === user.id ? row.participant_2 : row.participant_1
      const { data: p } = await supabase
        .from('profiles')
        .select('name, avatar_url')
        .eq('id', otherId)
        .maybeSingle()

      const unread = await unreadCountForConversation(String(row.id), user.id)

      result.push({
        id: String(row.id),
        name: (p?.name && String(p.name).trim()) || 'User',
        avatar: typeof p?.avatar_url === 'string' ? p.avatar_url : '',
        lastMessage: typeof row.last_message === 'string' && row.last_message.trim() ? row.last_message : 'No messages yet',
        time: timeAgo(row.last_message_at),
        unread: unread > 0,
      })
    }
    setConvos(result)
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
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No conversations yet.</Text>
            <Text style={styles.emptySub}>Start a chat from a profile or job.</Text>
          </View>
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

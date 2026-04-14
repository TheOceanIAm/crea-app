import { useEffect, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'

type Convo = { id: string; name: string; avatar: string; lastMessage: string; time: string; unread: boolean }

function timeAgo(str: string) {
  const diff = Date.now() - new Date(str).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export default function MessagesScreen() {
  const [convos, setConvos] = useState<Convo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: rows } = await supabase
        .from('conversations')
        .select('*')
        .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
        .order('last_message_at', { ascending: false })
        .limit(20)

      const result: Convo[] = []
      for (const row of rows ?? []) {
        const otherId = row.participant_1 === user.id ? row.participant_2 : row.participant_1
        const { data: p } = await supabase.from('profiles').select('name, avatar_url').eq('id', otherId).single()
        const { count } = await supabase
          .from('messages').select('*', { count: 'exact', head: true })
          .eq('conversation_id', row.id).eq('read', false).neq('sender_id', user.id)
        result.push({
          id: row.id,
          name: p?.name ?? 'User',
          avatar: p?.avatar_url ?? '',
          lastMessage: row.last_message ?? 'No messages yet',
          time: timeAgo(row.last_message_at),
          unread: (count ?? 0) > 0,
        })
      }
      setConvos(result)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#FFDC00" size="large" /></View>
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Messages</Text>
      <FlatList
        data={convos}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.7}>
            <View style={styles.avatarWrap}>
              {item.avatar
                ? <Image source={{ uri: item.avatar }} style={styles.avatar} />
                : <View style={styles.avatarFallback}><Text style={styles.avatarLetter}>{item.name.charAt(0)}</Text></View>
              }
              {item.unread && <View style={styles.dot} />}
            </View>
            <View style={styles.cardBody}>
              <View style={styles.cardTop}>
                <Text style={[styles.name, item.unread && styles.nameUnread]}>{item.name}</Text>
                <Text style={styles.time}>{item.time}</Text>
              </View>
              <Text style={styles.preview} numberOfLines={1}>{item.lastMessage}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}><Text style={styles.emptyText}>No messages</Text></View>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', marginTop: 60 },
  title: { fontSize: 28, fontWeight: '900', color: '#ffffff', letterSpacing: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { color: '#FFDC00', fontSize: 18, fontWeight: '700' },
  dot: { position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFDC00', borderWidth: 2, borderColor: '#0a0a0a' },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  name: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  nameUnread: { color: '#ffffff', fontWeight: '700' },
  time: { fontSize: 11, color: 'rgba(255,255,255,0.25)' },
  preview: { fontSize: 13, color: 'rgba(255,255,255,0.3)' },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 15 },
})

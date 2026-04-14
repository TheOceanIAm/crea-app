import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Send } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'

type Row = {
  id: string
  project_id: string
  sender_id: string
  body: string
  created_at: string
  profiles?: { name: string | null } | null
}

type Props = { projectId: string; userId: string }

export function ProjectMessagesTab({ projectId, userId }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_messages')
      .select('id, project_id, sender_id, body, created_at, profiles(name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) {
      Alert.alert('Messages', error.message)
      setRows([])
    } else {
      setRows((data as unknown as Row[]) ?? [])
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  useEffect(() => {
    const ch = supabase
      .channel(`project-messages-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'project_messages',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          load()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [projectId, load])

  const send = async () => {
    const t = body.trim()
    if (!t || sending) return
    setSending(true)
    const { error } = await supabase.from('project_messages').insert({
      project_id: projectId,
      sender_id: userId,
      body: t,
    })
    setSending(false)
    if (error) {
      Alert.alert('Send failed', error.message)
      return
    }
    setBody('')
    load()
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = item.sender_id === userId
          const prof = item.profiles as { name: string | null } | { name: string | null }[] | null | undefined
          const p = Array.isArray(prof) ? prof[0] : prof
          const name = p?.name || 'Member'
          return (
            <View style={[styles.bubbleWrap, mine && styles.bubbleWrapMine]}>
              <Text style={styles.meta}>
                {name}
                {!mine ? '' : ' · you'}
              </Text>
              <View style={[styles.bubble, mine && styles.bubbleMine]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
              </View>
            </View>
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet — start the thread.</Text>}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message the crew…"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={4000}
        />
        <TouchableOpacity style={[styles.sendBtn, sending && styles.dim]} onPress={send} disabled={sending}>
          <Send size={20} color="#0a0a0a" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  center: { paddingVertical: 40, alignItems: 'center' },
  list: { flex: 1 },
  listContent: { paddingBottom: 12, paddingTop: 8 },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.35)', marginTop: 24, paddingHorizontal: 24 },
  bubbleWrap: { alignSelf: 'flex-start', maxWidth: '88%', marginBottom: 12 },
  bubbleWrapMine: { alignSelf: 'flex-end' },
  meta: { fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4, marginLeft: 4 },
  bubble: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleMine: { backgroundColor: 'rgba(255,220,0,0.15)', borderColor: 'rgba(255,220,0,0.35)' },
  bubbleText: { fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.5 },
})

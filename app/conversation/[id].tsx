import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { ScrollView, Swipeable } from 'react-native-gesture-handler'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Trash2 } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { requestNotifyRecipientPush } from '@/lib/notifyMessagePush'
import { invalidateDmBadge } from '@/lib/invalidateDmBadge'

type MsgRow = {
  id: string
  sender_id: string
  created_at: string
  body?: string
  content?: string
  message?: string
}

function messageText(m: MsgRow): string {
  const raw = m.body ?? m.content ?? m.message
  return typeof raw === 'string' ? raw : ''
}

async function syncConversationPreviewAfterMessagesChange(conversationId: string) {
  const { data: lastRows } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)

  const last = lastRows?.[0] as MsgRow | undefined
  const preview = last ? messageText(last).trim() || 'No messages yet' : 'No messages yet'
  const at = last?.created_at ?? new Date().toISOString()

  await supabase
    .from('conversations')
    .update({ last_message: preview, last_message_at: at })
    .eq('id', conversationId)
}

export default function ConversationThreadScreen() {
  const router = useRouter()
  const { id: conversationId } = useLocalSearchParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  const [title, setTitle] = useState('Messages')
  const [rows, setRows] = useState<MsgRow[]>([])
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    if (!conversationId || typeof conversationId !== 'string') {
      setLoading(false)
      return
    }
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth.user?.id ?? null
    setMe(uid)
    if (!uid) {
      setLoading(false)
      return
    }

    const { data: convo } = await supabase
      .from('conversations')
      .select('participant_1, participant_2')
      .eq('id', conversationId)
      .maybeSingle()

    if (convo) {
      const other =
        convo.participant_1 === uid ? convo.participant_2 : convo.participant_1
      const { data: prof } = await supabase.from('profiles').select('name').eq('id', other).maybeSingle()
      if (prof?.name) setTitle(String(prof.name))
    }

    // Mark incoming unread messages as read when opening thread.
    const { error: readErr } = await supabase
      .from('messages')
      .update({ read: true })
      .eq('conversation_id', conversationId)
      .eq('read', false)
      .neq('sender_id', uid)
      .select('id')
    if (readErr) {
      console.warn('[conversation] mark read', readErr.message)
    }
    invalidateDmBadge()

    const { data: msgs, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (!error && Array.isArray(msgs)) {
      setRows(msgs as MsgRow[])
    }
    setLoading(false)
  }, [conversationId])

  useEffect(() => {
    void load()
  }, [load])

  const send = async () => {
    const t = draft.trim()
    if (!t || !conversationId || typeof conversationId !== 'string' || !me || sending) return
    setSending(true)
    const payload: Record<string, unknown> = {
      conversation_id: conversationId,
      sender_id: me,
      body: t,
      read: false,
    }
    let { data: inserted, error } = await supabase.from('messages').insert(payload).select('id').single()
    if (error?.message?.includes('column') && error.message.includes('body')) {
      const alt = { ...payload }
      delete alt.body
      alt.content = t
      const r2 = await supabase.from('messages').insert(alt).select('id').single()
      inserted = r2.data
      error = r2.error
    }
    if (!error) {
      setDraft('')
      await supabase
        .from('conversations')
        .update({ last_message: t, last_message_at: new Date().toISOString() })
        .eq('id', conversationId)
      if (inserted?.id) {
        void requestNotifyRecipientPush(inserted.id)
        const optimistic: MsgRow = {
          id: inserted.id,
          sender_id: me,
          created_at: new Date().toISOString(),
          body: t,
        }
        setRows((prev) => [...prev, optimistic])
      }
      void load()
    }
    setSending(false)
  }

  const confirmDeleteMessage = (m: MsgRow) => {
    if (!conversationId || typeof conversationId !== 'string' || !me) return
    Alert.alert(
      'Delete message',
      'Remove this message from the chat for both of you? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteMessageById(m),
        },
      ]
    )
  }

  const deleteMessageById = async (m: MsgRow) => {
    if (!conversationId || typeof conversationId !== 'string') return
    const { error } = await supabase.from('messages').delete().eq('id', m.id)
    if (error) {
      Alert.alert('Could not delete', error.message)
      return
    }
    await syncConversationPreviewAfterMessagesChange(conversationId)
    await load()
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!me) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Text style={styles.hint}>Sign in to use messages.</Text>
        <TouchableOpacity onPress={() => router.replace('/login')} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Log in</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView style={styles.thread} contentContainerStyle={styles.threadContent}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>No messages yet. Say hello.</Text>
          ) : (
            rows.map((m) => {
              const mine = m.sender_id === me
              const txt = messageText(m)
              return (
                <Swipeable
                  key={m.id}
                  friction={2}
                  overshootRight={false}
                  renderRightActions={() => (
                    <View style={styles.swipeDeleteOuter}>
                      <TouchableOpacity
                        style={styles.swipeDeleteBtn}
                        onPress={() => confirmDeleteMessage(m)}
                        accessibilityRole="button"
                        accessibilityLabel="Delete message"
                      >
                        <Trash2 size={22} color="#fff" strokeWidth={ICON_STROKE} />
                        <Text style={styles.swipeDeleteLabel}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                >
                  <View style={[styles.bubbleWrap, mine && styles.bubbleWrapMine]}>
                    <TouchableOpacity
                      activeOpacity={0.92}
                      delayLongPress={380}
                      onLongPress={() => confirmDeleteMessage(m)}
                      accessibilityLabel="Message"
                      accessibilityHint="Swipe left to delete, or long press to delete"
                    >
                      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                        <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
                          {txt}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </Swipeable>
              )
            })
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={4000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
            onPress={() => void send()}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#0a0a0a" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 100 },
  backText: { fontSize: 16, fontWeight: '600', color: '#FFDC00' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: '#fff', textAlign: 'center' },
  headerSpacer: { width: 100 },
  thread: { flex: 1 },
  threadContent: { padding: 16, paddingBottom: 24 },
  empty: { color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 40 },
  bubbleWrap: { alignItems: 'flex-start', marginBottom: 10 },
  bubbleWrapMine: { alignItems: 'flex-end' },
  swipeDeleteOuter: {
    width: 84,
    marginBottom: 10,
    justifyContent: 'center',
  },
  swipeDeleteBtn: {
    flex: 1,
    backgroundColor: '#b91c1c',
    borderRadius: 14,
    marginLeft: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  swipeDeleteLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bubbleMine: { backgroundColor: '#FFDC00' },
  bubbleTheirs: { backgroundColor: '#222', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: '#0a0a0a' },
  bubbleTextTheirs: { color: 'rgba(255,255,255,0.9)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: '#FFDC00',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 72,
    alignItems: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { fontWeight: '800', color: '#0a0a0a' },
  hint: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 16 },
  primaryBtn: {
    alignSelf: 'center',
    backgroundColor: '#FFDC00',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { fontWeight: '800', color: '#0a0a0a' },
})

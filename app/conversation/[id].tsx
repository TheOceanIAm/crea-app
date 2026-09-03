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
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { authUserIdKey, conversationKey } from '@/lib/queryKeys'
import { ICON_STROKE } from '@/lib/iconTheme'
import { requestNotifyRecipientPush } from '@/lib/notifyMessagePush'
import { invalidateDmBadge } from '@/lib/invalidateDmBadge'
import { replyToBookingMessage } from '@/lib/replyToBookingMessage'
import { BookingRequestCard } from '@/components/messaging/BookingRequestCard'
import {
  findBookingReplyStatus,
  messagePreviewForInbox,
  parseBookingDm,
  parseBookingReply,
  type BookingReplyStatus,
} from '@/lib/bookingDm'
import {
  cacheConversation,
  hydrateConversationFromDisk,
  persistConversationToDisk,
  readCachedConversation,
  type ConversationCache,
  type ConversationMsgRow,
} from '@/lib/conversationCache'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'

type MsgRow = ConversationMsgRow

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
  const preview = last ? messagePreviewForInbox(messageText(last)).trim() || 'No messages yet' : 'No messages yet'
  const at = last?.created_at ?? new Date().toISOString()

  await supabase
    .from('conversations')
    .update({ last_message: preview, last_message_at: at })
    .eq('id', conversationId)
}

type ThreadData = ConversationCache

let conversationRealtimeTopicSeq = 0

export default function ConversationThreadScreen() {
  const router = useRouter()
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const conversationId = typeof rawId === 'string' ? rawId : ''
  const [draft, setDraft] = useState('')
  const [replyingId, setReplyingId] = useState<string | null>(null)

  const authQuery = useQuery({
    queryKey: authUserIdKey,
    queryFn: async () => {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    },
    staleTime: 5 * 60_000,
  })
  const me = authQuery.data ?? null
  const enabled = Boolean(conversationId) && Boolean(me)

  useEffect(() => {
    if (!conversationId) return
    if (readCachedConversation(conversationId) || queryClient.getQueryData(conversationKey(conversationId))) {
      return
    }
    let cancelled = false
    void hydrateConversationFromDisk(conversationId).then((disk) => {
      if (cancelled || !disk) return
      if (!queryClient.getQueryData(conversationKey(conversationId))) {
        queryClient.setQueryData(conversationKey(conversationId), disk)
      }
    })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  const threadQuery = useQuery({
    queryKey: conversationKey(conversationId),
    enabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
    initialData: (): ThreadData | undefined => {
      if (!conversationId) return undefined
      return readCachedConversation(conversationId) ?? undefined
    },
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<ThreadData> => {
      const { data: convo } = await supabase
        .from('conversations')
        .select('participant_1, participant_2')
        .eq('id', conversationId)
        .maybeSingle()

      let title = 'Messages'
      let otherUserId: string | null = null
      if (convo) {
        const other = convo.participant_1 === me ? convo.participant_2 : convo.participant_1
        otherUserId = typeof other === 'string' ? other : null
        if (otherUserId) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', otherUserId)
            .maybeSingle()
          if (prof?.name) title = String(prof.name)
        }
      }

      const { data: msgs, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)

      const data: ThreadData = { title, otherUserId, rows: (msgs ?? []) as MsgRow[] }
      cacheConversation(conversationId, data)
      void persistConversationToDisk(conversationId, data)
      return data
    },
  })

  const rows = threadQuery.data?.rows ?? []
  const title = threadQuery.data?.title ?? 'Messages'
  const otherUserId = threadQuery.data?.otherUserId ?? null
  const loading = authQuery.isLoading || (enabled && threadQuery.isLoading && rows.length === 0)
  const rowCount = rows.length

  // Mark incoming unread messages as read (on open + whenever new ones arrive).
  useEffect(() => {
    if (!conversationId || !me) return
    void (async () => {
      const { error } = await supabase
        .from('messages')
        .update({ read: true })
        .eq('conversation_id', conversationId)
        .eq('read', false)
        .neq('sender_id', me)
        .select('id')
      if (error) {
        console.warn('[conversation] mark read', error.message)
        return
      }
      // Let PostgREST/RLS settle so the tab-bar count query sees read=true.
      setTimeout(() => invalidateDmBadge(), 60)
    })()
  }, [conversationId, me, rowCount])

  // Live updates: new/changed/deleted messages in this thread refresh the view.
  useEffect(() => {
    if (!conversationId || !me) return
    const topic = `conversation-${conversationId}-${++conversationRealtimeTopicSeq}`
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [conversationId, me])

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: me,
        body: text,
        read: false,
      }
      let { data: inserted, error } = await supabase
        .from('messages')
        .insert(payload)
        .select('id')
        .single()
      // Some schemas store the text in `content` instead of `body`.
      if (error?.message?.includes('column') && error.message.includes('body')) {
        const alt = { ...payload }
        delete alt.body
        alt.content = text
        const r2 = await supabase.from('messages').insert(alt).select('id').single()
        inserted = r2.data
        error = r2.error
      }
      if (error) throw new Error(error.message)
      await supabase
        .from('conversations')
        .update({ last_message: text, last_message_at: new Date().toISOString() })
        .eq('id', conversationId)
      if (inserted?.id) void requestNotifyRecipientPush(inserted.id)
    },
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: conversationKey(conversationId) })
      const prev = queryClient.getQueryData<ThreadData>(conversationKey(conversationId))
      const optimistic: MsgRow = {
        id: `temp-${Date.now()}`,
        sender_id: me as string,
        created_at: new Date().toISOString(),
        body: text,
      }
      if (prev) {
        queryClient.setQueryData(conversationKey(conversationId), {
          ...prev,
          rows: [...prev.rows, optimistic],
        })
      }
      setDraft('')
      return { prev, draft: text }
    },
    onError: (_err, _text, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(conversationKey(conversationId), ctx.prev)
      if (ctx?.draft) setDraft(ctx.draft)
      Alert.alert('Could not send', 'Please try again.')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
      invalidateDmBadge()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (m: MsgRow) => {
      const { error } = await supabase.from('messages').delete().eq('id', m.id)
      if (error) throw new Error(error.message)
      await syncConversationPreviewAfterMessagesChange(conversationId)
    },
    onMutate: async (m) => {
      await queryClient.cancelQueries({ queryKey: conversationKey(conversationId) })
      const prev = queryClient.getQueryData<ThreadData>(conversationKey(conversationId))
      if (prev) {
        queryClient.setQueryData(conversationKey(conversationId), {
          ...prev,
          rows: prev.rows.filter((r) => r.id !== m.id),
        })
      }
      return { prev }
    },
    onError: (_err, _m, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(conversationKey(conversationId), ctx.prev)
      Alert.alert('Could not delete', 'Please try again.')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
      invalidateDmBadge()
    },
  })

  const sending = sendMutation.isPending

  const send = useCallback(() => {
    const t = draft.trim()
    if (!t || !conversationId || !me || sending) return
    sendMutation.mutate(t)
  }, [draft, conversationId, me, sending, sendMutation])

  const confirmDeleteMessage = useCallback(
    (m: MsgRow) => {
      if (!conversationId || !me) return
      Alert.alert(
        'Delete message',
        'Remove this message from the chat for both of you? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteMutation.mutate(m),
          },
        ],
      )
    },
    [conversationId, me, deleteMutation],
  )

  const submitBookingReply = useCallback(
    async (bookingMsg: MsgRow, status: BookingReplyStatus) => {
      if (!conversationId || !me || replyingId) return
      const bookingPayload = parseBookingDm(messageText(bookingMsg))
      const projTitle = bookingPayload?.title ?? 'Project'
      setReplyingId(bookingMsg.id)
      try {
        const r = await replyToBookingMessage({
          conversationId,
          bookingMessageId: bookingMsg.id,
          status,
          projectTitle: projTitle,
        })
        if (r.ok === false) {
          Alert.alert('Could not send', r.error)
          return
        }
        await queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) })
        void queryClient.invalidateQueries({ queryKey: ['messages'] })
      } finally {
        setReplyingId(null)
      }
    },
    [conversationId, me, replyingId],
  )

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Messages
          </Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <ScreenListSkeleton rows={8} />
        </View>
      </SafeAreaView>
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
        <ScrollView
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          keyboardShouldPersistTaps="handled"
        >
          {rows.length === 0 ? (
            <Text style={styles.empty}>No messages yet. Say hello.</Text>
          ) : (
            rows.map((m) => {
              const mine = m.sender_id === me
              const txt = messageText(m)
              const replyMeta = parseBookingReply(txt)

              if (replyMeta) {
                const human =
                  txt.split(/\n\n/).slice(1).join('\n\n').trim() ||
                  (replyMeta.status === 'accepted' ? 'Booking accepted.' : 'Booking declined.')
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
                        accessibilityLabel="Booking response"
                      >
                        <View style={[styles.replyBanner, mine ? styles.replyBannerMine : styles.replyBannerTheirs]}>
                          <Text style={styles.replyBannerText}>{human}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </Swipeable>
                )
              }

              const bookingPayload = parseBookingDm(txt)
              if (bookingPayload) {
                const responderId = mine ? otherUserId ?? '' : me ?? ''
                const replyStatus =
                  responderId ? findBookingReplyStatus(rows, m.id, responderId) : null

                return (
                  <Swipeable
                    key={m.id}
                    friction={2}
                    overshootRight={false}
                    activeOffsetX={[-24, 24]}
                    failOffsetY={[-12, 12]}
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
                        <BookingRequestCard
                          payload={bookingPayload}
                          mine={mine}
                          replyStatus={replyStatus}
                          bookingSenderId={m.sender_id}
                          replyBusy={replyingId === m.id}
                          onLongPress={() => confirmDeleteMessage(m)}
                          onAccept={
                            !mine && !replyStatus
                              ? () => void submitBookingReply(m, 'accepted')
                              : undefined
                          }
                          onDecline={
                            !mine && !replyStatus
                              ? () => void submitBookingReply(m, 'declined')
                              : undefined
                          }
                        />
                    </View>
                  </Swipeable>
                )
              }

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
  replyBanner: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  replyBannerMine: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255,220,0,0.14)',
    borderColor: 'rgba(255,220,0,0.35)',
  },
  replyBannerTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#161616',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  replyBannerText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.88)',
  },
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

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
  Image,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Send, Trash2 } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { loadProfileAvatarsByIds, normalizeProfileAvatarUrl } from '@/lib/profileAvatar'
import { mirrorProjectMessageToJob } from '@/lib/syncWorkspaceMessage'
import { deleteOwnWorkspaceMessage, filterRowsAfterDelete } from '@/lib/deleteWorkspaceMessage'
import { fetchMergedWorkspaceMessages, workspaceMessagesNearDuplicate } from '@/lib/workspaceMessages'

type Row = {
  id: string
  project_id: string
  sender_id: string
  body: string
  created_at: string
  avatar_url: string | null
  profiles?: { name: string | null; avatar_url?: string | null } | null
}

type Props = { projectId: string; userId: string }

function appendMessageRow(prev: Row[], next: Row): Row[] {
  if (prev.some((m) => m.id === next.id)) return prev
  if (
    prev.some((m) =>
      workspaceMessagesNearDuplicate(
        { senderId: m.sender_id, body: m.body, createdAt: m.created_at },
        { senderId: next.sender_id, body: next.body, createdAt: next.created_at }
      )
    )
  ) {
    return prev
  }
  return [...prev, next]
}

function mapMergedToRows(
  projectId: string,
  merged: Awaited<ReturnType<typeof fetchMergedWorkspaceMessages>>['rows'],
  avatarLookup: Map<string, string>
): Row[] {
  return merged.map((r) => {
    const prof = r.profiles as { name?: string | null; avatar_url?: string | null } | null | undefined
    const p = Array.isArray(prof) ? prof[0] : prof
    const avatar_url =
      normalizeProfileAvatarUrl(p?.avatar_url) ?? avatarLookup.get(r.sender_id) ?? null
    return {
      id: r.id,
      project_id: projectId,
      sender_id: r.sender_id,
      body: r.content,
      created_at: r.created_at,
      avatar_url,
      profiles: p ? { name: p.name ?? null, avatar_url } : null,
    }
  })
}

export function ProjectMessagesTab({ projectId, userId }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [jobContextReady, setJobContextReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const listRef = useRef<FlatList>(null)
  const sendingLockRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setJobContextReady(false)
    void (async () => {
      const { data: proj } = await supabase
        .from('projects')
        .select('job_id, company_id')
        .eq('id', projectId)
        .maybeSingle()
      if (!cancelled) {
        setJobId(proj?.job_id != null ? String(proj.job_id) : null)
        setCompanyId(proj?.company_id != null ? String(proj.company_id) : null)
        setJobContextReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const load = useCallback(async () => {
    const { rows: merged, error } = await fetchMergedWorkspaceMessages(supabase, {
      projectId,
      jobId,
    })

    if (error) {
      Alert.alert('Messages', error)
      setRows([])
    } else {
      const senderIds = [...new Set(merged.map((r) => r.sender_id))]
      const avatarLookup = await loadProfileAvatarsByIds(supabase, senderIds)
      if (companyId) {
        const { data: cp } = await supabase
          .from('company_profiles')
          .select('logo_url')
          .eq('id', companyId)
          .maybeSingle()
        const logo = normalizeProfileAvatarUrl((cp as { logo_url?: string | null } | null)?.logo_url)
        if (logo) avatarLookup.set(companyId, logo)
      }
      setRows(mapMergedToRows(projectId, merged, avatarLookup))
    }
    setLoading(false)
  }, [projectId, jobId, companyId])

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
    if (!jobContextReady) return

    let channel = supabase
      .channel(`project-messages-${projectId}-${jobId ?? 'none'}`)
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

    if (jobId) {
      channel = channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'job_messages',
          filter: `job_id=eq.${jobId}`,
        },
        () => {
          load()
        }
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId, jobId, jobContextReady, load])

  const send = async () => {
    const t = body.trim()
    if (!t || sending || sendingLockRef.current) return
    sendingLockRef.current = true
    setSending(true)
    try {
      const { data: insertedMsg, error } = await supabase
        .from('project_messages')
        .insert({
          project_id: projectId,
          sender_id: userId,
          body: t,
        })
        .select('id, project_id, sender_id, body, created_at, profiles(name, avatar_url)')
        .single()
      if (error) {
        Alert.alert('Send failed', error.message)
        return
      }
      if (insertedMsg?.id) {
        void notifyExpoEvent({ kind: 'project_message', messageId: insertedMsg.id })
      }
      const inserted = insertedMsg as Row | null
      if (inserted) {
        const prof = inserted.profiles as { name?: string | null; avatar_url?: string | null } | null
        const avatar_url = normalizeProfileAvatarUrl(prof?.avatar_url) ?? null
        setRows((prev) =>
          appendMessageRow(prev, {
            ...inserted,
            avatar_url,
            profiles: prof ? { name: prof.name ?? null, avatar_url } : null,
          })
        )
      }
      setBody('')
      if (jobId) {
        const mirrored = await mirrorProjectMessageToJob({
          jobId,
          senderId: userId,
          body: t,
          createdAt: inserted?.created_at ?? null,
        })
        if (mirrored.error) {
          Alert.alert('Sync warning', `Message sent, but web workspace sync failed: ${mirrored.error}`)
        }
      }
      // Realtime + focus refresh; avoid an immediate load() race that can flash a mirror duplicate.
    } finally {
      sendingLockRef.current = false
      setSending(false)
    }
  }

  const removeMessage = (item: Row) => {
    if (item.sender_id !== userId || deletingId) return
    Alert.alert('Delete message', 'Remove this message from the crew chat?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(item.id)
          const { error } = await deleteOwnWorkspaceMessage(supabase, {
            messageId: item.id,
            senderId: item.sender_id,
            body: item.body,
            createdAt: item.created_at,
            jobId,
            projectId,
          })
          setDeletingId(null)
          if (error) {
            Alert.alert('Could not delete', error)
            return
          }
          setRows((prev) => filterRowsAfterDelete(prev, item))
        },
      },
    ])
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
          const prof = item.profiles
          const name = prof?.name || 'Member'
          return (
            <View style={[styles.bubbleWrap, mine && styles.bubbleWrapMine]}>
              {!mine && item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.msgAvatar} />
              ) : null}
              <View style={styles.bubbleCol}>
                <Text style={styles.meta}>
                  {name}
                  {!mine ? '' : ' · you'}
                </Text>
                <View style={[styles.bubble, mine && styles.bubbleMine]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                </View>
              </View>
              {mine ? (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => removeMessage(item)}
                  disabled={deletingId === item.id}
                  accessibilityLabel="Delete message"
                >
                  {deletingId === item.id ? (
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
                  ) : (
                    <Trash2 size={16} color="rgba(255,255,255,0.35)" strokeWidth={ICON_STROKE} />
                  )}
                </TouchableOpacity>
              ) : null}
              {mine && item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.msgAvatar} />
              ) : null}
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
  bubbleWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '92%',
    marginBottom: 12,
  },
  bubbleWrapMine: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  msgAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#222' },
  bubbleCol: { flex: 1, minWidth: 0 },
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
  deleteBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
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

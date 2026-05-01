import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'

type NotificationRow = {
  id: string
  kind: 'invite' | 'project_update' | 'project_message' | 'job_application' | 'invoice_incoming' | 'dm_reply'
  projectId: string
  targetId?: string
  title: string
  body: string
  at: string
}

function timeAgo(str: string) {
  const t = new Date(str).getTime()
  if (Number.isNaN(t)) return 'now'
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export default function NotificationsScreen() {
  const router = useRouter()
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setRows([])
      return
    }

    const { data: memberships } = await supabase
      .from('project_members')
      .select('project_id, member_role, created_at')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200)

    const projectIds = [...new Set((memberships ?? []).map((m) => String(m.project_id)))]
    const { data: myProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const myRole = String(myProfile?.role ?? '').trim().toLowerCase()

    // CEO: only show replies in direct messages (no project/invoice/application alerts).
    if (myRole === 'ceo') {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, participant_1, participant_2')
        .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
        .limit(200)
      const convIds = [...new Set((convs ?? []).map((c) => String(c.id)))]
      if (!convIds.length) {
        setRows([])
        return
      }

      const { data: incoming } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, created_at, read')
        .in('conversation_id', convIds)
        .neq('sender_id', user.id)
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(120)

      // Only conversations where CEO already wrote at least one message (= actively contacted).
      const { data: myMessages } = await supabase
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', convIds)
        .eq('sender_id', user.id)
        .limit(400)
      const contactedConversations = new Set((myMessages ?? []).map((m) => String(m.conversation_id)))

      const peerIds = new Set<string>()
      for (const c of convs ?? []) {
        const p1 = String(c.participant_1)
        const p2 = String(c.participant_2)
        if (p1 === user.id) peerIds.add(p2)
        else if (p2 === user.id) peerIds.add(p1)
      }
      const { data: peers } = peerIds.size
        ? await supabase.from('profiles').select('id, name').in('id', [...peerIds])
        : { data: [] as Array<{ id: string; name: string | null }> }
      const peerName = new Map<string, string>()
      for (const p of peers ?? []) peerName.set(String(p.id), String(p.name || 'User'))

      const convToPeer = new Map<string, string>()
      for (const c of convs ?? []) {
        const p1 = String(c.participant_1)
        const p2 = String(c.participant_2)
        convToPeer.set(String(c.id), p1 === user.id ? p2 : p1)
      }

      const dmRows: NotificationRow[] = (incoming ?? [])
        .filter((m) => contactedConversations.has(String(m.conversation_id)))
        .map((m) => {
          const peerId = convToPeer.get(String(m.conversation_id)) ?? ''
          const name = peerName.get(peerId) ?? 'User'
          return {
            id: `dm-reply-${m.id}`,
            kind: 'dm_reply',
            projectId: '',
            targetId: String(m.conversation_id),
            title: name,
            body: `${name} replied to your message.`,
            at: String(m.created_at),
          }
        })
        .slice(0, 80)

      setRows(dmRows)
      return
    }

    const { data: projects } = projectIds.length
      ? await supabase
          .from('projects')
          .select('id, title, updated_at')
          .in('id', projectIds)
          .limit(200)
      : { data: [] as Array<{ id: string; title: string | null; updated_at: string | null }> }

    const projectTitle = new Map<string, string>()
    for (const p of projects ?? []) projectTitle.set(String(p.id), String(p.title || 'Project'))

    const inviteRows: NotificationRow[] = (memberships ?? [])
      .filter((m) => String(m.member_role) === 'crew')
      .map((m) => ({
        id: `invite-${m.project_id}-${m.created_at}`,
        kind: 'invite',
        projectId: String(m.project_id),
        title: 'Project invitation',
        body: `You were added to ${projectTitle.get(String(m.project_id)) ?? 'a project'}.`,
        at: String(m.created_at),
      }))

    const updateRows: NotificationRow[] = (projects ?? [])
      .filter((p) => Boolean(p.updated_at))
      .map((p) => ({
        id: `project-update-${p.id}-${p.updated_at}`,
        kind: 'project_update',
        projectId: String(p.id),
        title: String(p.title || 'Project'),
        body: 'Project details were updated.',
        at: String(p.updated_at),
      }))

    const { data: projectMessages } = projectIds.length
      ? await supabase
          .from('project_messages')
          .select('id, project_id, sender_id, body, created_at')
          .in('project_id', projectIds)
          .neq('sender_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60)
      : { data: [] as Array<{ id: string; project_id: string; sender_id: string; body: string | null; created_at: string }> }

    const messageRows: NotificationRow[] = (projectMessages ?? []).map((m) => ({
      id: `project-msg-${m.id}`,
      kind: 'project_message',
      projectId: String(m.project_id),
      title: projectTitle.get(String(m.project_id)) ?? 'Project',
      body: 'New message in project chat.',
      at: String(m.created_at),
    }))

    let companyRows: NotificationRow[] = []
    if (myRole === 'company' || myRole === 'ceo') {
      const { data: myJobs } = await supabase
        .from('jobs')
        .select('id, title')
        .eq('company_id', user.id)
        .limit(200)
      const jobIds = [...new Set((myJobs ?? []).map((j) => String(j.id)))]
      const jobTitle = new Map<string, string>()
      for (const j of myJobs ?? []) jobTitle.set(String(j.id), String(j.title || 'Job'))

      const { data: apps } = jobIds.length
        ? await supabase
            .from('job_applications')
            .select('id, job_id, created_at')
            .in('job_id', jobIds)
            .order('created_at', { ascending: false })
            .limit(60)
        : { data: [] as Array<{ id: string; job_id: string; created_at: string }> }

      const applicationRows: NotificationRow[] = (apps ?? []).map((a) => ({
        id: `job-app-${a.id}`,
        kind: 'job_application',
        projectId: '',
        targetId: String(a.job_id),
        title: jobTitle.get(String(a.job_id)) ?? 'Job',
        body: 'New freelancer application received for your project.',
        at: String(a.created_at),
      }))

      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, title, invoice_number, created_at')
        .eq('company_id', user.id)
        .order('created_at', { ascending: false })
        .limit(60)

      const invoiceRows: NotificationRow[] = (invoices ?? []).map((inv) => ({
        id: `invoice-${inv.id}`,
        kind: 'invoice_incoming',
        projectId: '',
        targetId: String(inv.id),
        title: String(inv.title || inv.invoice_number || 'Invoice'),
        body: 'Incoming invoice received.',
        at: String(inv.created_at ?? new Date().toISOString()),
      }))

      companyRows = [...applicationRows, ...invoiceRows]
    }

    const next = [...inviteRows, ...messageRows, ...updateRows, ...companyRows]
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .slice(0, 80)

    setRows(next)
  }, [])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      try {
        await load()
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const emptyText = useMemo(() => 'No notifications yet.', [])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Notifications</Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFDC00" />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => {
              if (item.kind === 'invoice_incoming' && item.targetId) {
                router.push(`/(tabs)/invoices/${item.targetId}`)
                return
              }
              if (item.kind === 'dm_reply' && item.targetId) {
                router.push(`/conversation/${item.targetId}`)
                return
              }
              if (item.kind === 'job_application') {
                router.push('/(tabs)/company-applications')
                return
              }
              if (item.projectId) router.push(`/project/${item.projectId}`)
            }}
          >
            <View style={styles.kickerRow}>
              <Text style={styles.kicker}>
                {item.kind === 'invite'
                  ? 'Invitation'
                  : item.kind === 'project_message'
                    ? 'Project message'
                    : item.kind === 'job_application'
                      ? 'Application'
                      : item.kind === 'invoice_incoming'
                        ? 'Invoice'
                      : item.kind === 'dm_reply'
                        ? 'Direct reply'
                    : 'Project update'}
              </Text>
              <Text style={styles.time}>{timeAgo(item.at)}</Text>
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.empty}>{emptyText}</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  list: { paddingHorizontal: 20, paddingBottom: 36, flexGrow: 1 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    padding: 12,
    marginBottom: 10,
  },
  kickerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  kicker: { color: '#FFDC00', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  time: { color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  body: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 17 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
})


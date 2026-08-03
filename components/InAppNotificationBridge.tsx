import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { invalidateAlertsBadge, subscribeAlertsLivePatch } from '@/lib/invalidateAlerts'

function bannerDedupeKey(id: string): string {
  const m = id.match(/(?:live-)?(?:project-msg-|push-msg-|pm-)([0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12})/i)
  if (m?.[1]) return `pm:${m[1].toLowerCase()}`
  return id
}

type Banner = { id: string; title: string; body: string; onPress?: () => void }

/** Unique Realtime topic — reusing a fixed name returns an already-subscribed channel. */
let bannerRealtimeTopicSeq = 0

function dmText(row: Record<string, unknown>): string {
  const raw = row.body ?? row.content ?? row.message
  return typeof raw === 'string' ? raw : ''
}

function pushDataRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null
  return data as Record<string, unknown>
}

/**
 * Top-of-screen banners while the app is open.
 * Prefer foreground Expo push receipts (reliable), with Realtime as backup.
 */
export function InAppNotificationBridge() {
  const router = useRouter()
  const [banner, setBanner] = useState<Banner | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const receiptConfirmedDedupeRef = useRef(new Set<string>())
  const recentBannerIds = useRef(new Set<string>())
  const routerRef = useRef(router)
  routerRef.current = router

  const showBanner = useCallback(
    (b: Banner, ms = 5200) => {
      const key = bannerDedupeKey(b.id)
      if (recentBannerIds.current.has(key)) return
      recentBannerIds.current.add(key)
      // Keep dedupe set bounded.
      if (recentBannerIds.current.size > 80) {
        recentBannerIds.current = new Set(Array.from(recentBannerIds.current).slice(-40))
      }
      if (hideTimer.current) clearTimeout(hideTimer.current)
      opacity.setValue(0)
      setBanner(b)
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start()
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
          setBanner(null)
        )
      }, ms)
    },
    [opacity]
  )
  const showBannerRef = useRef(showBanner)
  showBannerRef.current = showBanner

  // Foreground Expo pushes → in-app banner (OS alert is suppressed while active).
  useEffect(() => {
    if (Platform.OS === 'web') return

    const openFromPush = (data: Record<string, unknown> | null) => {
      if (!data) return
      const type = typeof data.type === 'string' ? data.type : ''
      if (type === 'message') {
        const cid = data.conversationId
        if (typeof cid === 'string' && cid.length > 0) routerRef.current.push(`/conversation/${cid}`)
        return
      }
      if (type === 'invoice') {
        const id = data.invoiceId
        if (typeof id === 'string' && id.length > 0) {
          routerRef.current.push(`/(tabs)/invoices/${id}`)
        }
        return
      }
      if (type === 'job_application') {
        routerRef.current.push('/(tabs)/company-applications')
        return
      }
      if (type === 'workspace_ready' || type === 'project_message' || type === 'workspace_activity') {
        const pid = data.projectId
        if (typeof pid === 'string' && pid.length > 0) routerRef.current.push(`/project/${pid}`)
        return
      }
      if (type === 'profile_completion') {
        routerRef.current.push('/(tabs)/profile')
      }
    }

    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (AppState.currentState !== 'active') return
      const content = notification.request.content
      const data = pushDataRecord(content.data)
      const type = typeof data?.type === 'string' ? data.type : ''
      const title = typeof content.title === 'string' && content.title.trim() ? content.title.trim() : 'Crea'
      const body =
        typeof content.body === 'string' && content.body.trim()
          ? content.body.trim()
          : 'New update'
      const id =
        typeof data?.messageId === 'string'
          ? `push-msg-${data.messageId}`
          : typeof data?.invoiceId === 'string'
            ? `push-inv-${data.invoiceId}`
            : `push-${notification.request.identifier || `${type}-${title}-${body}`}`

      if (
        type === 'project_message' ||
        type === 'workspace_activity' ||
        type === 'workspace_ready' ||
        type === 'message' ||
        type === 'invoice' ||
        type === 'job_application' ||
        type === 'project_crew_invite'
      ) {
        invalidateAlertsBadge()
        showBannerRef.current({
          id,
          title,
          body,
          onPress: () => openFromPush(data),
        })
      }
    })

    return () => sub.remove()
  }, [])

  // Optimistic Alerts live-patch → banner (works even if push is slow/skipped).
  useEffect(() => {
    return subscribeAlertsLivePatch((patch) => {
      if (AppState.currentState !== 'active') return
      if (patch.row.kind !== 'project_message') return
      showBannerRef.current({
        id: `live-${patch.row.id}`,
        title: patch.row.title || 'Project',
        body: patch.row.body || 'New message.',
        onPress: () => {
          if (patch.row.projectId) routerRef.current.push(`/project/${patch.row.projectId}`)
        },
      })
    })
  }, [])

  useEffect(() => {
    if (Platform.OS === 'web') return

    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null
    let uid: string | null = null

    const setup = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      uid = user.id

      const topic = `in-app-banner-events-${uid}-${++bannerRealtimeTopicSeq}`
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            if (AppState.currentState !== 'active') return
            const row = payload.new as Record<string, unknown>
            if (String(row.sender_id) === uid) return
            const cid = typeof row.conversation_id === 'string' ? row.conversation_id : ''
            const preview = dmText(row)
            showBannerRef.current({
              id: `dm-${String(row.id)}`,
              title: 'New message',
              body: preview.length > 140 ? `${preview.slice(0, 137)}…` : preview || 'Open to read',
              onPress: () => {
                if (cid) routerRef.current.push(`/conversation/${cid}`)
              },
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'job_applications' },
          async (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            const jobId = typeof row.job_id === 'string' ? row.job_id : ''
            if (!jobId) return
            const { data: job } = await supabase.from('jobs').select('company_id, title').eq('id', jobId).maybeSingle()
            if (job?.company_id !== uid) return
            invalidateAlertsBadge()
            showBannerRef.current({
              id: `app-${String(row.id)}`,
              title: 'New application',
              body: `Someone applied to «${String(job.title ?? 'Your project')}».`,
              onPress: () => routerRef.current.push('/(tabs)/company-applications'),
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'invoices' },
          (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            if (String(row.company_id) === uid) {
              invalidateAlertsBadge()
              showBannerRef.current({
                id: `inv-${String(row.id)}`,
                title: 'Incoming invoice',
                body: String(row.title ?? row.invoice_number ?? 'New invoice'),
                onPress: () => routerRef.current.push(`/(tabs)/invoices/${String(row.id)}`),
              })
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'invoices' },
          (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            const oldRow =
              typeof payload.old === 'object' && payload.old !== null
                ? (payload.old as Record<string, unknown>)
                : {}

            const invId = typeof row.id === 'string' ? row.id : ''
            if (!invId || String(row.freelancer_id) !== uid) return

            const st = String(row.status ?? '').toLowerCase()
            if (st === 'paid') {
              invalidateAlertsBadge()
              showBannerRef.current({
                id: `inv-paid-${invId}`,
                title: 'Invoice paid',
                body: String(row.title ?? row.invoice_number ?? 'Payment received'),
                onPress: () => routerRef.current.push(`/(tabs)/invoices/${invId}`),
              })
              return
            }

            const newRecvRaw = row.received_at != null ? String(row.received_at).trim() : ''
            if (!newRecvRaw) return

            let oldHadReceipt = false
            if ('received_at' in oldRow && oldRow.received_at != null) {
              oldHadReceipt = String(oldRow.received_at).trim().length > 0
            }
            if (oldHadReceipt) return

            const dedupeKey = `${invId}:${newRecvRaw}`
            const bag = receiptConfirmedDedupeRef.current
            if (bag.has(dedupeKey)) return
            if (bag.size > 128) {
              const stale = bag.values().next().value as string | undefined
              if (stale) bag.delete(stale)
            }
            bag.add(dedupeKey)

            invalidateAlertsBadge()
            const lab = String(row.invoice_project_title ?? row.title ?? row.invoice_number ?? 'Invoice').trim()
            Alert.alert(
              'Invoice receipt confirmed',
              lab
                ? `Your client confirmed receipt of «${lab}». They can pay on creaservices.de.`
                : 'Your client confirmed receipt of your invoice.',
              [
                {
                  text: 'View invoice',
                  onPress: () => routerRef.current.push(`/(tabs)/invoices/${invId}`),
                },
                { text: 'OK', style: 'cancel' },
              ]
            )
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'project_members' },
          async (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            if (String(row.profile_id) !== uid) return
            if (String(row.member_role) !== 'crew') return
            const projectId = String(row.project_id ?? '')
            if (!projectId) return
            const { data: proj } = await supabase
              .from('projects')
              .select('title, job_id, freelancer_id')
              .eq('id', projectId)
              .maybeSingle()
            const leadId = proj?.freelancer_id ? String(proj.freelancer_id) : ''
            const { data: leadProf } = leadId
              ? await supabase.from('profiles').select('name').eq('id', leadId).maybeSingle()
              : { data: null }
            const leadName = String(leadProf?.name ?? 'Project lead').trim() || 'Project lead'
            const pt = String(proj?.title ?? 'Project').trim() || 'Project'
            const hasJob = proj?.job_id != null && String(proj.job_id).length > 0
            const bannerBody = hasJob
              ? `You were added to «${pt}».`
              : `${leadName} added you to «${pt}».`
            invalidateAlertsBadge()
            showBannerRef.current({
              id: `crew-inv-${String(row.id)}`,
              title: 'Added to project',
              body: bannerBody,
              onPress: () => routerRef.current.push(`/project/${projectId}`),
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'project_messages' },
          async (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            if (String(row.sender_id) === uid) return
            const pid = typeof row.project_id === 'string' ? row.project_id : ''
            if (!pid) return
            // Prefer RPC-style access: if we can read the project, show the banner.
            // Avoid brittle multi-query membership gates that miss accepted crew.
            const { data: proj } = await supabase
              .from('projects')
              .select('title')
              .eq('id', pid)
              .maybeSingle()
            if (!proj) return
            invalidateAlertsBadge()
            const b =
              typeof row.body === 'string' && row.body.trim()
                ? row.body.trim().length > 120
                  ? `${row.body.trim().slice(0, 117)}…`
                  : row.body.trim()
                : 'New message in project chat'
            showBannerRef.current({
              id: `pm-${String(row.id)}`,
              title: String(proj.title ?? 'Project'),
              body: b,
              onPress: () => routerRef.current.push(`/project/${pid}`),
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'job_messages' },
          async (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            if (String(row.sender_id) === uid) return
            const jobId = typeof row.job_id === 'string' ? row.job_id : ''
            if (!jobId) return
            const { data: job } = await supabase.from('jobs').select('company_id, title').eq('id', jobId).maybeSingle()
            if (!job) return
            const { data: proj } = await supabase
              .from('projects')
              .select('id, title')
              .eq('job_id', jobId)
              .maybeSingle()
            // If linked project is readable under RLS, recipient is a workspace member.
            if (!proj?.id && String(job.company_id) !== uid) return
            const projectId = proj?.id ? String(proj.id) : ''
            if (!projectId && String(job.company_id) !== uid) return
            invalidateAlertsBadge()
            const raw = typeof row.content === 'string' ? row.content.trim() : ''
            const b =
              raw.length > 120 ? `${raw.slice(0, 117)}…` : raw || 'New message in project workspace'
            showBannerRef.current({
              id: `jm-${String(row.id)}`,
              title: String(proj?.title ?? job.title ?? 'Project'),
              body: b,
              onPress: () => {
                if (projectId) routerRef.current.push(`/project/${projectId}`)
              },
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'milestones' },
          async (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            const jobId = typeof row.job_id === 'string' ? row.job_id : ''
            if (!jobId) return
            const { data: proj } = await supabase
              .from('projects')
              .select('id, title')
              .eq('job_id', jobId)
              .maybeSingle()
            if (!proj?.id) return
            invalidateAlertsBadge()
            const title = String(row.title ?? '').trim() || 'Milestone'
            showBannerRef.current({
              id: `ms-${String(row.id)}`,
              title: String(proj.title ?? 'Project'),
              body: `New milestone: ${title}`,
              onPress: () => routerRef.current.push(`/project/${proj.id}`),
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'project_milestones' },
          async (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            const pid = typeof row.project_id === 'string' ? row.project_id : ''
            if (!pid) return
            const { data: proj } = await supabase.from('projects').select('title').eq('id', pid).maybeSingle()
            if (!proj) return
            invalidateAlertsBadge()
            const title = String(row.title ?? '').trim() || 'Milestone'
            showBannerRef.current({
              id: `pms-${String(row.id)}`,
              title: String(proj.title ?? 'Project'),
              body: `New milestone: ${title}`,
              onPress: () => routerRef.current.push(`/project/${pid}`),
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'jobs' },
          async (payload) => {
            if (AppState.currentState !== 'active' || !uid) return
            const row = payload.new as Record<string, unknown>
            const oldRow =
              typeof payload.old === 'object' && payload.old !== null
                ? (payload.old as Record<string, unknown>)
                : undefined
            const ps = String(row.project_status ?? '').toLowerCase()
            const prevPs = String(oldRow?.project_status ?? '').toLowerCase()
            if (ps !== 'completed' || prevPs === 'completed') return
            if (String(row.company_id) === uid) return

            const jobId = typeof row.id === 'string' ? row.id : ''
            if (!jobId) return

            const { data: proj } = await supabase
              .from('projects')
              .select('id, title')
              .eq('job_id', jobId)
              .maybeSingle()
            if (!proj?.id) return

            invalidateAlertsBadge()
            const pt = String(proj.title ?? row.title ?? 'Project').trim() || 'Project'
            showBannerRef.current({
              id: `job-completed-${jobId}`,
              title: pt,
              body: 'Project marked as completed.',
              onPress: () => routerRef.current.push(`/project/${proj.id}`),
            })
          }
        )
        .subscribe()
    }

    void setup()

    return () => {
      cancelled = true
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  if (Platform.OS === 'web' || !banner) return null

  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="box-none">
      <SafeAreaView edges={['top']} style={styles.safe}>
        <Pressable
          style={styles.banner}
          onPress={() => {
            banner.onPress?.()
            setBanner(null)
          }}
        >
          <Text style={styles.bannerTitle}>{banner.title}</Text>
          <Text style={styles.bannerBody} numberOfLines={2}>
            {banner.body}
          </Text>
        </Pressable>
      </SafeAreaView>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    elevation: 99999,
  },
  safe: { backgroundColor: 'transparent' },
  banner: {
    marginHorizontal: 12,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(26,26,26,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  bannerTitle: { color: '#FFDC00', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  bannerBody: { color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 18 },
})

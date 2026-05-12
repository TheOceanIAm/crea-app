import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { invalidateAlertsBadge } from '@/lib/invalidateAlerts'

type Banner = { id: string; title: string; body: string; onPress?: () => void }

function dmText(row: Record<string, unknown>): string {
  const raw = row.body ?? row.content ?? row.message
  return typeof raw === 'string' ? raw : ''
}

/**
 * Top-of-screen banners for realtime events while the app is open + DM previews.
 * Remote pushes stay quieter in the foreground via pushNotifications handler.
 */
export function InAppNotificationBridge() {
  const router = useRouter()
  const [banner, setBanner] = useState<Banner | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const receiptConfirmedDedupeRef = useRef(new Set<string>())

  const showBanner = (b: Banner, ms = 5200) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setBanner(b)
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start()
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
        setBanner(null)
      )
    }, ms)
  }

  useEffect(() => {
    let cancelled = false
    let uid: string | null = null

    const setup = async (): Promise<(() => void) | undefined> => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return undefined
      uid = user.id

      const channel = supabase
        .channel('in-app-banner-events')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            if (AppState.currentState !== 'active') return
            const row = payload.new as Record<string, unknown>
            if (String(row.sender_id) === uid) return
            const cid = typeof row.conversation_id === 'string' ? row.conversation_id : ''
            const preview = dmText(row)
            showBanner({
              id: `dm-${String(row.id)}`,
              title: 'New message',
              body: preview.length > 140 ? `${preview.slice(0, 137)}…` : preview || 'Open to read',
              onPress: () => {
                if (cid) router.push(`/conversation/${cid}`)
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
            showBanner({
              id: `app-${String(row.id)}`,
              title: 'New application',
              body: `Someone applied to «${String(job.title ?? 'Your project')}».`,
              onPress: () => router.push('/(tabs)/company-applications'),
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
              showBanner({
                id: `inv-${String(row.id)}`,
                title: 'Incoming invoice',
                body: String(row.title ?? row.invoice_number ?? 'New invoice'),
                onPress: () => router.push(`/(tabs)/invoices/${String(row.id)}`),
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
              showBanner({
                id: `inv-paid-${invId}`,
                title: 'Invoice paid',
                body: String(row.title ?? row.invoice_number ?? 'Payment received'),
                onPress: () => router.push(`/(tabs)/invoices/${invId}`),
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
                ? `Your client confirmed receipt of «${lab}». They can continue with CREA Pay.`
                : 'Your client confirmed receipt of your invoice.',
              [
                { text: 'View invoice', onPress: () => router.push(`/(tabs)/invoices/${invId}`) },
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
            showBanner({
              id: `crew-inv-${String(row.id)}`,
              title: 'Added to project',
              body: bannerBody,
              onPress: () => router.push(`/project/${projectId}`),
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
            const { data: m } = await supabase
              .from('project_members')
              .select('project_id')
              .eq('project_id', pid)
              .eq('profile_id', uid)
              .maybeSingle()
            if (!m) return
            invalidateAlertsBadge()
            const { data: proj } = await supabase.from('projects').select('title').eq('id', pid).maybeSingle()
            const b =
              typeof row.body === 'string' && row.body.trim()
                ? row.body.trim().length > 120
                  ? `${row.body.trim().slice(0, 117)}…`
                  : row.body.trim()
                : 'New message in project chat'
            showBanner({
              id: `pm-${String(row.id)}`,
              title: String(proj?.title ?? 'Project'),
              body: b,
              onPress: () => router.push(`/project/${pid}`),
            })
          }
        )
        .subscribe()

      return () => {
        void supabase.removeChannel(channel)
      }
    }

    let unsubscribe: (() => void) | undefined
    void setup().then((fn) => {
      unsubscribe = fn
    })

    return () => {
      cancelled = true
      if (hideTimer.current) clearTimeout(hideTimer.current)
      unsubscribe?.()
    }
  }, [opacity, router])

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
    zIndex: 9999,
    elevation: 9999,
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

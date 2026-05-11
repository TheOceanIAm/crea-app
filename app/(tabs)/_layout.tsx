import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform, StyleSheet, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { Tabs } from 'expo-router'
import { Bell, Briefcase, House, MessageCircle, UserRound } from 'lucide-react-native'
import { ICON_STROKE_TAB } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUserAndProfileTier } from '@/lib/freelancerPlan'
import { countUnreadAlerts } from '@/lib/notificationsFeed'
import { subscribeAlertsInvalidate } from '@/lib/invalidateAlerts'
import { subscribeDmBadgeInvalidate } from '@/lib/invalidateDmBadge'
import { registerPushTokenSilently } from '@/lib/registerPushOnLaunch'
import { InAppNotificationBridge } from '@/components/InAppNotificationBridge'
import { GoodNewsDailyModal } from '@/components/GoodNewsDailyModal'
import { fetchGoodNewsOfTheDayHeadline } from '@/lib/ceoLiveWidgets'
import { markGoodNewsModalShownToday, shouldShowGoodNewsModalToday } from '@/lib/goodNewsDailyGate'

/** Unique Supabase Realtime topic per subscription — reusing the same name returns an already-`subscribe()`d channel, which throws when chaining `.on()`. */
let realtimeTopicSeq = 0

export default function TabLayout() {
  const [workspaceOnlyTabs, setWorkspaceOnlyTabs] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [goodNewsPopup, setGoodNewsPopup] = useState<{ body: string; source?: string } | null>(null)
  const [unreadDmCount, setUnreadDmCount] = useState(0)
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0)
  const [companyTabs, setCompanyTabs] = useState(false)
  const unreadDmInFlight = useRef<Promise<void> | null>(null)
  const unreadAlertsInFlight = useRef<Promise<void> | null>(null)

  const loadUnreadDmCount = useCallback(async (uid: string) => {
    if (unreadDmInFlight.current) return unreadDmInFlight.current
    unreadDmInFlight.current = (async () => {
      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('id, participant_1, participant_2')
        .or(`participant_1.eq.${uid},participant_2.eq.${uid}`)
        .limit(200)
      if (convErr || !convs?.length) {
        setUnreadDmCount(0)
        return
      }
      const allIds = convs.map((c) => String(c.id))
      let ids = allIds
      const { data: archivedRows } = await supabase
        .from('conversation_archives')
        .select('conversation_id')
        .eq('user_id', uid)
        .eq('archived', true)
      if (archivedRows?.length) {
        const archived = new Set(archivedRows.map((r) => String(r.conversation_id)))
        ids = allIds.filter((id) => !archived.has(id))
      }
      if (!ids.length) {
        setUnreadDmCount(0)
        return
      }
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .in('conversation_id', ids)
        .eq('read', false)
        .neq('sender_id', uid)
      setUnreadDmCount(count ?? 0)
    })()
    try {
      await unreadDmInFlight.current
    } finally {
      unreadDmInFlight.current = null
    }
  }, [])

  const loadUnreadAlertsCount = useCallback(async (uid: string) => {
    if (unreadAlertsInFlight.current) return unreadAlertsInFlight.current
    unreadAlertsInFlight.current = (async () => {
      try {
        const n = await countUnreadAlerts(uid)
        setUnreadAlertsCount(n)
      } catch {
        setUnreadAlertsCount(0)
      }
    })()
    try {
      await unreadAlertsInFlight.current
    } finally {
      unreadAlertsInFlight.current = null
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setWorkspaceOnlyTabs(false)
        setUserId(null)
        setUnreadDmCount(0)
        setUnreadAlertsCount(0)
        return
      }
      setUserId(user.id)
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, subscription_tier')
        .eq('id', user.id)
        .maybeSingle()
      const role = resolveAppRole(profile?.role, user)
      const plan = resolveFreelancerPlanFromUserAndProfileTier(user, profile?.subscription_tier)
      const workspaceOnly = isFreelancerProfile(role) && isFreelancerWorkspaceOnlyPlan(plan)
      setWorkspaceOnlyTabs(workspaceOnly)
      setCompanyTabs(role === 'company' || role === 'ceo')
      if (!workspaceOnly) {
        await Promise.all([loadUnreadDmCount(user.id), loadUnreadAlertsCount(user.id)])
        void registerPushTokenSilently()
      }
    }
    void load()
  }, [loadUnreadAlertsCount, loadUnreadDmCount])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && userId && !workspaceOnlyTabs) {
        void loadUnreadDmCount(userId)
        void loadUnreadAlertsCount(userId)
      }
    })
    return () => sub.remove()
  }, [loadUnreadAlertsCount, loadUnreadDmCount, userId, workspaceOnlyTabs])

  useEffect(() => {
    return subscribeAlertsInvalidate(() => {
      if (userId && !workspaceOnlyTabs) void loadUnreadAlertsCount(userId)
    })
  }, [loadUnreadAlertsCount, userId, workspaceOnlyTabs])

  useEffect(() => {
    return subscribeDmBadgeInvalidate(() => {
      if (userId && !workspaceOnlyTabs) void loadUnreadDmCount(userId)
    })
  }, [loadUnreadDmCount, userId, workspaceOnlyTabs])

  /** iOS home-screen badge mirrors unread DM + Alerts (tab dots stay source of truth). */
  useEffect(() => {
    if (Platform.OS === 'web') return
    const total = unreadDmCount + unreadAlertsCount
    void Notifications.setBadgeCountAsync(total).catch(() => {})
  }, [unreadDmCount, unreadAlertsCount])

  /** First open each calendar day: uplifting headline (same source as CEO Good News widget). */
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const tryShow = async () => {
      const open = await shouldShowGoodNewsModalToday()
      if (!open || cancelled) return
      const news = await fetchGoodNewsOfTheDayHeadline()
      if (cancelled || !news) return
      setGoodNewsPopup(news)
    }
    void tryShow()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void tryShow()
    })
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [userId])

  const dismissGoodNewsPopup = useCallback(async () => {
    await markGoodNewsModalShownToday()
    setGoodNewsPopup(null)
  }, [])

  /** Polling fallback when Realtime is off or WebSocket misses events (badges stay fresh). */
  useEffect(() => {
    if (!userId || workspaceOnlyTabs) return
    const id = setInterval(() => void loadUnreadDmCount(userId), 10000)
    return () => clearInterval(id)
  }, [loadUnreadDmCount, userId, workspaceOnlyTabs])

  useEffect(() => {
    if (!userId || workspaceOnlyTabs) return
    const topic = `tabs-unread-dm-${userId}-${++realtimeTopicSeq}`
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void loadUnreadDmCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void loadUnreadDmCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_archives' }, () => {
        void loadUnreadDmCount(userId)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadUnreadDmCount, userId, workspaceOnlyTabs])

  useEffect(() => {
    if (!userId || workspaceOnlyTabs) return
    const topic = `tabs-unread-alerts-${userId}-${++realtimeTopicSeq}`
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        void loadUnreadAlertsCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_messages' }, () => {
        void loadUnreadAlertsCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_applications' }, () => {
        void loadUnreadAlertsCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        void loadUnreadAlertsCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, () => {
        void loadUnreadAlertsCount(userId)
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_alert_reads',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void loadUnreadAlertsCount(userId)
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadUnreadAlertsCount, userId, workspaceOnlyTabs])

  return (
    <View style={styles.tabsShell}>
      {Platform.OS !== 'web' ? <InAppNotificationBridge /> : null}
      <GoodNewsDailyModal
        visible={goodNewsPopup !== null}
        body={goodNewsPopup?.body ?? ''}
        source={goodNewsPopup?.source}
        onDismiss={dismissGoodNewsPopup}
      />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#111111',
            borderTopColor: 'rgba(255,255,255,0.06)',
            borderTopWidth: 1,
            height: 80,
            paddingBottom: 20,
            paddingTop: 10,
          },
          tabBarActiveTintColor: '#FFDC00',
          tabBarInactiveTintColor: 'rgba(255,255,255,0.25)',
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.5,
          },
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <House size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="jobs"
          options={{
            href: workspaceOnlyTabs || companyTabs ? null : '/(tabs)/jobs',
            title: companyTabs ? 'Projects' : 'Jobs',
            tabBarIcon: ({ color, size }) => (
              <Briefcase size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="workspace-projects"
          options={{
            href: companyTabs ? '/(tabs)/workspace-projects' : null,
            title: 'Projects',
            tabBarIcon: ({ color, size }) => (
              <Briefcase size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            href: workspaceOnlyTabs ? null : '/messages',
            title: 'Messages',
            tabBarIcon: ({ color, size }) => (
              <View>
                <MessageCircle size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
                {unreadDmCount > 0 ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -4,
                      width: 9,
                      height: 9,
                      borderRadius: 999,
                      backgroundColor: '#ff2d55',
                    }}
                  />
                ) : null}
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            href: workspaceOnlyTabs ? null : '/notifications',
            title: 'Alerts',
            tabBarIcon: ({ color, size }) => (
              <View>
                <Bell size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
                {unreadAlertsCount > 0 ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -4,
                      width: 9,
                      height: 9,
                      borderRadius: 999,
                      backgroundColor: '#ff2d55',
                    }}
                  />
                ) : null}
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <UserRound size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="invoices"
          options={{
            href: null,
            title: 'Invoices',
          }}
        />
        <Tabs.Screen
          name="availability"
          options={{
            href: null,
            title: 'Availability',
          }}
        />
        <Tabs.Screen
          name="profile-preview"
          options={{
            href: null,
            title: 'Profile preview',
          }}
        />
        <Tabs.Screen
          name="ceo-users"
          options={{
            href: null,
            title: 'CEO users',
          }}
        />
        <Tabs.Screen
          name="ceo-companies"
          options={{
            href: null,
            title: 'CEO companies',
          }}
        />
        <Tabs.Screen
          name="ceo-revenue"
          options={{
            href: null,
            title: 'CEO revenue',
          }}
        />
        <Tabs.Screen
          name="ceo-settings"
          options={{
            href: null,
            title: 'CEO settings',
          }}
        />
        <Tabs.Screen
          name="company-hub"
          options={{
            href: null,
            title: 'Company tools',
          }}
        />
        <Tabs.Screen
          name="company-post-job"
          options={{
            href: null,
            title: 'Post job',
          }}
        />
        <Tabs.Screen
          name="company-my-jobs"
          options={{
            href: null,
            title: 'My jobs',
          }}
        />
        <Tabs.Screen
          name="company-applications"
          options={{
            href: null,
            title: 'Applications',
          }}
        />
        <Tabs.Screen
          name="talent-pool"
          options={{
            href: null,
            title: 'Talent pool',
          }}
        />
      </Tabs>
    </View>
  )
}

const styles = StyleSheet.create({
  /** CREA black behind all tab scenes (avoids default white while a screen loads) */
  tabsShell: { flex: 1, backgroundColor: '#0a0a0a' },
})

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform, StyleSheet, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { Tabs } from 'expo-router'
import { Bell, Briefcase, House, LayoutDashboard, UserRound } from 'lucide-react-native'
import { useUnreadDmCount } from '@/hooks/useUnreadDmCount'
import { ICON_STROKE_TAB } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUserAndProfileTier } from '@/lib/freelancerPlan'
import { countUnreadAlerts } from '@/lib/notificationsFeed'
import { subscribeAlertsInvalidate } from '@/lib/invalidateAlerts'
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
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0)
  /** Company: workspace projects tab. Freelancer/CEO: marketplace job pool tab. */
  const [showWorkspaceProjectsTab, setShowWorkspaceProjectsTab] = useState(false)
  const [showMarketplaceJobsTab, setShowMarketplaceJobsTab] = useState(false)
  const unreadAlertsInFlight = useRef<Promise<void> | null>(null)
  const dmEnabled = Boolean(userId) && !workspaceOnlyTabs
  const { unreadDmCount } = useUnreadDmCount(userId, dmEnabled)

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
      const isCompanyAccount = role === 'company'
      setShowWorkspaceProjectsTab(isCompanyAccount)
      setShowMarketplaceJobsTab(!workspaceOnly && !isCompanyAccount)
      if (!workspaceOnly) {
        await loadUnreadAlertsCount(user.id)
      }
      if (Platform.OS !== 'web') {
        void registerPushTokenSilently()
      }
    }
    void load()
  }, [loadUnreadAlertsCount])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && userId && !workspaceOnlyTabs) {
        void loadUnreadAlertsCount(userId)
      }
    })
    return () => sub.remove()
  }, [loadUnreadAlertsCount, userId, workspaceOnlyTabs])

  useEffect(() => {
    return subscribeAlertsInvalidate(() => {
      if (userId && !workspaceOnlyTabs) void loadUnreadAlertsCount(userId)
    })
  }, [loadUnreadAlertsCount, userId, workspaceOnlyTabs])

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
        initialRouteName="feed"
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
          name="feed"
          options={{
            title: 'Feed',
            tabBarIcon: ({ color, size }) => (
              <House size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => (
              <LayoutDashboard size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="jobs"
          options={{
            href: workspaceOnlyTabs || !showMarketplaceJobsTab ? null : '/(tabs)/jobs',
            title: 'Jobs',
            tabBarIcon: ({ color, size }) => (
              <Briefcase size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="workspace-projects"
          options={{
            href: showWorkspaceProjectsTab ? '/(tabs)/workspace-projects' : null,
            title: 'Projects',
            tabBarIcon: ({ color, size }) => (
              <Briefcase size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            href: null,
            title: 'Messages',
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
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

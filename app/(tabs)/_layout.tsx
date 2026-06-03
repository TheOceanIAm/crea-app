import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, InteractionManager, Platform, StyleSheet, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { Tabs, usePathname } from 'expo-router'
import { Bell, Briefcase, House, LayoutDashboard, UserRound } from 'lucide-react-native'
import { useUnreadDmCount } from '@/hooks/useUnreadDmCount'
import { ICON_STROKE_TAB } from '@/lib/iconTheme'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { useAppBootstrapOverlay } from '@/contexts/AppBootstrapOverlayContext'
import { markGoodNewsModalShownToday, shouldShowGoodNewsModalToday } from '@/lib/goodNewsDailyGate'
import { mainTabFromPathname, writeLastMainTab } from '@/lib/appEntryRoute'
import { prefetchMainTabData } from '@/lib/prefetchTabData'
import { readBootstrapHints, writeBootstrapHints } from '@/lib/bootstrapHints'
import { hydrateDashboardOverviewFromDisk } from '@/lib/dashboardOverview'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { countUnreadAlerts } from '@/lib/notificationsFeed'
import { subscribeAlertsInvalidate } from '@/lib/invalidateAlerts'
import { registerPushTokenSilently } from '@/lib/registerPushOnLaunch'
import { InAppNotificationBridge } from '@/components/InAppNotificationBridge'
import { GoodNewsDailyModal } from '@/components/GoodNewsDailyModal'
import { fetchGoodNewsOfTheDayHeadline } from '@/lib/ceoLiveWidgets'

/** Unique Supabase Realtime topic per subscription — reusing the same name returns an already-`subscribe()`d channel, which throws when chaining `.on()`. */
let realtimeTopicSeq = 0

export default function TabLayout() {
  const pathname = usePathname()
  const { isBootstrapOverlayBlocking } = useAppBootstrapOverlay()
  const [userId, setUserId] = useState<string | null>(null)
  const [goodNewsPopup, setGoodNewsPopup] = useState<{ body: string; source?: string } | null>(null)
  const [pendingGoodNews, setPendingGoodNews] = useState<{ body: string; source?: string } | null>(null)
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0)
  /** Company: workspace projects tab. Freelancer/CEO: marketplace job pool tab. */
  const [showWorkspaceProjectsTab, setShowWorkspaceProjectsTab] = useState(false)
  const [showMarketplaceJobsTab, setShowMarketplaceJobsTab] = useState(false)
  const unreadAlertsInFlight = useRef<Promise<void> | null>(null)
  const dmEnabled = Boolean(userId)
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
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null)
    })

    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const user = await getAuthUser()
        if (!user) {
          setUserId(null)
          setUnreadAlertsCount(0)
          return
        }
        setUserId(user.id)

        const hints = await readBootstrapHints(user.id)
        const diskOverview = await hydrateDashboardOverviewFromDisk(user.id)
        const role = resolveAppRole(diskOverview?.role ?? hints?.role, user)
        const isCompanyAccount = role === 'company'
        setShowWorkspaceProjectsTab(isCompanyAccount)
        setShowMarketplaceJobsTab(isFreelancerProfile(role))

        if (!hints && !diskOverview) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role, subscription_tier, onboarding_completed')
            .eq('id', user.id)
            .maybeSingle()
          const fetchedRole = resolveAppRole(profile?.role, user)
          setShowWorkspaceProjectsTab(fetchedRole === 'company')
          setShowMarketplaceJobsTab(isFreelancerProfile(fetchedRole))
          await writeBootstrapHints(user.id, {
            role: fetchedRole,
            onboardingCompleted: profile?.onboarding_completed === true,
          })
        }

        await loadUnreadAlertsCount(user.id)
        if (Platform.OS !== 'web') {
          void registerPushTokenSilently()
        }
      })()
    })
    return () => task.cancel()
  }, [loadUnreadAlertsCount])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && userId) {
        void loadUnreadAlertsCount(userId)
      }
    })
    return () => sub.remove()
  }, [loadUnreadAlertsCount, userId])

  useEffect(() => {
    return subscribeAlertsInvalidate(() => {
      if (userId) void loadUnreadAlertsCount(userId)
    })
  }, [loadUnreadAlertsCount, userId])

  /** iOS home-screen badge mirrors unread DM + Alerts (tab dots stay source of truth). */
  useEffect(() => {
    if (Platform.OS === 'web') return
    const total = unreadDmCount + unreadAlertsCount
    void Notifications.setBadgeCountAsync(total).catch(() => {})
  }, [unreadDmCount, unreadAlertsCount])

  /** Prefetch daily headline while splash/feed load; show only after bootstrap overlay is gone. */
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const loadHeadline = async () => {
      const open = await shouldShowGoodNewsModalToday()
      if (!open || cancelled) return
      const news = await fetchGoodNewsOfTheDayHeadline()
      if (cancelled || !news) return
      setPendingGoodNews(news)
    }
    void loadHeadline()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void loadHeadline()
    })
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [userId])

  useEffect(() => {
    if (!userId || isBootstrapOverlayBlocking || !pendingGoodNews || goodNewsPopup) return
    const task = InteractionManager.runAfterInteractions(() => {
      setGoodNewsPopup(pendingGoodNews)
      setPendingGoodNews(null)
    })
    return () => task.cancel()
  }, [userId, isBootstrapOverlayBlocking, pendingGoodNews, goodNewsPopup])

  const dismissGoodNewsPopup = useCallback(async () => {
    await markGoodNewsModalShownToday()
    setGoodNewsPopup(null)
  }, [])

  useEffect(() => {
    if (!userId) return
    const tab = mainTabFromPathname(pathname)
    if (!tab) return
    void writeLastMainTab(userId, tab)
    prefetchMainTabData(userId, tab)
  }, [pathname, userId])

  useEffect(() => {
    if (!userId) return
    const topic = `tabs-unread-alerts-${userId}-${++realtimeTopicSeq}`
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        void loadUnreadAlertsCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
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
  }, [loadUnreadAlertsCount, userId])

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
          lazy: true,
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
            href: !showMarketplaceJobsTab ? null : '/(tabs)/jobs',
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

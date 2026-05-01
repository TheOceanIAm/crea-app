import { useCallback, useEffect, useState } from 'react'
import { Tabs } from 'expo-router'
import { Briefcase, House, MessageCircle, UserRound } from 'lucide-react-native'
import { View } from 'react-native'
import { ICON_STROKE_TAB } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'

export default function TabLayout() {
  const [workspaceOnlyTabs, setWorkspaceOnlyTabs] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [unreadDmCount, setUnreadDmCount] = useState(0)
  const [companyTabs, setCompanyTabs] = useState(false)

  const loadUnreadDmCount = useCallback(async (uid: string) => {
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
        return
      }
      setUserId(user.id)
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      const role = resolveAppRole(profile?.role, user)
      const workspaceOnly =
        isFreelancerProfile(role) && isFreelancerWorkspaceOnlyPlan(resolveFreelancerPlanFromUser(user))
      setWorkspaceOnlyTabs(workspaceOnly)
      setCompanyTabs(role === 'company' || role === 'ceo')
      if (!workspaceOnly) await loadUnreadDmCount(user.id)
    }
    void load()
  }, [loadUnreadDmCount])

  useEffect(() => {
    if (!userId || workspaceOnlyTabs) return
    const channel = supabase
      .channel('tabs-unread-dm')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void loadUnreadDmCount(userId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void loadUnreadDmCount(userId)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadUnreadDmCount, userId, workspaceOnlyTabs])

  return (
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
          href: workspaceOnlyTabs ? null : '/jobs',
          title: companyTabs ? 'Projects' : 'Jobs',
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
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
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
        name="workspace-projects"
        options={{
          href: null,
          title: 'Workspace projects',
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
  )
}

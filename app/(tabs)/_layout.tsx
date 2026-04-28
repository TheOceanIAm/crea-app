import { useEffect, useState } from 'react'
import { Tabs } from 'expo-router'
import { Briefcase, House, MessageCircle, UserRound } from 'lucide-react-native'
import { ICON_STROKE_TAB } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'

export default function TabLayout() {
  const [workspaceOnlyTabs, setWorkspaceOnlyTabs] = useState(false)

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setWorkspaceOnlyTabs(false)
        return
      }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      const role = resolveAppRole(profile?.role, user)
      const workspaceOnly =
        isFreelancerProfile(role) && isFreelancerWorkspaceOnlyPlan(resolveFreelancerPlanFromUser(user))
      setWorkspaceOnlyTabs(workspaceOnly)
    }
    void load()
  }, [])

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
          title: 'Jobs',
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
            <MessageCircle size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
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

import { Tabs } from 'expo-router'
import { Briefcase, LayoutGrid, MessageCircle, UserRound } from 'lucide-react-native'
import { ICON_STROKE_TAB } from '@/lib/iconTheme'

export default function TabLayout() {
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
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <LayoutGrid size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
          ),
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          tabBarIcon: ({ color, size }) => (
            <Briefcase size={size} color={color} strokeWidth={ICON_STROKE_TAB} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
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

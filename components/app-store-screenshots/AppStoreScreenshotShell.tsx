import type { ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Bell, House, LayoutDashboard, UserRound } from 'lucide-react-native'
import type { AppStoreScreenshotTab } from '@/lib/appStoreScreenshotCatalog'
import { ICON_STROKE_TAB } from '@/lib/iconTheme'

const TAB_ITEMS: { id: AppStoreScreenshotTab; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'profile', label: 'Profile' },
]

type Props = {
  activeTab: AppStoreScreenshotTab
  children: ReactNode
}

function TabIcon({ tab, color, size }: { tab: AppStoreScreenshotTab; color: string; size: number }) {
  const stroke = ICON_STROKE_TAB
  if (tab === 'feed') return <House size={size} color={color} strokeWidth={stroke} />
  if (tab === 'dashboard') return <LayoutDashboard size={size} color={color} strokeWidth={stroke} />
  if (tab === 'alerts') return <Bell size={size} color={color} strokeWidth={stroke} />
  return <UserRound size={size} color={color} strokeWidth={stroke} />
}

export function AppStoreScreenshotShell({ activeTab, children }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="app-store-screenshot-ready">
      <View style={styles.body}>{children}</View>
      <View style={styles.tabBar}>
        {TAB_ITEMS.map((tab) => {
          const active = tab.id === activeTab
          const color = active ? '#FFDC00' : 'rgba(255,255,255,0.25)'
          return (
            <View key={tab.id} style={styles.tabItem}>
              <TabIcon tab={tab.id} color={color} size={22} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
            </View>
          )
        })}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: 80,
    paddingTop: 10,
    paddingBottom: 20,
    backgroundColor: '#111111',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  tabItem: { alignItems: 'center', gap: 4, minWidth: 64 },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.25)',
  },
  tabLabelActive: { color: '#FFDC00' },
})

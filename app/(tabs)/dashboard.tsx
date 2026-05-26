import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { DashboardOverviewSection } from '@/components/DashboardOverviewSection'
import { TabScreenHeader } from '@/components/TabScreenHeader'
import { useDashboardOverview } from '@/hooks/useDashboardOverview'

export default function DashboardScreen() {
  const { overview, loading, refresh } = useDashboardOverview()
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refresh({ bustCache: true })
    setRefreshing(false)
  }, [refresh])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TabScreenHeader title="Dashboard" showMessages />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#FFDC00" />
        }
      >
        <DashboardOverviewSection
          overview={overview}
          loading={loading}
          collapsed={false}
          onToggleCollapsed={() => {}}
          showCollapseToggle={false}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
})

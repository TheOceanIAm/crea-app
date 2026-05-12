import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'

export function SkeletonBox({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.shimmerBase, style]} />
}

/** Generic row placeholders for list tabs (jobs, workspace, alerts, …). */
export function ScreenListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={styles.listShell} accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <SkeletonBox style={styles.listAvatar} />
          <View style={styles.listTextCol}>
            <SkeletonBox style={styles.lineLg} />
            <SkeletonBox style={styles.lineSm} />
            <SkeletonBox style={styles.lineMd} />
          </View>
        </View>
      ))}
    </View>
  )
}

/** Dashboard hero + compact stat placeholders. */
export function DashboardSkeleton() {
  return (
    <View style={styles.dashboardRoot} accessibilityLabel="Loading dashboard">
      <View style={styles.dashHero}>
        <SkeletonBox style={styles.dashAvatar} />
        <View style={{ flex: 1 }}>
          <SkeletonBox style={[styles.lineLg, { width: '38%' }]} />
          <View style={{ height: 12 }} />
          <SkeletonBox style={[styles.lineSm, { width: '72%' }]} />
          <SkeletonBox style={[styles.lineXs, { width: '54%', marginTop: 10 }]} />
        </View>
      </View>
      <View style={styles.dashStats}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.dashStatCard}>
            <SkeletonBox style={[styles.lineXs, { width: '55%' }]} />
            <View style={{ height: 14 }} />
            <SkeletonBox style={[styles.lineLg, { width: '40%' }]} />
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shimmerBase: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  listShell: { paddingTop: 4, gap: 12 },
  listRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 14,
  },
  listAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  listTextCol: { flex: 1, gap: 8 },
  lineLg: { height: 16, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.09)', width: '78%' },
  lineMd: { height: 12, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.06)', width: '52%' },
  lineSm: { height: 12, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.065)', width: '90%' },
  lineXs: { height: 10, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.055)', width: '36%' },

  dashboardRoot: { flex: 1, paddingHorizontal: 20 },
  dashHero: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginTop: 8 },
  dashAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  dashStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 24,
  },
  dashStatCard: {
    flex: 1,
    minWidth: 100,
    maxWidth: 180,
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
  },
})

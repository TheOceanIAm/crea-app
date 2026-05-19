import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { CreaShimmerBox, CREA_LOAD } from '@/components/CreaLoading'

/** @deprecated Prefer CreaShimmerBox */
export function SkeletonBox({ style }: { style?: StyleProp<ViewStyle> }) {
  return <CreaShimmerBox style={style} />
}

/** Generic row placeholders for list tabs (jobs, workspace, alerts, …). */
export function ScreenListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={styles.listShell} accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <CreaShimmerBox style={styles.listAvatar} />
          <View style={styles.listTextCol}>
            <CreaShimmerBox style={styles.lineLg} />
            <CreaShimmerBox style={styles.lineSm} />
            <CreaShimmerBox style={styles.lineMd} />
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
        <CreaShimmerBox style={styles.dashAvatar} />
        <View style={{ flex: 1 }}>
          <CreaShimmerBox style={[styles.lineLg, { width: '38%' }]} />
          <View style={{ height: 12 }} />
          <CreaShimmerBox style={[styles.lineSm, { width: '72%' }]} />
          <CreaShimmerBox style={[styles.lineXs, { width: '54%', marginTop: 10 }]} />
        </View>
      </View>
      <View style={styles.dashStats}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.dashStatCard}>
            <CreaShimmerBox style={[styles.lineXs, { width: '55%' }]} />
            <View style={{ height: 14 }} />
            <CreaShimmerBox style={[styles.lineLg, { width: '40%' }]} />
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  listShell: { paddingTop: 4, gap: 12 },
  listRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: CREA_LOAD.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: CREA_LOAD.accent,
    padding: 14,
  },
  listAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  listTextCol: { flex: 1, gap: 8 },
  lineLg: { height: 16, borderRadius: 6, width: '78%' },
  lineMd: { height: 12, borderRadius: 5, width: '52%' },
  lineSm: { height: 12, borderRadius: 5, width: '90%' },
  lineXs: { height: 10, borderRadius: 4, width: '36%' },

  dashboardRoot: { flex: 1, paddingHorizontal: 20 },
  dashHero: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginTop: 8 },
  dashAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
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
    backgroundColor: CREA_LOAD.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderLeftWidth: 2,
    borderLeftColor: CREA_LOAD.accent,
    padding: 14,
  },
})

import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

/** Shared loading palette — matches app shell (#0a0a0a / #FFDC00). */
export const CREA_LOAD = {
  black: '#0a0a0a',
  yellow: '#FFDC00',
  card: '#111',
  bone: 'rgba(255,255,255,0.065)',
  boneHi: 'rgba(255,255,255,0.11)',
  accent: 'rgba(255,220,0,0.22)',
  accentSoft: 'rgba(255,220,0,0.08)',
} as const

const SHIMMER_MS = 1100

/** Placeholder block with a soft yellow-tinted pulse (native driver, no extra deps). */
export function CreaShimmerBox({ style }: { style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: SHIMMER_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: SHIMMER_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  })

  return (
    <View style={[styles.shimmerShell, style]}>
      <View style={styles.shimmerBase} />
      <Animated.View style={[styles.shimmerGlow, { opacity }]} />
    </View>
  )
}

/** Compact branded spinner — same footprint as a large ActivityIndicator. */
export function CreaInlineLoader({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const d0 = useRef(new Animated.Value(0.35)).current
  const d1 = useRef(new Animated.Value(0.35)).current
  const d2 = useRef(new Animated.Value(0.35)).current
  const dotSize = size === 'sm' ? 5 : 6
  const gap = size === 'sm' ? 5 : 6

  useEffect(() => {
    const dots = [d0, d1, d2]
    const loops = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(dot, {
            toValue: 1,
            duration: 360,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.35,
            duration: 360,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      )
    )
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [d0, d1, d2])

  return (
    <View
      style={[styles.inlineRow, { gap }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {[d0, d1, d2].map((opacity, i) => (
        <Animated.View
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: CREA_LOAD.yellow,
            opacity,
          }}
        />
      ))}
    </View>
  )
}

/** Feed tab — mirrors pinboard post cards, not generic list rows. */
export function CreaFeedPostSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.feedShell} accessibilityLabel="Loading feed">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.feedCard}>
          <CreaShimmerBox style={styles.feedAvatar} />
          <View style={styles.feedCol}>
            <CreaShimmerBox style={styles.lineMeta} />
            <CreaShimmerBox style={styles.lineTitle} />
            <CreaShimmerBox style={styles.lineBody} />
            <CreaShimmerBox style={styles.lineBodyShort} />
          </View>
        </View>
      ))}
    </View>
  )
}

/** Profile tab initial load — header + menu chips, no full-screen spinner. */
export function CreaProfileTabSkeleton() {
  return (
    <View style={styles.profileShell} accessibilityLabel="Loading profile">
      <View style={styles.profileHeader}>
        <CreaShimmerBox style={styles.profileBrand} />
        <CreaShimmerBox style={styles.profileIcon} />
      </View>
      <View style={styles.profileMenu}>
        {[0, 1, 2, 3].map((i) => (
          <CreaShimmerBox key={i} style={styles.profileChip} />
        ))}
      </View>
      <View style={styles.profileCard}>
        <CreaShimmerBox style={styles.lineLg} />
        <CreaShimmerBox style={[styles.lineSm, { marginTop: 10 }]} />
        <CreaShimmerBox style={[styles.lineMd, { marginTop: 8 }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shimmerShell: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: CREA_LOAD.bone,
  },
  shimmerBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CREA_LOAD.bone,
  },
  shimmerGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CREA_LOAD.accentSoft,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedShell: { gap: 10 },
  feedCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: CREA_LOAD.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: CREA_LOAD.accent,
  },
  feedAvatar: { width: 44, height: 44, borderRadius: 22 },
  feedCol: { flex: 1, gap: 8 },
  lineMeta: { height: 10, width: '42%', borderRadius: 4 },
  lineTitle: { height: 12, width: '58%', borderRadius: 5 },
  lineBody: { height: 14, width: '92%', borderRadius: 6 },
  lineBodyShort: { height: 14, width: '70%', borderRadius: 6 },
  profileShell: { flex: 1, backgroundColor: CREA_LOAD.black, paddingHorizontal: 16, paddingTop: 8 },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  profileBrand: { height: 22, width: 72, borderRadius: 6 },
  profileIcon: { width: 28, height: 28, borderRadius: 8 },
  profileMenu: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  profileChip: { height: 34, width: 88, borderRadius: 999 },
  profileCard: {
    backgroundColor: CREA_LOAD.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: CREA_LOAD.accent,
    padding: 16,
  },
  lineLg: { height: 16, width: '48%', borderRadius: 6 },
  lineSm: { height: 12, width: '80%', borderRadius: 5 },
  lineMd: { height: 12, width: '55%', borderRadius: 5 },
})

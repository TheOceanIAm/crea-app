import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { CreaWordmark } from '@/components/CreaWordmark'

const CREA_BLACK = '#0a0a0a'
const CREA_YELLOW = '#FFDC00'

type Pt = [number, number]

/** Closed organic outline. The centroid stays fixed so only the edge travels. */
function blobPath(t: number, amp = 1): string {
  const n = 18
  const cx = 200
  const cy = 150
  const rx = 150
  const ry = 96
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    // Integer cycles only, so t and t+1 are the same shape and the edge never snaps.
    const wobble =
      1 +
      amp *
        (0.085 * Math.sin(2 * a - t * Math.PI * 2) +
          0.05 * Math.sin(3 * a + t * Math.PI * 2) +
          0.03 * Math.sin(4 * a - t * Math.PI * 4))
    pts.push([cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble])
  }
  let sx = 0
  let sy = 0
  for (const [x, y] of pts) {
    sx += x
    sy += y
  }
  const dx = cx - sx / n
  const dy = cy - sy / n
  for (const p of pts) {
    p[0] += dx
    p[1] += dy
  }
  return closedSpline(pts)
}

function closedSpline(pts: Pt[]): string {
  const m = pts.length
  const d = [`M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`]
  for (let i = 0; i < m; i++) {
    const p0 = pts[(i - 1 + m) % m]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % m]
    const p3 = pts[(i + 2) % m]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
    )
  }
  d.push('Z')
  return d.join(' ')
}

/** Scale that lets the base ellipse cover the screen from the center. */
function coverScaleFor(width: number, height: number, blobW: number, blobH: number): number {
  const halfW = (150 / 400) * blobW
  const halfH = (96 / 300) * blobH
  if (halfW <= 0 || halfH <= 0) return 1
  return Math.max(width / 2 / halfW, height / 2 / halfH) * 1.16
}

type Props = {
  quick?: boolean
  exiting?: boolean
  /** Yellow field is fully on screen. The app may mount underneath. */
  onCovered?: () => void
  onExitEnd?: () => void
}

/**
 * The blob outline loops around a fixed wordmark until loading finishes.
 * Then the blob grows into a yellow field, the wordmark fades, and the app cuts in.
 */
export function AppBootstrapLoading({ quick = false, exiting = false, onCovered, onExitEnd }: Props) {
  const { width, height } = useWindowDimensions()
  const blobW = Math.round(Math.min(width * 0.82, 480))
  const blobH = Math.round(blobW * (300 / 400))
  const wordmarkW = Math.round(blobW * 0.58)

  const intro = useRef(new Animated.Value(0)).current
  const grow = useRef(new Animated.Value(1)).current
  const mark = useRef(new Animated.Value(1)).current
  const veil = useRef(new Animated.Value(0)).current
  const reduceRef = useRef(false)
  const quickRef = useRef(quick)
  const growRef = useRef(1)
  const coverRef = useRef(1)
  const onCoveredRef = useRef(onCovered)
  const onExitEndRef = useRef(onExitEnd)
  quickRef.current = quick
  coverRef.current = coverScaleFor(width, height, blobW, blobH)
  onCoveredRef.current = onCovered
  onExitEndRef.current = onExitEnd

  const [blobD, setBlobD] = useState(() => blobPath(0))
  const [sealed, setSealed] = useState(false)

  const motion = useMemo(() => {
    const introOpacity = intro.interpolate({
      inputRange: [0, 0.45, 1],
      outputRange: [0, 1, 1],
      extrapolate: 'clamp',
    })
    const wordIn = intro.interpolate({
      inputRange: [0.35, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    })
    return {
      blobOpacity: introOpacity,
      wordOpacity: Animated.multiply(wordIn, mark),
    }
  }, [intro, mark])

  useEffect(() => {
    const id = grow.addListener(({ value }) => {
      growRef.current = value
    })
    return () => grow.removeListener(id)
  }, [grow])

  useEffect(() => {
    const fast = quickRef.current
    const period = fast ? 4200 : 5600
    const started = globalThis.performance?.now?.() ?? Date.now()
    let raf = 0
    let alive = true

    const tick = (now: number) => {
      if (!alive || reduceRef.current) return
      const t = ((now - started) % period) / period
      const target = coverRef.current
      const p = target <= 1 ? 0 : (growRef.current - 1) / (target - 1)
      const amp = Math.max(0, 1 - p * 1.35)
      setBlobD(blobPath(t, amp))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const fadeIn = Animated.timing(intro, {
      toValue: 1,
      duration: fast ? 520 : 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    })
    fadeIn.start()

    let cancelled = false
    const stopLoop = () => {
      reduceRef.current = true
      cancelAnimationFrame(raf)
    }
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return
      reduceRef.current = reduced
      if (!reduced) return
      stopLoop()
      intro.setValue(1)
    })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) => {
      reduceRef.current = reduced
      if (!reduced) return
      stopLoop()
      intro.setValue(1)
    })

    return () => {
      cancelled = true
      alive = false
      cancelAnimationFrame(raf)
      fadeIn.stop()
      sub.remove()
    }
  }, [intro])

  useEffect(() => {
    if (!exiting) {
      grow.setValue(1)
      growRef.current = 1
      mark.setValue(1)
      veil.setValue(0)
      setSealed(false)
      return
    }
    let cancelled = false
    let sealedOnce = false
    let hold: ReturnType<typeof setTimeout> | null = null
    const reduced = reduceRef.current
    const target = coverRef.current
    const holdMs = reduced ? 120 : 420
    const growMs = reduced ? 180 : quickRef.current ? 740 : 900
    const seal = () => {
      if (cancelled || sealedOnce) return
      sealedOnce = true
      setSealed(true)
      onCoveredRef.current?.()
      hold = setTimeout(() => {
        if (!cancelled) onExitEndRef.current?.()
      }, holdMs)
    }
    const anim = reduced
      ? Animated.parallel([
          Animated.timing(mark, {
            toValue: 0,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(veil, {
            toValue: 1,
            duration: 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
        ])
      : Animated.parallel([
          Animated.timing(mark, {
            toValue: 0,
            duration: 320,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(grow, {
            toValue: target,
            duration: growMs,
            easing: Easing.bezier(0.42, 0, 0.12, 1),
            useNativeDriver: false,
          }),
          Animated.sequence([
            Animated.delay(quickRef.current ? 480 : 600),
            Animated.timing(veil, {
              toValue: 1,
              duration: 220,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: false,
            }),
          ]),
        ])
    const backup = setTimeout(seal, growMs)
    anim.start(({ finished }) => {
      if (finished) seal()
    })
    return () => {
      cancelled = true
      clearTimeout(backup)
      anim.stop()
      if (hold) clearTimeout(hold)
    }
  }, [exiting, grow, mark, veil])

  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="Loading CREA">
      <View pointerEvents="none" style={styles.scrim} />
      <Animated.View
        pointerEvents="none"
        style={[styles.center, { opacity: motion.blobOpacity, transform: [{ scale: grow }] }]}
      >
        <Svg width={blobW} height={blobH} viewBox="0 0 400 300">
          <Path d={blobD} fill={CREA_YELLOW} />
        </Svg>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.center, { opacity: motion.wordOpacity }]}>
        <CreaWordmark width={wordmarkW} color={CREA_BLACK} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.scrim, styles.veil, { opacity: veil }]} />
      {sealed ? <View pointerEvents="none" style={styles.sealed} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: CREA_BLACK,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CREA_BLACK,
  },
  veil: {
    backgroundColor: CREA_YELLOW,
  },
  sealed: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CREA_YELLOW,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

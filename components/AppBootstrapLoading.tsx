import { ClimateCrisis_400Regular, useFonts } from '@expo-google-fonts/climate-crisis'
import { BlurView } from 'expo-blur'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native'

const CREA_BLACK = '#0a0a0a'
const CREA_YELLOW = '#FFDC00'

const PULSE_MS = 900
const REVEAL_MS = 700
const QUICK_REVEAL_MS = 280

function startPulseLoop(
  pulseScale: Animated.Value,
  pulseOpacity: Animated.Value,
  pulseMs: number
): Animated.CompositeAnimation {
  const ease = Easing.inOut(Easing.sin)
  const loop = Animated.loop(
    Animated.sequence([
      Animated.parallel([
        Animated.timing(pulseScale, {
          toValue: 1.08,
          duration: pulseMs,
          easing: ease,
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.62,
          duration: pulseMs,
          easing: ease,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: pulseMs,
          easing: ease,
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 1,
          duration: pulseMs,
          easing: ease,
          useNativeDriver: true,
        }),
      ]),
    ])
  )
  loop.start()
  return loop
}

/** Full-screen bootstrap: blur fades while CREA pulses from the first frame. */
export function AppBootstrapLoading({ quick = false }: { quick?: boolean }) {
  const [fontsLoaded] = useFonts({ ClimateCrisis_400Regular })
  const softReveal = useRef(new Animated.Value(0)).current
  const smearReveal = useRef(new Animated.Value(0)).current
  const pulseScale = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(1)).current
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null)

  const shadowRadius = softReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [22, 8],
  })

  const smearOpacity = smearReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  })

  useEffect(() => {
    const revealMs = quick ? QUICK_REVEAL_MS : REVEAL_MS
    const pulseMs = quick ? 650 : PULSE_MS
    const easeOut = Easing.out(Easing.cubic)
    pulseLoopRef.current?.stop?.()

    pulseLoopRef.current = startPulseLoop(pulseScale, pulseOpacity, pulseMs)

    Animated.parallel([
      Animated.timing(softReveal, {
        toValue: 1,
        duration: revealMs,
        easing: easeOut,
        useNativeDriver: false,
      }),
      Animated.timing(smearReveal, {
        toValue: 1,
        duration: revealMs,
        easing: easeOut,
        useNativeDriver: true,
      }),
    ]).start()

    return () => {
      pulseLoopRef.current?.stop?.()
      pulseScale.setValue(1)
      pulseOpacity.setValue(1)
    }
  }, [pulseOpacity, pulseScale, quick, smearReveal, softReveal])

  const logoStyle = fontsLoaded
    ? styles.logo
    : [styles.logo, { fontFamily: undefined, fontWeight: '900' as const }]

  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="Loading CREA">
      {!quick ? (
        <Animated.View style={[styles.blurPlate, { opacity: smearOpacity }]} pointerEvents="none">
          {Platform.OS === 'ios' ? (
            <BlurView intensity={100} tint="systemThinMaterialDark" style={StyleSheet.absoluteFillObject} />
          ) : Platform.OS === 'android' ? (
            <BlurView
              intensity={72}
              tint="dark"
              experimentalBlurMethod="dimezisBlurView"
              blurReductionFactor={3.25}
              style={StyleSheet.absoluteFillObject}
            />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, styles.webFallbackScrim]} />
          )}
        </Animated.View>
      ) : null}

      <View style={styles.centerPlate} pointerEvents="none">
        <Animated.View
          style={{
            transform: [{ scale: pulseScale }],
            opacity: pulseOpacity,
          }}
        >
          <Animated.Text
            style={[
              logoStyle,
              {
                textShadowColor: 'rgba(255, 220, 0, 0.85)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: shadowRadius,
              },
            ]}
            allowFontScaling={false}
          >
            CREA
          </Animated.Text>
        </Animated.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CREA_BLACK,
  },
  blurPlate: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  centerPlate: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontFamily: 'ClimateCrisis_400Regular',
    fontSize: 56,
    fontWeight: '400',
    letterSpacing: 2,
    color: CREA_YELLOW,
    textTransform: 'uppercase',
  },
  webFallbackScrim: {
    backgroundColor: 'rgba(10,10,10,0.52)',
  },
})

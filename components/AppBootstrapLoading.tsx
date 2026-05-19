import { ClimateCrisis_400Regular, useFonts } from '@expo-google-fonts/climate-crisis'
import { BlurView } from 'expo-blur'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native'

const CREA_BLACK = '#0a0a0a'
const CREA_YELLOW = '#FFDC00'

const PULSE_MS = 1100
const REVEAL_MS = 700

/** Full-screen bootstrap: native Gaussian-ish blur (BlurView) fades off over {@link REVEAL_MS}, then wordmark pulses. */
export function AppBootstrapLoading() {
  const [fontsLoaded] = useFonts({ ClimateCrisis_400Regular })
  const softReveal = useRef(new Animated.Value(0)).current
  const smearReveal = useRef(new Animated.Value(0)).current
  const pulseScale = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(1)).current
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null)

  /** Mild glow while unfocused; blur layer does most of the softness. */
  const shadowRadius = softReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  })

  const smearOpacity = smearReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  })

  useEffect(() => {
    const easeOut = Easing.out(Easing.cubic)
    pulseLoopRef.current?.stop?.()

    const runPulse = () => {
      const ease = Easing.inOut(Easing.sin)
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseScale, {
              toValue: 1.07,
              duration: PULSE_MS,
              easing: ease,
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
              toValue: 0.68,
              duration: PULSE_MS,
              easing: ease,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(pulseScale, {
              toValue: 1,
              duration: PULSE_MS,
              easing: ease,
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
              toValue: 1,
              duration: PULSE_MS,
              easing: ease,
              useNativeDriver: true,
            }),
          ]),
        ])
      )
      pulseLoopRef.current?.start?.()
    }

    Animated.parallel([
      Animated.timing(softReveal, {
        toValue: 1,
        duration: REVEAL_MS,
        easing: easeOut,
        useNativeDriver: false,
      }),
      Animated.timing(smearReveal, {
        toValue: 1,
        duration: REVEAL_MS,
        easing: easeOut,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) runPulse()
    })

    return () => {
      pulseLoopRef.current?.stop?.()
      pulseScale.setValue(1)
      pulseOpacity.setValue(1)
    }
  }, [pulseOpacity, pulseScale, smearReveal, softReveal])

  const logoStyle = fontsLoaded
    ? styles.logo
    : [styles.logo, { fontFamily: undefined, fontWeight: '900' as const }]

  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="Loading CREA">
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

      {/*
       * Full-screen blur (no clipped box → no rectangular “noise” halo).
       * iOS: true material blur; Android: expo experimental native blur where available.
       */}
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
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CREA_BLACK,
  },
  centerPlate: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurPlate: {
    ...StyleSheet.absoluteFillObject,
  },
  logo: {
    fontFamily: 'ClimateCrisis_400Regular',
    fontSize: 56,
    fontWeight: '400',
    letterSpacing: 2,
    color: CREA_YELLOW,
    textTransform: 'uppercase',
  },
  /** Web: no expo-blur – light scrim only (dev / edge). */
  webFallbackScrim: {
    backgroundColor: 'rgba(10,10,10,0.52)',
  },
})

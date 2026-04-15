import { useEffect, useState } from 'react'
import { View, Image, StyleSheet } from 'react-native'
import { Redirect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import * as SplashScreen from 'expo-splash-screen'
import { profileNeedsOnboarding } from '@/lib/onboardingGate'

const SPLASH_BG = '#FFDC00'

/** Wait until the next frame(s) so the yellow bridge view is painted before hiding the native splash. */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

export default function Index() {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<{ user: { id: string } } | null>(null)
  const [onboardingDone, setOnboardingDone] = useState(true)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const s = sessionData.session
        if (cancelled) return

        if (!s) {
          setSession(null)
          return
        }

        setSession(s)

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', s.user.id)
          .maybeSingle()

        if (cancelled) return

        if (error) {
          const msg = error.message.toLowerCase()
          if (msg.includes('onboarding_completed') || msg.includes('column')) {
            setOnboardingDone(true)
          } else {
            setOnboardingDone(true)
          }
        } else {
          setOnboardingDone(!profileNeedsOnboarding(profile))
        }
      } finally {
        if (cancelled) return
        await waitForPaint()
        await SplashScreen.hideAsync()
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  // Bridge: matches native splash (yellow + same wordmark) so the handoff is not a flash to black.
  if (loading) {
    return (
      <View style={styles.bridge}>
        <Image
          source={require('../assets/splash-wordmark.png')}
          style={styles.wordmark}
          resizeMode="contain"
        />
      </View>
    )
  }

  if (!session) {
    return <Redirect href="/login" />
  }

  if (!onboardingDone) {
    return <Redirect href="/onboarding" />
  }

  return <Redirect href="/(tabs)/dashboard" />
}

const styles = StyleSheet.create({
  bridge: {
    flex: 1,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    width: '72%',
    maxWidth: 420,
    aspectRatio: 1350 / 1080,
    maxHeight: '40%',
  },
})

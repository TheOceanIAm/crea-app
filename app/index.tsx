import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Redirect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import * as SplashScreen from 'expo-splash-screen'
import { profileNeedsOnboarding } from '@/lib/onboardingGate'

const SPLASH_BG = '#FFDC00'

/** Avoid an endless native splash if Supabase/storage never resolves (offline, bad URL, etc.). */
const SESSION_BOOTSTRAP_MS = 14_000

type SessionRace =
  | { kind: 'ok'; session: { user: { id: string } } | null }
  | { kind: 'timeout' }

async function getSessionOrTimeout(): Promise<SessionRace> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: SessionRace) => {
      if (settled) return
      settled = true
      clearTimeout(t)
      resolve(v)
    }
    const t = setTimeout(() => done({ kind: 'timeout' }), SESSION_BOOTSTRAP_MS)
    void supabase.auth
      .getSession()
      .then(({ data }) => done({ kind: 'ok', session: data.session }))
      .catch(() => done({ kind: 'ok', session: null }))
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
        const raced = await getSessionOrTimeout()
        if (cancelled) return

        if (raced.kind === 'timeout') {
          setSession(null)
          return
        }

        const s = raced.session
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
      } catch {
        if (!cancelled) setSession(null)
      } finally {
        if (cancelled) return
        // One continuous native splash (large logo via app.json plugin imageWidth) until auth is ready.
        // No second in-JS wordmark with a different scale.
        await SplashScreen.hideAsync().catch(() => {})
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  // Under the native splash: same yellow so there is no black flash if the RN view peeks through.
  if (loading) {
    return <View style={styles.bridge} />
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
  },
})

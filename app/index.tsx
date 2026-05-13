import { useEffect, useLayoutEffect, useState } from 'react'
import { View, StyleSheet, Alert } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { Redirect, useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import * as SplashScreen from 'expo-splash-screen'
import { useAppBootstrapOverlay } from '@/contexts/AppBootstrapOverlayContext'
import { resolveSessionForAppBootstrap } from '@/lib/authSession'
import { consumeInitialSupabaseAuthUrlForBootstrap } from '@/lib/authDeepLink'
import { profileNeedsOnboarding } from '@/lib/onboardingGate'

/** Avoid an endless native splash if Supabase/storage never resolves (offline, bad URL, etc.). */
const SESSION_BOOTSTRAP_MS = 14_000

type SessionRace =
  | { kind: 'ok'; session: Session | null }
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
      .then(async ({ data, error }) => {
        if (error) {
          const msg = (error.message ?? '').toLowerCase()
          if (msg.includes('invalid refresh token') || msg.includes('refresh token not found')) {
            // Stale local credentials after reinstall/session rotation: clear local auth storage and continue logged out.
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
            done({ kind: 'ok', session: null })
            return
          }
        }
        done({ kind: 'ok', session: data.session })
      })
      .catch(() => done({ kind: 'ok', session: null }))
  })
}

export default function Index() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [onboardingDone, setOnboardingDone] = useState(true)
  const { showBootstrapOverlay, hideBootstrapOverlay } = useAppBootstrapOverlay()

  useLayoutEffect(() => {
    void SplashScreen.hideAsync().catch(() => {})
  }, [])

  useEffect(() => {
    showBootstrapOverlay()
  }, [showBootstrapOverlay])

  useEffect(() => {
    if (loading) return
    if (!session || !onboardingDone) {
      hideBootstrapOverlay()
    }
  }, [loading, session, onboardingDone, hideBootstrapOverlay])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const initial = await consumeInitialSupabaseAuthUrlForBootstrap()
        if (cancelled) return

        if (
          initial.didHandle &&
          initial.result.handled &&
          initial.result.ok &&
          initial.result.destination === 'reset-password'
        ) {
          router.replace('/auth/reset-password')
          setLoading(false)
          return
        }

        if (initial.didHandle && initial.result.handled && initial.result.ok === false) {
          Alert.alert('Sign-in link', initial.result.message)
        }

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

        const sessionToUse = await resolveSessionForAppBootstrap(s)
        if (!sessionToUse) {
          if (__DEV__) {
            console.warn('[auth] Session cleared after refresh failure during bootstrap')
          }
          setSession(null)
          return
        }

        setSession(sessionToUse)

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', sessionToUse.user.id)
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
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router])

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
  bridge: { flex: 1, backgroundColor: '#0a0a0a' },
})

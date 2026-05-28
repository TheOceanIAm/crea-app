import { useEffect, useLayoutEffect, useState } from 'react'
import { View, StyleSheet, Alert } from 'react-native'
import type { Href } from 'expo-router'
import type { Session } from '@supabase/supabase-js'
import { Redirect, useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import * as SplashScreen from 'expo-splash-screen'
import { useAppBootstrapOverlay } from '@/contexts/AppBootstrapOverlayContext'
import { resolveSessionForAppBootstrap } from '@/lib/authSession'
import { consumeInitialSupabaseAuthUrlForBootstrap } from '@/lib/authDeepLink'
import { getLoggedOutEntryRoute } from '@/lib/iosAppStoreCompliance'
import { onboardingDoneFromHints, resolveAppEntryHref, resolveAppEntryTab } from '@/lib/appEntryRoute'
import { awaitBootstrapReveal, resolveBootstrapMinRevealMs, BOOTSTRAP_MIN_REVEAL_QUICK_MS } from '@/lib/bootstrapRevealGate'
import { prefetchMainTabDataAwait, hydrateMainTabFromDisk } from '@/lib/prefetchTabData'
import { runPostLoginWarmup } from '@/lib/postLoginWarmup'
import { readBootstrapHints, markFastBootstrapEnabled, readFastBootstrapEnabled } from '@/lib/bootstrapHints'

/** Cap wait for first `getSession()`; overlay hides earlier once session is known. */
const SESSION_BOOTSTRAP_MS = 8_000

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
  const [entryHref, setEntryHref] = useState<Href>('/(tabs)/feed' as Href)
  const { showBootstrapOverlay, hideBootstrapOverlay } = useAppBootstrapOverlay()

  useLayoutEffect(() => {
    void SplashScreen.hideAsync().catch(() => {})
  }, [])

  useEffect(() => {
    void (async () => {
      const fast = await readFastBootstrapEnabled()
      showBootstrapOverlay({ quick: fast })
    })()
  }, [showBootstrapOverlay])

  useEffect(() => {
    let cancelled = false

    const finishLoading = () => {
      if (cancelled) return
      setLoading(false)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) hideBootstrapOverlay()
        })
      })
      void markFastBootstrapEnabled()
    }

    const enterLoggedIn = async (sessionToUse: Session, bootstrapStartedAt: number) => {
      const uid = sessionToUse.user.id
      const [hints, entryTab, entry] = await Promise.all([
        readBootstrapHints(uid),
        resolveAppEntryTab(uid),
        resolveAppEntryHref(uid),
      ])
      const hinted = onboardingDoneFromHints(hints)

      if (cancelled) return

      const minMs = await resolveBootstrapMinRevealMs(uid, entryTab)
      showBootstrapOverlay({ quick: minMs <= BOOTSTRAP_MIN_REVEAL_QUICK_MS })

      setSession(sessionToUse)
      setEntryHref(entry)
      if (hinted === false) {
        setOnboardingDone(false)
      } else {
        setOnboardingDone(true)
      }

      await awaitBootstrapReveal({ startedAt: bootstrapStartedAt, userId: uid, entryTab })
      if (cancelled) return

      finishLoading()

      runPostLoginWarmup(sessionToUse, {
        onOnboardingResolved: (done) => {
          if (cancelled) return
          if (!done) setOnboardingDone(false)
          void resolveAppEntryHref(uid).then((href) => {
            if (!cancelled) setEntryHref(href)
          })
        },
      })
    }

    const run = async () => {
      const bootstrapStartedAt = Date.now()
      try {
        const initial = await consumeInitialSupabaseAuthUrlForBootstrap()
        if (cancelled) return

        if (
          initial.didHandle &&
          initial.result.handled &&
          initial.result.ok &&
          initial.result.destination === 'reset-password'
        ) {
          hideBootstrapOverlay()
          router.replace('/auth/reset-password')
          setLoading(false)
          return
        }

        if (initial.didHandle && initial.result.handled && initial.result.ok === false) {
          Alert.alert('Sign-in link', initial.result.message)
        }

        const raced = await getSessionOrTimeout()
        if (cancelled) return

        let rawSession: Session | null =
          raced.kind === 'timeout'
            ? (await supabase.auth.getSession()).data.session
            : raced.session

        if (!rawSession) {
          setSession(null)
          finishLoading()
          return
        }

        const sessionToUse = await resolveSessionForAppBootstrap(rawSession)
        if (!sessionToUse) {
          if (__DEV__) {
            console.warn('[auth] Session cleared after refresh failure during bootstrap')
          }
          setSession(null)
          finishLoading()
          return
        }

        void resolveAppEntryTab(sessionToUse.user.id).then(async (tab) => {
          await hydrateMainTabFromDisk(sessionToUse.user.id, tab)
          void prefetchMainTabDataAwait(sessionToUse.user.id, tab)
        })

        await enterLoggedIn(sessionToUse, bootstrapStartedAt)
      } catch {
        if (!cancelled) {
          setSession(null)
          finishLoading()
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [hideBootstrapOverlay, router, showBootstrapOverlay])

  if (loading) {
    return <View style={styles.bridge} />
  }

  if (!session) {
    return <Redirect href={getLoggedOutEntryRoute()} />
  }

  if (!onboardingDone) {
    return <Redirect href="/onboarding" />
  }

  return <Redirect href={entryHref} />
}

const styles = StyleSheet.create({
  bridge: { flex: 1, backgroundColor: '#0a0a0a' },
})

import 'react-native-gesture-handler'
import '@/lib/pushNotifications'
import { type PropsWithChildren, useEffect, useState } from 'react'
import { Linking, Alert, Platform, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StripeProvider } from '@stripe/stripe-react-native'
import { SubscriptionPaywallGate } from '@/components/SubscriptionPaywallGate'
import * as Notifications from 'expo-notifications'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { AppBootstrapOverlayProvider } from '@/contexts/AppBootstrapOverlayContext'
import { RevenueCatProvider } from '@/contexts/RevenueCatContext'
import {
  consumeInitialSupabaseAuthUrlForBootstrap,
  handleSupabaseAuthCallbackUrl,
} from '@/lib/authDeepLink'
import { isAppStoreScreenshotDeepLink } from '@/lib/appStoreScreenshotDeepLink'
import { isAppStoreScreenshotModeEnabled } from '@/lib/appStoreScreenshotMode'

SplashScreen.preventAutoHideAsync().catch(() => {})

/** Finish cold-start Supabase redirect before any route reads `getSession()` (avoids bouncing to login). */
function BootstrapAuthGate({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (isAppStoreScreenshotModeEnabled()) {
        const initial = await Linking.getInitialURL()
        if (isAppStoreScreenshotDeepLink(initial)) {
          if (!cancelled) setReady(true)
          return
        }
      }
      await consumeInitialSupabaseAuthUrlForBootstrap()
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  if (!ready) return <View style={styles.authGate} />
  return <>{children}</>
}

function AuthDeepLinkBridge() {
  const router = useRouter()
  useEffect(() => {
    const consume = async (url: string | null) => {
      if (!url) return
      const r = await handleSupabaseAuthCallbackUrl(url)
      if (r.handled && r.ok) {
        router.replace(r.destination === 'reset-password' ? '/auth/reset-password' : '/')
      } else if (r.handled && r.ok === false) {
        Alert.alert('Sign-in link', r.message)
      }
    }
    const sub = Linking.addEventListener('url', (e) => void consume(e.url))
    return () => sub.remove()
  }, [router])
  return null
}

function openDeepLinkFromPushData(
  router: ReturnType<typeof useRouter>,
  data: Record<string, unknown> | undefined,
) {
  if (!data || typeof data !== 'object') return
  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'message') {
    const cid = data.conversationId
    if (typeof cid === 'string' && cid.length > 0) router.push(`/conversation/${cid}`)
    return
  }
  if (type === 'invoice') {
    const id = data.invoiceId
    if (typeof id === 'string' && id.length > 0) router.push(`/(tabs)/invoices/${id}`)
    return
  }
  if (type === 'job_application') {
    router.push('/(tabs)/company-applications')
    return
  }
  if (type === 'workspace_ready' || type === 'project_message' || type === 'workspace_activity') {
    const pid = data.projectId
    if (typeof pid === 'string' && pid.length > 0) router.push(`/project/${pid}`)
    return
  }
  if (type === 'profile_completion') {
    router.push('/(tabs)/profile')
  }
}

/** Must live in this file (not a separate module importing expo-router) to avoid circular-init undefined bindings on Hermes. */
function PushNotificationRouter() {
  const router = useRouter()

  useEffect(() => {
    if (Platform.OS === 'web') return

    void Notifications.getLastNotificationResponseAsync().then((r) => {
      const data = r?.notification.request.content.data as Record<string, unknown> | undefined
      openDeepLinkFromPushData(router, data)
    })

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined
      openDeepLinkFromPushData(router, data)
    })
    return () => sub.remove()
  }, [router])

  return null
}

export default function RootLayout() {
  const stripePublishableKey = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim()
  return (
    <GestureHandlerRootView style={styles.root}>
      {/* urlScheme matches app.json `scheme` — iOS Payment Sheet / 3DS return to app */}
      <StripeProvider
        publishableKey={stripePublishableKey}
        merchantIdentifier="merchant.de.creaservices.app"
        urlScheme="crea"
      >
        <AppBootstrapOverlayProvider>
          <RevenueCatProvider>
            <BootstrapAuthGate>
            <AuthDeepLinkBridge />
            <SubscriptionPaywallGate />
            {Platform.OS !== 'web' ? <PushNotificationRouter /> : null}
            <StatusBar style="light" backgroundColor="#0a0a0a" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}>
            {/* Native splash is solid black until JS shows AppBootstrapLoading */}
            <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: '#0a0a0a' } }} />
            <Stack.Screen
              name="login"
              options={{
                animation: 'fade',
                animationDuration: 220,
              }}
            />
            <Stack.Screen name="register" />
            <Stack.Screen name="auth/callback" />
            <Stack.Screen name="auth/reset" />
            <Stack.Screen name="auth/reset-password" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen
              name="onboarding"
              options={{
                animation: 'fade',
                animationDuration: 220,
              }}
            />
            <Stack.Screen
              name="(tabs)"
              options={{
                animation: 'fade',
                animationDuration: 220,
              }}
            />
            <Stack.Screen name="jobs/[id]" />
            <Stack.Screen name="profile/[userId]" />
            <Stack.Screen name="conversation/[id]" />
            <Stack.Screen name="project" options={{ headerShown: false }} />
            <Stack.Screen
              name="paywall"
              options={{
                animation: 'slide_from_bottom',
                presentation: 'modal',
              }}
            />
          </Stack>
          </BootstrapAuthGate>
          </RevenueCatProvider>
        </AppBootstrapOverlayProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  /** CREA black — prevents white flash behind Stack/Tabs before screens paint */
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  authGate: { flex: 1, backgroundColor: '#0a0a0a' },
})

import 'react-native-gesture-handler'
import '@/lib/pushNotifications'
import { useEffect } from 'react'
import { Linking, Alert, Platform, StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StripeProvider } from '@stripe/stripe-react-native'
import { PushNotificationRouter } from '@/components/PushNotificationRouter'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { AppBootstrapOverlayProvider } from '@/contexts/AppBootstrapOverlayContext'
import { handleSupabaseAuthCallbackUrl } from '@/lib/authDeepLink'

SplashScreen.preventAutoHideAsync().catch(() => {})

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
    void Linking.getInitialURL().then(consume)
    const sub = Linking.addEventListener('url', (e) => void consume(e.url))
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
          <AuthDeepLinkBridge />
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
          </Stack>
        </AppBootstrapOverlayProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  /** CREA black — prevents white flash behind Stack/Tabs before screens paint */
  root: { flex: 1, backgroundColor: '#0a0a0a' },
})

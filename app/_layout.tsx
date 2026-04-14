import '@/lib/pushNotifications'
import { useEffect } from 'react'
import { Linking, Alert } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { handleSupabaseAuthCallbackUrl } from '@/lib/authDeepLink'

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
  return (
    <>
      <AuthDeepLinkBridge />
      <StatusBar style="light" backgroundColor="#0a0a0a" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="auth/reset" />
        <Stack.Screen name="auth/reset-password" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="jobs/[id]" />
        <Stack.Screen name="profile/[userId]" />
        <Stack.Screen name="project" options={{ headerShown: false }} />
      </Stack>
    </>
  )
}

import { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { consumeInitialSupabaseAuthUrlForBootstrap } from '@/lib/authDeepLink'

/**
 * Fallback route when the app opens via crea://auth/callback (e.g. email confirmation).
 * Cold-start URLs are consumed in `consumeInitialSupabaseAuthUrlForBootstrap` before navigation;
 * this screen applies the cached result when this route is the entry path.
 */
export default function AuthCallbackScreen() {
  const router = useRouter()
  const [status, setStatus] = useState('Signing you in…')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const initial = await consumeInitialSupabaseAuthUrlForBootstrap()
      if (cancelled) return
      if (initial.didHandle && initial.result.handled && initial.result.ok) {
        router.replace(initial.result.destination === 'reset-password' ? '/auth/reset-password' : '/')
        return
      }
      if (initial.didHandle && initial.result.handled && initial.result.ok === false) {
        setStatus(initial.result.message)
        setTimeout(() => {
          if (!cancelled) router.replace('/login')
        }, 2800)
        return
      }
      router.replace('/')
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color="#FFDC00" size="large" />
      <Text style={styles.text}>{status}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  text: {
    marginTop: 20,
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 20,
  },
})

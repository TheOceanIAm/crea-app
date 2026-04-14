import { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { handleSupabaseAuthCallbackUrl } from '@/lib/authDeepLink'
import { supabase } from '@/lib/supabase'

/** Cold-start target for `crea://auth/reset` (password reset from email). */
export default function AuthResetEntryScreen() {
  const router = useRouter()
  const [status, setStatus] = useState('Opening reset…')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const url = await Linking.getInitialURL()
      if (cancelled) return
      if (url) {
        const r = await handleSupabaseAuthCallbackUrl(url)
        if (r.handled && r.ok) {
          router.replace(r.destination === 'reset-password' ? '/auth/reset-password' : '/')
          return
        }
        if (r.handled && r.ok === false) {
          setStatus(r.message)
          setTimeout(() => {
            if (!cancelled) router.replace('/login')
          }, 2800)
          return
        }
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!cancelled && session) {
        router.replace('/auth/reset-password')
        return
      }
      if (!cancelled) router.replace('/forgot-password')
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

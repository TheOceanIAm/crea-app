import { useEffect, useState } from 'react'
import { Redirect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { View, ActivityIndicator } from 'react-native'
import { profileNeedsOnboarding } from '@/lib/onboardingGate'

export default function Index() {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<{ user: { id: string } } | null>(null)
  const [onboardingDone, setOnboardingDone] = useState(true)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const s = sessionData.session
      if (cancelled) return

      if (!s) {
        setSession(null)
        setLoading(false)
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

      setLoading(false)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#FFDC00" />
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

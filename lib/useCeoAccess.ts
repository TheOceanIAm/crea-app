import { useCallback, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { isCeoProfile, resolveAppRole } from '@/lib/profileRole'

/** Loads profile role; redirects to login if signed out. Returns whether CEO screens may render. */
export function useCeoAccess(): { ready: boolean; allowed: boolean } {
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (cancelled) return
        if (!user) {
          router.replace('/login')
          setReady(true)
          setAllowed(false)
          return
        }
        const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
        if (cancelled) return
        setAllowed(isCeoProfile(resolveAppRole(p?.role, user)))
        setReady(true)
      })()
      return () => {
        cancelled = true
      }
    }, [])
  )

  return { ready, allowed }
}

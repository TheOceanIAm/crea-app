import { useEffect } from 'react'
import { AppState } from 'react-native'
import { supabase } from '@/lib/supabase'

const GAP_MS = 10 * 60 * 1000
let lastAttempt = 0

async function touchLastSeen() {
  const now = Date.now()
  if (now - lastAttempt < GAP_MS) return
  lastAttempt = now

  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    lastAttempt = 0
    return
  }

  const { error } = await supabase.rpc('touch_last_seen')
  if (error) lastAttempt = now
}

/** Stamp profiles.last_seen_at when a signed-in session opens or foregrounds the app. */
export function LastSeenPing() {
  useEffect(() => {
    void touchLastSeen()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void touchLastSeen()
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void touchLastSeen()
      if (event === 'SIGNED_OUT') lastAttempt = 0
    })
    return () => {
      sub.remove()
      subscription.unsubscribe()
    }
  }, [])
  return null
}

import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

function isDefinitiveAuthFailure(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    msg.includes('invalid refresh token') ||
    msg.includes('refresh token not found') ||
    msg.includes('user not found') ||
    msg.includes('session not found')
  )
}

/**
 * Resolve the signed-in user without logging out on transient network errors.
 * Many screens used `getUser()` only; that validates over the network and can fail
 * briefly while the persisted session is still valid — which felt like random logouts.
 */
export async function getAuthUser(): Promise<User | null> {
  const { data: { session } } = await supabase.auth.getSession()
  const cachedUser = session?.user ?? null

  if (!cachedUser) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error && isDefinitiveAuthFailure(error.message ?? '')) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        return null
      }
      return user ?? null
    } catch {
      return null
    }
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (user) return user
    if (error && isDefinitiveAuthFailure(error.message ?? '')) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      return null
    }
    return cachedUser
  } catch {
    return cachedUser
  }
}

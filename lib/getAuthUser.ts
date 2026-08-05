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

/** Soft-validate JWT in the background; clear local session only on definitive Auth failures. */
function softValidateSessionInBackground(): void {
  void (async () => {
    try {
      const { error } = await supabase.auth.getUser()
      if (error && isDefinitiveAuthFailure(error.message ?? '')) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      }
    } catch {
      /* transient — keep local session */
    }
  })()
}

/**
 * Resolve the signed-in user without blocking on Auth network round-trips.
 *
 * Prefer the persisted session (local/fast). Network `getUser()` only runs when
 * there is no session, or as a background soft-validate — waiting on it made
 * Job Portal and other tabs feel 1–3s late on every focus.
 */
export async function getAuthUser(): Promise<User | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const cachedUser = session?.user ?? null

  if (cachedUser) {
    softValidateSessionInBackground()
    return cachedUser
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error && isDefinitiveAuthFailure(error.message ?? '')) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      return null
    }
    return user ?? null
  } catch {
    return null
  }
}

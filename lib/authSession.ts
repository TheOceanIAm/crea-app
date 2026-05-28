import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Same window as GoTrue `EXPIRY_MARGIN_MS` (AUTO_REFRESH_TICK_THRESHOLD × AUTO_REFRESH_TICK_DURATION_MS).
 * When remaining lifetime drops below this, the client will refresh the access token.
 */
export const SESSION_ACCESS_REFRESH_MARGIN_MS = 90_000

/** Mirrors GoTrue `_recoverAndRefresh` expiry check — used to skip redundant refreshSession() calls. */
export function sessionAccessTokenExpiresWithinMargin(session: Session): boolean {
  const exp = session.expires_at
  if (exp == null) return false
  return exp * 1000 - Date.now() < SESSION_ACCESS_REFRESH_MARGIN_MS
}

/**
 * Optional refresh after cold start: only when the access token is near expiry.
 * Reduces auth traffic and avoids extra failed-refresh console noise when the session is still valid.
 *
 * After web checkout, `user_metadata` may stay stale until the next natural refresh — acceptable tradeoff;
 * token refresh still runs when the session approaches expiry or via profile/plan flows that call refresh.
 */
export async function resolveSessionForAppBootstrap(initial: Session): Promise<Session | null> {
  if (!sessionAccessTokenExpiresWithinMargin(initial)) {
    return initial
  }

  try {
    const { data: ref, error: refErr } = await supabase.auth.refreshSession()
    if (!refErr && ref.session) {
      return ref.session
    }
  } catch {
    // fall through — keep valid cached session when refresh fails offline
  }

  const exp = initial.expires_at
  if (exp != null && exp * 1000 > Date.now()) {
    return initial
  }

  const { data: again } = await supabase.auth.getSession()
  return again.session ?? null
}

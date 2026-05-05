import { supabase } from '@/lib/supabase'
import * as Linking from 'expo-linking'

export type AuthDeepLinkDestination = 'home' | 'reset-password'

export type AuthDeepLinkResult =
  | { handled: false }
  | { handled: true; ok: true; destination: AuthDeepLinkDestination }
  | { handled: true; ok: false; message: string }

export function getAuthRedirectUrl(kind: 'callback' | 'reset'): string {
  // Force the app scheme so auth links generated in native builds stay stable.
  return Linking.createURL(`auth/${kind}`, { scheme: 'crea' })
}

function inferPasswordRecovery(
  fullUrl: string,
  fromHash: URLSearchParams,
  fromSearch: URLSearchParams
): boolean {
  const type = fromHash.get('type') || fromSearch.get('type')
  if (type === 'recovery') return true
  const u = fullUrl.toLowerCase()
  return u.includes('auth/reset')
}

/**
 * Handles Supabase redirects into the app:
 * - Email confirm / magic link → `auth/callback` (tokens in URL)
 * - Password reset → `auth/reset` (often includes `type=recovery` in the hash)
 *
 * Register the same URLs under Supabase → Authentication → Redirect URLs, e.g.
 * `crea://auth/callback` and `crea://auth/reset`
 */
export async function handleSupabaseAuthCallbackUrl(url: string): Promise<AuthDeepLinkResult> {
  const lower = url.toLowerCase()
  const looksLikeAuth =
    lower.includes('access_token=') ||
    lower.includes('refresh_token=') ||
    /[?&#]code=/.test(url) ||
    lower.includes('/auth/callback') ||
    lower.includes('/auth/reset') ||
    lower.includes('auth/reset')

  if (!looksLikeAuth) {
    return { handled: false }
  }

  try {
    const parsed = new URL(url)
    const hash = parsed.hash?.replace(/^#/, '') ?? ''
    const fromHash = new URLSearchParams(hash)
    const fromSearch = parsed.searchParams

    const recovery = inferPasswordRecovery(url, fromHash, fromSearch)

    const code = fromSearch.get('code') || fromHash.get('code')
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) return { handled: true, ok: false, message: error.message }
      return {
        handled: true,
        ok: true,
        destination: recovery ? 'reset-password' : 'home',
      }
    }

    const access_token = fromHash.get('access_token') || fromSearch.get('access_token')
    const refresh_token = fromHash.get('refresh_token') || fromSearch.get('refresh_token')
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token })
      if (error) return { handled: true, ok: false, message: error.message }
      return {
        handled: true,
        ok: true,
        destination: recovery ? 'reset-password' : 'home',
      }
    }

    return {
      handled: true,
      ok: false,
      message: 'This link is missing sign-in data. Try opening the link from your email again.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid link'
    return { handled: true, ok: false, message: msg }
  }
}

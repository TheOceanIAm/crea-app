import type { User } from '@supabase/supabase-js'

function norm(r: string | null | undefined): string {
  return String(r ?? '').trim().toLowerCase()
}

/**
 * Single place for “which role does this session have?”.
 * 1) `profiles.role` from the database
 * 2) Fallback: `user.user_metadata.role` / `user_role`, then `user.app_metadata.role`
 *    (some web apps set CEO only in auth metadata — without this, Expo shows Freelancer).
 * Prefer keeping `profiles.role` in sync in Supabase for RLS and RPCs.
 */
export function resolveAppRole(profileRole: string | null | undefined, authUser: User | null | undefined): string {
  const prof = norm(profileRole)
  const meta = readAuthMetaRole(authUser)

  if (meta === 'ceo' || prof === 'ceo') return 'ceo'
  if (prof === 'company' || meta === 'company') return 'company'
  if (prof === 'freelancer' || meta === 'freelancer') return 'freelancer'
  if (prof) return prof
  if (meta) return meta
  return ''
}

function readAuthMetaRole(user: User | null | undefined): string {
  if (!user) return ''
  const um = user.user_metadata as Record<string, unknown> | undefined
  const am = user.app_metadata as Record<string, unknown> | undefined
  const raw = um?.role ?? um?.user_role ?? am?.role
  return norm(typeof raw === 'string' ? raw : raw != null ? String(raw) : '')
}

/**
 * Matches dashboard logic: only real `company` accounts count as companies.
 * Empty/unknown `role` is treated as freelancer (same as freelancer stats).
 * `ceo` is excluded from freelancer/company product flows.
 */
export function isCeoProfile(role: string | null | undefined): boolean {
  return norm(role) === 'ceo'
}

export function isFreelancerProfile(role: string | null | undefined): boolean {
  if (isCeoProfile(role)) return false
  if (role == null || String(role).trim() === '') return true
  return norm(role) !== 'company'
}

export function isCompanyProfile(role: string | null | undefined): boolean {
  return norm(role) === 'company'
}

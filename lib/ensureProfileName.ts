import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import {
  isMeaningfulProfileName,
  nameFromAuthMetadata,
  nameFromEmailAddress,
  resolveProfileDisplayName,
} from '@/lib/resolveProfileDisplayName'

type ProfileNameRow = { name?: string | null; email?: string | null }

function pickNameToPersist(
  profile: ProfileNameRow | null | undefined,
  user: Pick<User, 'email' | 'user_metadata'>
): string | null {
  if (isMeaningfulProfileName(profile?.name)) return null

  const fromAuth = nameFromAuthMetadata(user.user_metadata as Record<string, unknown>)
  if (fromAuth) return fromAuth

  const fromEmail = nameFromEmailAddress(profile?.email ?? user.email)
  if (fromEmail) return fromEmail

  return null
}

/** Heal empty profiles.name from auth metadata or email — safe on every cold start. */
export async function ensureOwnProfileName(user: User): Promise<string> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, email')
    .eq('id', user.id)
    .maybeSingle()

  const row = profile as ProfileNameRow | null
  const toPersist = pickNameToPersist(row, user)
  if (toPersist) {
    const { error } = await supabase.from('profiles').update({ name: toPersist }).eq('id', user.id)
    if (!error) return toPersist
    if (__DEV__) console.warn('[ensureOwnProfileName]', error.message)
  }

  return resolveProfileDisplayName(row?.name, {
    authMetadata: user.user_metadata as Record<string, unknown>,
    email: row?.email ?? user.email,
    fallback: '',
  })
}

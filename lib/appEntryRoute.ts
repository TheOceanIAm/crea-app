import type { Href } from 'expo-router'
import type { User } from '@supabase/supabase-js'

import {
  readBootstrapHints,
  writeBootstrapHints,
  type BootstrapHints,
} from '@/lib/bootstrapHints'
import { profileNeedsOnboarding } from '@/lib/onboardingGate'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'

const LAST_TAB_PREFIX = 'crea:last_tab:'

/** Visible bottom-tab routes we restore on cold start. */
export const MAIN_TAB_NAMES = [
  'feed',
  'dashboard',
  'jobs',
  'workspace-projects',
  'notifications',
  'profile',
] as const

export type MainTabName = (typeof MAIN_TAB_NAMES)[number]

export function isMainTabName(value: string): value is MainTabName {
  return (MAIN_TAB_NAMES as readonly string[]).includes(value)
}

export function isMainTabAllowed(tab: MainTabName, role: string | null): boolean {
  if (tab === 'jobs') return isFreelancerProfile(role)
  if (tab === 'workspace-projects') return isCompanyProfile(role)
  return true
}

export function mainTabHref(tab: MainTabName): Href {
  return `/(tabs)/${tab}` as Href
}

export async function readLastMainTab(userId: string): Promise<MainTabName | null> {
  const stored = await readPersistedCache<string>(`${LAST_TAB_PREFIX}${userId}`)
  if (typeof stored === 'string' && isMainTabName(stored)) return stored
  return null
}

export async function writeLastMainTab(userId: string, tab: MainTabName): Promise<void> {
  await writePersistedCache(`${LAST_TAB_PREFIX}${userId}`, tab, 90 * 86_400_000)
}

/** Best tab to open after login — last visit if still valid for role, else Feed. */
export async function resolveAppEntryTab(userId: string): Promise<MainTabName> {
  const hints = await readBootstrapHints(userId)
  const role = hints?.role ?? null
  const last = await readLastMainTab(userId)
  if (last && isMainTabAllowed(last, role)) return last
  return 'feed'
}

export async function resolveAppEntryHref(userId: string): Promise<Href> {
  const tab = await resolveAppEntryTab(userId)
  return mainTabHref(tab)
}

/** Disk hint for onboarding; null = unknown (optimistic enter, verify in background). */
export function onboardingDoneFromHints(hints: BootstrapHints | null): boolean | null {
  if (!hints) return null
  return hints.onboardingCompleted
}

export async function syncBootstrapHintsFromProfile(
  userId: string,
  profile: { onboarding_completed?: boolean | null; role?: string | null; name?: string | null } | null,
  user?: User | { id: string; user_metadata?: Record<string, unknown> }
): Promise<boolean> {
  const done = !profileNeedsOnboarding(profile)
  const role = resolveAppRole(profile?.role, user ?? { id: userId })
  await writeBootstrapHints(userId, { onboardingCompleted: done, role })
  return done
}

/** Parse `/(tabs)/feed` → `feed` for persistence. */
export function mainTabFromPathname(pathname: string): MainTabName | null {
  const match = pathname.match(/\/\(tabs\)\/([^/?]+)/)
  const segment = match?.[1]
  if (!segment || !isMainTabName(segment)) return null
  return segment
}

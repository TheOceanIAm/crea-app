import { InteractionManager } from 'react-native'
import type { User } from '@supabase/supabase-js'

import { readBootstrapHints } from '@/lib/bootstrapHints'
import { readCachedDashboardOverview } from '@/lib/dashboardOverview'
import { hydrateJobsFeedFromDisk, prefetchJobsFeed } from '@/lib/jobsFeedLoad'
import { prefetchMessages, hydrateMessagesFromDisk } from '@/lib/messagesCache'
import {
  prefetchNotifications,
  hydrateNotificationsFromDisk,
} from '@/lib/notificationsCache'
import { prefetchMainTabDataAwait } from '@/lib/prefetchTabData'
import { isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { prefetchDashboardFeatures, hydrateDashboardFeaturesFromDisk } from '@/lib/prefetchDashboardFeatures'
import {
  hydrateWorkspaceProjectsFromDisk,
  prefetchWorkspaceProjects,
} from '@/lib/workspaceProjectsLoad'

let idlePrefetchStarted = false
let idleInflight: Promise<void> | null = null

function resolveRole(userId: string): string | null {
  const warmed = peekWarmedOverview()
  if (warmed?.userId === userId && warmed.role) return warmed.role
  return readCachedDashboardOverview(userId)?.role ?? null
}

async function resolveRoleAsync(userId: string, user: User): Promise<string | null> {
  const fromMem = resolveRole(userId)
  if (fromMem) return fromMem
  const hints = await readBootstrapHints(userId)
  if (hints?.role) return hints.role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  return resolveAppRole(profile?.role, user)
}

/** Hydrate secondary tab caches from disk (fast, non-blocking). */
export async function hydrateSecondaryTabsFromDisk(userId: string, role: string | null): Promise<void> {
  await Promise.all([
    hydrateNotificationsFromDisk(userId),
    hydrateMessagesFromDisk(userId),
    (() => {
      const companyOnly = isCompanyProfile(role)
      if (isFreelancerProfile(role) || companyOnly) {
        const jobsHydrate: Promise<boolean>[] = [hydrateJobsFeedFromDisk(userId, 'crea', companyOnly)]
        if (!companyOnly) {
          jobsHydrate.push(hydrateJobsFeedFromDisk(userId, 'external', false))
        }
        return Promise.all(jobsHydrate).then((hits) => hits.some(Boolean))
      }
      return false
    })(),
    (() => {
      if (isCompanyProfile(role) || isFreelancerProfile(role)) {
        return hydrateWorkspaceProjectsFromDisk(userId)
      }
      return false
    })(),
    hydrateDashboardFeaturesFromDisk(userId, role),
  ])
}

async function runSecondaryTabPrefetch(userId: string, user: User, role: string | null): Promise<void> {
  const tasks: Promise<void>[] = [
    prefetchNotifications(userId),
    prefetchMessages(userId),
    prefetchMainTabDataAwait(userId, 'dashboard'),
  ]

  if (isFreelancerProfile(role) || isCompanyProfile(role)) {
    tasks.push(prefetchJobsFeed(user, { knownRole: role }))
  }

  if (isCompanyProfile(role) || isFreelancerProfile(role)) {
    tasks.push(prefetchWorkspaceProjects(userId))
  }

  await Promise.allSettled(tasks)
  await prefetchDashboardFeatures(userId, user, role)
}

/**
 * After Feed is visible: prefetch Alerts, Messages, Projects, Jobs, Dashboard in the background.
 * Safe to call multiple times — runs once per app session.
 */
export function prefetchSecondaryTabsIdle(userId: string, role?: string | null): void {
  if (idlePrefetchStarted) return
  idlePrefetchStarted = true

  InteractionManager.runAfterInteractions(() => {
    if (idleInflight) return
    idleInflight = (async () => {
      const user = await getAuthUser()
      if (!user || user.id !== userId) return

      const resolvedRole = role ?? resolveRole(userId) ?? (await resolveRoleAsync(userId, user))

      await hydrateSecondaryTabsFromDisk(userId, resolvedRole)
      await runSecondaryTabPrefetch(userId, user, resolvedRole)
    })().finally(() => {
      idleInflight = null
    })
  })
}

/** Reset for tests / logout (optional). */
export function resetSecondaryTabPrefetchSession(): void {
  idlePrefetchStarted = false
  idleInflight = null
}

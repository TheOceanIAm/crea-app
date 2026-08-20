import type { Session } from '@supabase/supabase-js'

import { bootstrapProfileToHints, fetchAppBootstrap } from '@/lib/appBootstrapApi'
import { syncBootstrapHintsFromProfile } from '@/lib/appEntryRoute'
import { writeBootstrapHints } from '@/lib/bootstrapHints'
import {
  cacheDashboardOverview,
  hydrateDashboardOverviewFromDisk,
  loadDashboardOverview,
  persistDashboardOverviewToDisk,
} from '@/lib/dashboardOverview'
import { supabase } from '@/lib/supabase'
import { setWarmedOverview } from '@/lib/warmAppCaches'
import {
  hydrateSecondaryTabsFromDisk,
  prefetchSecondaryTabsIdle,
} from '@/lib/prefetchSecondaryTabs'
import { seedSecondaryQueriesFromMem } from '@/lib/seedQueryCaches'

type WarmupOpts = {
  onOnboardingResolved?: (done: boolean) => void
}

async function resolveOnboardingFromNetwork(
  uid: string,
  session: Session
): Promise<boolean> {
  const { payload } = await fetchAppBootstrap()
  if (payload?.profile) {
    const hints = bootstrapProfileToHints(payload.profile, session.user)
    await writeBootstrapHints(uid, {
      onboardingCompleted: hints.onboardingCompleted,
      role: hints.role,
    })
    return hints.onboardingCompleted
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('onboarding_completed, role, name')
    .eq('id', uid)
    .maybeSingle()
  // Fail closed: never treat a read error as "onboarding done".
  if (error) return false
  return syncBootstrapHintsFromProfile(uid, profile, session.user)
}

/** Background hydration after session is known — does not block first paint. */
export function runPostLoginWarmup(session: Session, opts?: WarmupOpts): void {
  const uid = session.user.id

  // Hydrate secondary tabs from disk immediately (don't wait for network overview
  // or InteractionManager) so Alerts/Messages/Jobs paint from cache on first open.
  void (async () => {
    const diskOverview = await hydrateDashboardOverviewFromDisk(uid)
    if (diskOverview) setWarmedOverview(diskOverview)
    await hydrateSecondaryTabsFromDisk(uid, diskOverview?.role ?? null)
    seedSecondaryQueriesFromMem(uid)
  })()

  void (async () => {
    const [done, overview] = await Promise.all([
      resolveOnboardingFromNetwork(uid, session),
      loadDashboardOverview(uid),
    ])

    opts?.onOnboardingResolved?.(done)

    if (overview) {
      cacheDashboardOverview(overview)
      setWarmedOverview(overview)
      void persistDashboardOverviewToDisk(overview)
      prefetchSecondaryTabsIdle(uid, overview.role)
    }
  })()
}

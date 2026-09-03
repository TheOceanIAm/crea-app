import type { User } from '@supabase/supabase-js'

import {
  hydrateAvailabilityFromDisk,
  prefetchAvailability,
} from '@/lib/availabilityCache'
import {
  hydrateCompanyApplicationsFromDisk,
  prefetchCompanyApplications,
} from '@/lib/companyApplicationsLoad'
import {
  hydrateInvoicesListFromDisk,
  prefetchInvoicesList,
} from '@/lib/invoicesListLoad'
import { isCompanyProfile, isFreelancerProfile } from '@/lib/profileRole'
import { hydrateTalentPoolFromDisk, prefetchTalentPoolData } from '@/lib/talentPoolPrefetch'
import { prefetchSettingsProfileShell } from '@/lib/settingsProfileCache'

export async function hydrateDashboardFeaturesFromDisk(userId: string, role: string | null): Promise<void> {
  const tasks: Promise<boolean | void>[] = [
    hydrateInvoicesListFromDisk(userId),
    hydrateAvailabilityFromDisk(userId),
    prefetchSettingsProfileShell(userId),
  ]
  if (isCompanyProfile(role)) {
    tasks.push(hydrateCompanyApplicationsFromDisk(userId))
  }
  await Promise.all(tasks)
  if (isCompanyProfile(role) || isFreelancerProfile(role)) {
    await hydrateTalentPoolFromDisk(userId)
  }
}

/** Prefetch screens linked from Dashboard quick actions (Company + Freelancer). */
export async function prefetchDashboardFeatures(
  userId: string,
  user: User,
  role: string | null
): Promise<void> {
  const tasks: Promise<void>[] = [prefetchInvoicesList(userId)]

  if (isCompanyProfile(role)) {
    tasks.push(prefetchCompanyApplications(userId), prefetchTalentPoolData(userId))
  }

  if (isFreelancerProfile(role)) {
    tasks.push(prefetchAvailability(userId), prefetchTalentPoolData(userId))
  }

  await Promise.allSettled(tasks)
}

export type AppStoreScreenshotTab = 'feed' | 'dashboard' | 'alerts' | 'profile'

export type AppStoreScreenshotId =
  | 'profile'
  | 'invoices'
  | 'post-project'
  | 'project-overview'
  | 'production'
  | 'availability'
  | 'talent-pool'
  | 'jobs'
  | 'messages'
  | 'booking'

export type AppStoreScreenshotEntry = {
  id: AppStoreScreenshotId
  file: string
  headline: string
  activeTab: AppStoreScreenshotTab
}

/** Order matches the current App Store Connect screenshot set. */
export const APP_STORE_SCREENSHOT_CATALOG: AppStoreScreenshotEntry[] = [
  {
    id: 'profile',
    file: '01-profile',
    headline: 'Your profile does the talking for you.',
    activeTab: 'profile',
  },
  {
    id: 'invoices',
    file: '02-invoices',
    headline: 'Send invoices the moment the job is done.',
    activeTab: 'dashboard',
  },
  {
    id: 'post-project',
    file: '03-post-project',
    headline: 'Post a project. Find your crew.',
    activeTab: 'dashboard',
  },
  {
    id: 'project-overview',
    file: '04-project-overview',
    headline: 'Your entire production, at a glance.',
    activeTab: 'dashboard',
  },
  {
    id: 'production',
    file: '05-production',
    headline: 'Every tool your production needs.',
    activeTab: 'dashboard',
  },
  {
    id: 'availability',
    file: '06-availability',
    headline: "See who's available before you reach out.",
    activeTab: 'profile',
  },
  {
    id: 'talent-pool',
    file: '07-talent-pool',
    headline: 'Find the right crew for every production.',
    activeTab: 'feed',
  },
  {
    id: 'jobs',
    file: '08-jobs',
    headline: 'Book jobs that match your skills.',
    activeTab: 'feed',
  },
  {
    id: 'messages',
    file: '09-messages',
    headline: 'Keep your crew in the loop.',
    activeTab: 'dashboard',
  },
  {
    id: 'booking',
    file: '10-booking',
    headline: 'Book a freelancer in seconds.',
    activeTab: 'feed',
  },
]

const ID_SET = new Set(APP_STORE_SCREENSHOT_CATALOG.map((e) => e.id))

export function isAppStoreScreenshotId(value: string): value is AppStoreScreenshotId {
  return ID_SET.has(value as AppStoreScreenshotId)
}

export function appStoreScreenshotEntry(id: AppStoreScreenshotId): AppStoreScreenshotEntry {
  return APP_STORE_SCREENSHOT_CATALOG.find((e) => e.id === id)!
}

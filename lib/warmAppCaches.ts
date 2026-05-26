import type { DashboardOverviewData } from '@/lib/dashboardOverview'
import type { PinboardPost } from '@/lib/pinboardFeed'

let warmedOverview: DashboardOverviewData | null = null
let warmedPinboardPosts: PinboardPost[] | null = null
let warmedPinboardUserId: string | null = null

export function setWarmedOverview(data: DashboardOverviewData | null): void {
  warmedOverview = data
}

export function consumeWarmedOverview(userId: string): DashboardOverviewData | null {
  if (!warmedOverview || warmedOverview.userId !== userId) return null
  const data = warmedOverview
  warmedOverview = null
  return data
}

export function setWarmedPinboard(userId: string, posts: PinboardPost[]): void {
  warmedPinboardUserId = userId
  warmedPinboardPosts = posts
}

export function consumeWarmedPinboard(userId: string): PinboardPost[] | null {
  if (warmedPinboardUserId !== userId || !warmedPinboardPosts?.length) return null
  const posts = warmedPinboardPosts
  warmedPinboardUserId = null
  warmedPinboardPosts = null
  return posts
}

export async function warmAppCachesForUser(userId: string): Promise<void> {
  const { hydrateDashboardOverviewFromDisk } = await import('@/lib/dashboardOverview')
  const { hydratePinboardFeedFromDisk } = await import('@/lib/pinboardFeed')

  const [overview, posts] = await Promise.all([
    hydrateDashboardOverviewFromDisk(userId),
    hydratePinboardFeedFromDisk(userId),
  ])

  if (overview) setWarmedOverview(overview)
  if (posts?.length) setWarmedPinboard(userId, posts)
}

import type { DashboardOverviewData } from '@/lib/dashboardOverview'
import type { PinboardPost } from '@/lib/pinboardFeed'

let warmedOverview: DashboardOverviewData | null = null
let warmedPinboardUserId: string | null = null
let warmedPinboardPosts: PinboardPost[] | null = null
let warmedPinboardReady = false
let warmedPinboardFetchedAt = 0

export function setWarmedOverview(data: DashboardOverviewData | null): void {
  warmedOverview = data
}

export function peekWarmedOverview(): DashboardOverviewData | null {
  return warmedOverview
}

export function consumeWarmedOverview(userId: string): DashboardOverviewData | null {
  if (!warmedOverview || warmedOverview.userId !== userId) return null
  const data = warmedOverview
  warmedOverview = null
  return data
}

/** Mark feed as prefetched during bootstrap — includes empty feeds. */
export function setWarmedPinboard(userId: string, posts: PinboardPost[]): void {
  warmedPinboardUserId = userId
  warmedPinboardPosts = posts
  warmedPinboardReady = true
  warmedPinboardFetchedAt = Date.now()
}

export function peekWarmedPinboardUserId(): string | null {
  return warmedPinboardReady ? warmedPinboardUserId : null
}

export function peekWarmedPinboard(): PinboardPost[] | null {
  if (!warmedPinboardReady) return null
  return warmedPinboardPosts ?? []
}

export function peekWarmedPinboardFetchedAt(): number {
  return warmedPinboardFetchedAt
}

export function consumeWarmedPinboard(userId: string): PinboardPost[] | null {
  if (warmedPinboardUserId !== userId || !warmedPinboardReady) return null
  const posts = warmedPinboardPosts ?? []
  warmedPinboardUserId = null
  warmedPinboardPosts = null
  warmedPinboardReady = false
  warmedPinboardFetchedAt = 0
  return posts
}

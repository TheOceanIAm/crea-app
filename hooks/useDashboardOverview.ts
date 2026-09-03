import { useCallback, useEffect } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import {
  cacheDashboardOverview,
  dashboardOverviewCacheKey,
  hydrateDashboardOverviewFromDisk,
  loadDashboardOverview,
  persistDashboardOverviewToDisk,
  readCachedDashboardOverview,
  type DashboardOverviewData,
} from '@/lib/dashboardOverview'
import { deleteCache } from '@/lib/appCache'
import {
  consumeWarmedOverview,
  peekWarmedOverview,
  peekWarmedPinboardUserId,
} from '@/lib/warmAppCaches'

const DASHBOARD_STALE_MS = 90_000

const dashboardKey = (userId: string | null) => ['dashboardOverview', userId ?? 'anon'] as const

/** Synchronously available cached overview (warm handoff → mem cache) for instant first paint. */
function readInitialOverview(): DashboardOverviewData | undefined {
  const warmed = peekWarmedOverview()
  if (warmed) return warmed
  const uid = peekWarmedPinboardUserId() ?? warmed?.userId
  if (uid) {
    const mem = readCachedDashboardOverview(uid)
    if (mem) return mem
  }
  return undefined
}

export function useDashboardOverview() {
  const initial = readInitialOverview()

  const authQuery = useQuery({
    queryKey: ['authUserId'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session?.user?.id ?? null
    },
    staleTime: 5 * 60_000,
    initialData: () => initial?.userId ?? undefined,
  })
  const userId = authQuery.data ?? null
  const enabled = Boolean(userId)

  const overviewQuery = useQuery({
    queryKey: dashboardKey(userId),
    enabled,
    staleTime: DASHBOARD_STALE_MS,
    placeholderData: (prev) => prev,
    // Show warm/mem cache instantly, but mark it stale so it revalidates on mount.
    initialData: (): DashboardOverviewData | undefined => {
      if (!userId) return undefined
      const warmed = peekWarmedOverview()
      if (warmed && warmed.userId === userId) return warmed
      return readCachedDashboardOverview(userId) ?? undefined
    },
    initialDataUpdatedAt: initial ? Date.now() : undefined,
    queryFn: async (): Promise<DashboardOverviewData | null> => {
      const next = await loadDashboardOverview(userId as string)
      if (next) {
        cacheDashboardOverview(next)
        void persistDashboardOverviewToDisk(next)
      }
      return next
    },
  })

  // Free the one-shot warm handoff, and fall back to the disk cache for instant
  // paint when nothing else is cached yet.
  useEffect(() => {
    if (!userId) return
    consumeWarmedOverview(userId)
    if (queryClient.getQueryData(dashboardKey(userId))) return
    let cancelled = false
    void hydrateDashboardOverviewFromDisk(userId).then((disk) => {
      if (!cancelled && disk && !queryClient.getQueryData(dashboardKey(userId))) {
        queryClient.setQueryData(dashboardKey(userId), disk)
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Revalidate on tab focus only if the overview has gone stale (>90s).
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void queryClient.refetchQueries({ queryKey: dashboardKey(userId), stale: true })
      }
    }, [userId]),
  )

  const refresh = useCallback(
    async (opts?: { bustCache?: boolean; force?: boolean }) => {
      if (!userId) return
      if (opts?.bustCache) deleteCache(dashboardOverviewCacheKey(userId))
      await queryClient.refetchQueries({ queryKey: dashboardKey(userId) })
    },
    [userId],
  )

  const overview = overviewQuery.data ?? null
  const loading = authQuery.isLoading || (enabled && overviewQuery.isLoading && !overview)

  return { overview, loading, refresh }
}

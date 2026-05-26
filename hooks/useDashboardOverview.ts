import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '@/lib/supabase'
import {
  cacheDashboardOverview,
  dashboardOverviewCacheKey,
  hydrateDashboardOverviewFromDisk,
  loadDashboardOverview,
  readCachedDashboardOverview,
  type DashboardOverviewData,
} from '@/lib/dashboardOverview'
import { deleteCache } from '@/lib/appCache'
import { consumeWarmedOverview } from '@/lib/warmAppCaches'

export function useDashboardOverview() {
  const [overview, setOverview] = useState<DashboardOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const initialDone = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef(0)
  const hydratedRef = useRef(false)
  const DASHBOARD_STALE_MS = 90_000

  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    let cancelled = false
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const user = session?.user
      if (!user || cancelled) return

      const warmed = consumeWarmedOverview(user.id)
      if (warmed) {
        setOverview(warmed)
        setLoading(false)
        initialDone.current = true
        lastFetchedAt.current = Date.now()
        return
      }

      const mem = readCachedDashboardOverview(user.id)
      if (mem) {
        setOverview(mem)
        setLoading(false)
        initialDone.current = true
        lastFetchedAt.current = Date.now()
        return
      }

      const disk = await hydrateDashboardOverviewFromDisk(user.id)
      if (cancelled || !disk) return
      setOverview(disk)
      setLoading(false)
      initialDone.current = true
      lastFetchedAt.current = Date.now()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async (opts?: { bustCache?: boolean; force?: boolean }) => {
    if (inFlight.current) return inFlight.current
    inFlight.current = (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) {
          setOverview(null)
          return
        }
        if (opts?.bustCache) deleteCache(dashboardOverviewCacheKey(user.id))

        const cached = readCachedDashboardOverview(user.id)
        if (
          !opts?.force &&
          !opts?.bustCache &&
          cached &&
          lastFetchedAt.current > 0 &&
          Date.now() - lastFetchedAt.current < DASHBOARD_STALE_MS
        ) {
          setOverview(cached)
          if (!initialDone.current) {
            initialDone.current = true
            setLoading(false)
          }
          return
        }

        if (!initialDone.current && cached) {
          setOverview(cached)
          setLoading(false)
          lastFetchedAt.current = Date.now()
        }

        const next = await loadDashboardOverview(user.id)
        if (next) {
          setOverview(next)
          cacheDashboardOverview(next)
          lastFetchedAt.current = Date.now()
        }
      } finally {
        if (!initialDone.current) {
          initialDone.current = true
          setLoading(false)
        }
      }
    })()
    try {
      await inFlight.current
    } finally {
      inFlight.current = null
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      if (lastFetchedAt.current > 0 && Date.now() - lastFetchedAt.current < 90_000) {
        return
      }
      void refresh()
    }, [refresh])
  )

  return { overview, loading, refresh }
}

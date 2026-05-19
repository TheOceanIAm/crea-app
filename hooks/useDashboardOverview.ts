import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '@/lib/supabase'
import {
  cacheDashboardOverview,
  dashboardOverviewCacheKey,
  loadDashboardOverview,
  readCachedDashboardOverview,
  type DashboardOverviewData,
} from '@/lib/dashboardOverview'
import { deleteCache } from '@/lib/appCache'

export function useDashboardOverview() {
  const [overview, setOverview] = useState<DashboardOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const initialDone = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async (opts?: { bustCache?: boolean }) => {
    if (inFlight.current) return inFlight.current
    inFlight.current = (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser()
        const user = auth.user
        if (!user) {
          setOverview(null)
          return
        }
        if (opts?.bustCache) deleteCache(dashboardOverviewCacheKey(user.id))

        if (!initialDone.current) {
          const cached = readCachedDashboardOverview(user.id)
          if (cached) {
            setOverview(cached)
            setLoading(false)
          }
        }

        const next = await loadDashboardOverview(user.id)
        if (next) {
          setOverview(next)
          cacheDashboardOverview(next)
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
      void refresh()
    }, [refresh])
  )

  return { overview, loading, refresh }
}

import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'

import { useRevenueCat } from '@/contexts/RevenueCatContext'
import { fetchRoleOfferingPackages } from '@/lib/revenuecat/offeringsPackages'
import { formatMonthlyYearlyPriceLine } from '@/lib/revenuecat/storeProductPrice'

export function useAppStorePlanPrices(role: 'freelancer' | 'company' | '') {
  const { configured, ready } = useRevenueCat()
  const [priceLine, setPriceLine] = useState<string | null>(null)
  const [usesCatalogFallback, setUsesCatalogFallback] = useState(false)
  const [loading, setLoading] = useState(Platform.OS === 'ios')

  const load = useCallback(async () => {
    if (Platform.OS !== 'ios' || !role) {
      setPriceLine(null)
      setLoading(false)
      return
    }
    if (!configured) {
      setPriceLine(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { packages, error } = await fetchRoleOfferingPackages(role)
      if (error || !packages.length) {
        setPriceLine(null)
        return
      }
      const formatted = formatMonthlyYearlyPriceLine(packages, role)
      setPriceLine(formatted.line)
      setUsesCatalogFallback(formatted.usesCatalogFallback)
    } catch {
      setPriceLine(null)
    } finally {
      setLoading(false)
    }
  }, [configured, role])

  useEffect(() => {
    if (!ready) return
    void load()
  }, [ready, load])

  return {
    priceLine,
    usesCatalogFallback,
    loading,
    displayPrice: priceLine ?? (loading ? 'Loading App Store pricing…' : 'App Store pricing'),
    reload: load,
  }
}

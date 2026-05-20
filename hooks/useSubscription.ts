import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { supabase } from '@/lib/supabase'
import { useRevenueCat } from '@/contexts/RevenueCatContext'
import { getSubscriptionStatus, type SubscriptionPlanKey } from '@/lib/subscriptionStatus'

export type UseSubscriptionResult = {
  isSubscribed: boolean
  currentPlan: SubscriptionPlanKey
  isLoading: boolean
  refresh: () => Promise<void>
}

export function useSubscription(): UseSubscriptionResult {
  const rc = useRevenueCat()
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlanKey>('free')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsSubscribed(false)
      setCurrentPlan('free')
      setLoading(false)
      return
    }

    const { data: pr } = await supabase
      .from('profiles')
      .select('role, subscription_tier')
      .eq('id', user.id)
      .maybeSingle()

    let companyPlan: string | null = null
    const role = String(pr?.role ?? '').toLowerCase()
    if (role === 'company') {
      const { data: cp } = await supabase
        .from('company_profiles')
        .select('subscription_plan')
        .eq('id', user.id)
        .maybeSingle()
      companyPlan = (cp as { subscription_plan?: string } | null)?.subscription_plan ?? null
    }

    if (Platform.OS === 'ios') {
      await rc.refresh()
    }

    const status = await getSubscriptionStatus({
      user,
      profile: pr,
      companySubscriptionPlan: companyPlan,
    })

    setIsSubscribed(status.isSubscribed)
    setCurrentPlan(status.currentPlan)
    setLoading(false)
  }, [rc])

  useEffect(() => {
    void refresh()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh()
    })
    return () => subscription.unsubscribe()
  }, [refresh, rc.ready, rc.isSubscribed, rc.currentPlan])

  return {
    isSubscribed,
    currentPlan,
    isLoading: loading || (Platform.OS === 'ios' && !rc.ready),
    refresh,
  }
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { Platform } from 'react-native'
import Purchases, { type CustomerInfo } from 'react-native-purchases'
import { supabase } from '@/lib/supabase'
import { revenueCatApiKey } from '@/lib/revenuecat/config'
import {
  isSubscribedFromCustomerInfo,
  resolveSubscriptionPlanFromCustomerInfo,
} from '@/lib/revenuecat/customerInfo'
import type { SubscriptionPlanKey } from '@/lib/revenuecat/config'

type RevenueCatContextValue = {
  ready: boolean
  configured: boolean
  configError: string | null
  customerInfo: CustomerInfo | null
  currentPlan: SubscriptionPlanKey
  isSubscribed: boolean
  refresh: () => Promise<void>
}

const RevenueCatContext = createContext<RevenueCatContextValue | null>(null)

const DEV_BUILD_HINT =
  'In-app subscriptions need a development build on iOS (Expo Go does not include StoreKit). Run: npx expo run:ios'

export function RevenueCatProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(Platform.OS !== 'ios')
  const [configured, setConfigured] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null)
  const configuredRef = useRef(false)

  const applyCustomerInfo = useCallback((info: CustomerInfo) => {
    setCustomerInfo(info)
  }, [])

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'ios' || !configuredRef.current) return
    try {
      const info = await Purchases.getCustomerInfo()
      applyCustomerInfo(info)
    } catch (e) {
      console.warn('[RevenueCat] getCustomerInfo failed', e)
    }
  }, [applyCustomerInfo])

  useEffect(() => {
    if (Platform.OS !== 'ios') return

    let cancelled = false

    const listener = (info: CustomerInfo) => {
      if (!cancelled) applyCustomerInfo(info)
    }

    const configure = async () => {
      const apiKey = revenueCatApiKey()
      if (!apiKey) {
        setConfigError('Missing EXPO_PUBLIC_REVENUECAT_IOS_API_KEY.')
        setReady(true)
        return
      }
      try {
        Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.WARN)
        await Purchases.configure({ apiKey })
        if (!Purchases.isConfigured()) {
          throw new Error(DEV_BUILD_HINT)
        }
        configuredRef.current = true
        setConfigured(true)
        setConfigError(null)
        Purchases.addCustomerInfoUpdateListener(listener)

        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (session?.user?.id) {
          const { customerInfo: loggedIn } = await Purchases.logIn(session.user.id)
          if (!cancelled) applyCustomerInfo(loggedIn)
        } else {
          const info = await Purchases.getCustomerInfo()
          if (!cancelled) applyCustomerInfo(info)
        }

        if (!cancelled) setReady(true)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'RevenueCat configure failed'
        console.warn('[RevenueCat] configure failed', e)
        if (!cancelled) {
          setConfigError(message.includes('StoreKit') ? message : `${message}. ${DEV_BUILD_HINT}`)
          setReady(true)
        }
      }
    }

    void configure()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!configuredRef.current) return
      try {
        if (session?.user?.id) {
          const { customerInfo: info } = await Purchases.logIn(session.user.id)
          applyCustomerInfo(info)
        } else {
          await Purchases.logOut()
          setCustomerInfo(null)
        }
      } catch (e) {
        console.warn('[RevenueCat] auth sync failed', e)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
      if (configuredRef.current) {
        Purchases.removeCustomerInfoUpdateListener(listener)
      }
    }
  }, [applyCustomerInfo])

  const currentPlan = useMemo(
    () => resolveSubscriptionPlanFromCustomerInfo(customerInfo),
    [customerInfo]
  )
  const isSubscribed = useMemo(() => isSubscribedFromCustomerInfo(customerInfo), [customerInfo])

  const value = useMemo(
    () => ({
      ready,
      configured,
      configError,
      customerInfo,
      currentPlan,
      isSubscribed,
      refresh,
    }),
    [ready, configured, configError, customerInfo, currentPlan, isSubscribed, refresh]
  )

  return <RevenueCatContext.Provider value={value}>{children}</RevenueCatContext.Provider>
}

export function useRevenueCat(): RevenueCatContextValue {
  const ctx = useContext(RevenueCatContext)
  if (!ctx) {
    return {
      ready: true,
      configured: false,
      configError: DEV_BUILD_HINT,
      customerInfo: null,
      currentPlan: 'free',
      isSubscribed: false,
      refresh: async () => {},
    }
  }
  return ctx
}

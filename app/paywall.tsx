import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import Purchases, {
  PURCHASES_ERROR_CODE,
  type PurchasesError,
  type PurchasesPackage,
} from 'react-native-purchases'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { openPrivacy, openTerms } from '@/lib/creaLegal'
import { useSubscription } from '@/hooks/useSubscription'
import { useRevenueCat } from '@/contexts/RevenueCatContext'
import {
  RC_DEFAULT_OFFERING_ID,
  RC_PACKAGE_AGENCY,
  RC_PACKAGE_PRO,
  RC_PACKAGE_STARTER,
  RC_PACKAGE_STUDIO,
  RC_PACKAGE_TO_PRODUCT,
  type SubscriptionPlanKey,
} from '@/lib/revenuecat/config'
import { resolveAppRole } from '@/lib/profileRole'
import {
  offeringsEmptyMessage,
  offeringsLoadErrorMessage,
  purchasesUnavailableUserMessage,
} from '@/lib/revenuecat/purchasesEnvironment'

type PlanCard = {
  key: SubscriptionPlanKey
  packageKey: string
  title: string
  description: string
}

const FREELANCER_PLANS: PlanCard[] = [
  {
    key: 'pro',
    packageKey: RC_PACKAGE_PRO,
    title: 'Pro',
    description:
      'Apply to jobs, post listings, full Workspace, Sun Planner, Brief AI, and Invoicing. €8.99/mo or €59.99/yr.',
  },
]

const COMPANY_PLANS: PlanCard[] = [
  {
    key: 'pro',
    packageKey: RC_PACKAGE_AGENCY,
    title: 'Pro',
    description:
      'Unlimited listings & pool, 2 team seats included, all hiring tools. €89/mo or €649.99/yr.',
  },
]

function isPurchaseCancelled(error: PurchasesError): boolean {
  return error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
}

export default function PaywallScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { refresh, currentPlan } = useSubscription()
  const { ready, configured, configError } = useRevenueCat()
  const [role, setRole] = useState<'freelancer' | 'company' | ''>('')
  const [packages, setPackages] = useState<PurchasesPackage[]>([])
  const [loadingOfferings, setLoadingOfferings] = useState(true)
  const [busyPackageId, setBusyPackageId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const planCards = useMemo(
    () => (role === 'company' ? COMPANY_PLANS : FREELANCER_PLANS),
    [role]
  )

  const loadOfferings = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      setLoadError('In-app subscriptions are only available on iOS.')
      setLoadingOfferings(false)
      return
    }
    if (!configured) {
      setLoadError(configError || purchasesUnavailableUserMessage())
      setLoadingOfferings(false)
      return
    }
    setLoadingOfferings(true)
    setLoadError(null)
    try {
      const offerings = await Purchases.getOfferings()
      const offering =
        offerings.all[RC_DEFAULT_OFFERING_ID] ?? offerings.current ?? null
      setPackages(offering?.availablePackages ?? [])
      if (!offering?.availablePackages?.length) {
        setLoadError(offeringsEmptyMessage())
      }
    } catch (e) {
      setLoadError(offeringsLoadErrorMessage(e))
    } finally {
      setLoadingOfferings(false)
    }
  }, [configured, configError])

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const { data: pr } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()
        const r = resolveAppRole(pr?.role, user)
        setRole(r === 'company' ? 'company' : 'freelancer')
      } else {
        setRole('freelancer')
      }
    })()
  }, [])

  useEffect(() => {
    if (!ready) return
    void loadOfferings()
  }, [ready, loadOfferings])

  const packageForCard = useCallback(
    (packageKey: string) => {
      const productId = RC_PACKAGE_TO_PRODUCT[packageKey]
      return packages.find(
        (p) =>
          p.identifier === packageKey ||
          (productId && p.product.identifier === productId)
      )
    },
    [packages]
  )

  const purchase = async (pkg: PurchasesPackage, planKey: SubscriptionPlanKey) => {
    if (!configured) {
      Alert.alert('Unavailable', configError || 'Subscriptions are not available in this build.')
      return
    }
    setBusyPackageId(pkg.identifier)
    try {
      await Purchases.purchasePackage(pkg)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await refresh()
        router.replace('/(tabs)/feed')
      } else {
        router.replace({
          pathname: '/register',
          params: { fromPurchase: 'true', plan: planKey },
        })
      }
    } catch (e) {
      const err = e as PurchasesError
      if (isPurchaseCancelled(err)) return
      Alert.alert('Purchase failed', err.message || 'Something went wrong. Please try again.')
    } finally {
      setBusyPackageId(null)
    }
  }

  const restore = async () => {
    if (!configured) {
      Alert.alert('Unavailable', configError || 'Subscriptions are not available in this build.')
      return
    }
    setRestoring(true)
    try {
      await Purchases.restorePurchases()
      await refresh()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      Alert.alert('Restored', 'Your purchases were restored.', [
        {
          text: 'OK',
          onPress: () => {
            if (user) router.replace('/(tabs)/feed')
            else router.replace('/register')
          },
        },
      ])
    } catch (e) {
      const err = e as PurchasesError
      Alert.alert('Restore failed', err.message || 'No purchases found for this Apple ID.')
    } finally {
      setRestoring(false)
    }
  }

  const canGoBack = router.canGoBack()

  const goBack = useCallback(() => {
    if (canGoBack) router.back()
  }, [canGoBack, router])

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        {canGoBack ? (
          <TouchableOpacity onPress={goBack} hitSlop={12}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title}>Choose your plan</Text>
        <Text style={styles.subtitle}>CREA Services — subscribe with your Apple ID</Text>
      </View>

      <View style={styles.trialBanner}>
        <Text style={styles.trialBannerText}>
          New subscribers: <Text style={styles.trialStrong}>3 months free</Text>, then billed monthly
          through Apple.
        </Text>
      </View>

      {loadingOfferings ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#FFDC00" />
          <Text style={styles.loadingText}>Loading plans from the App Store…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => void loadOfferings()}>
            <Text style={styles.secondaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {planCards.map((card) => {
            const pkg = packageForCard(card.packageKey)
            const price = pkg?.product.priceString ?? '—'
            const isCurrent = currentPlan === card.key
            const busy = busyPackageId === pkg?.identifier
            return (
              <View key={card.key} style={[styles.card, isCurrent && styles.cardCurrent]}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  {isCurrent ? (
                    <View style={styles.currentPill}>
                      <Text style={styles.currentPillText}>CURRENT</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardPrice}>{price}</Text>
                <Text style={styles.cardTerm}>1 month, auto-renewing subscription</Text>
                <Text style={styles.cardDesc}>{card.description}</Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, (!pkg || busy || isCurrent) && styles.btnDisabled]}
                  disabled={!pkg || busy || isCurrent}
                  onPress={() => pkg && void purchase(pkg, card.key)}
                >
                  <Text style={styles.primaryBtnText}>
                    {isCurrent ? 'Active' : busy ? 'Processing…' : 'Subscribe'}
                  </Text>
                </TouchableOpacity>
              </View>
            )
          })}

          <Text style={styles.legal}>
            Payment is charged to your Apple ID at confirmation. Subscriptions auto-renew each month until
            cancelled in Settings → Apple ID → Subscriptions at least 24 hours before the end of the current period.
          </Text>

          <View style={styles.legalLinks}>
            <TouchableOpacity onPress={openTerms} hitSlop={8}>
              <Text style={styles.legalLink}>Terms of Use (EULA)</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity onPress={openPrivacy} hitSlop={8}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.guestHint}>
            No account required to subscribe. After purchase you can create an account to sync your subscription
            across devices — or log in if you already have one.
          </Text>

          <TouchableOpacity onPress={() => router.push('/login')} hitSlop={8}>
            <Text style={styles.loginLink}>Already have an account? Log in</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, restoring && styles.btnDisabled]}
            disabled={restoring}
            onPress={() => void restore()}
          >
            <Text style={styles.secondaryBtnText}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  back: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginBottom: 12 },
  title: {
    color: '#FFDC00',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 6 },
  trialBanner: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
    backgroundColor: 'rgba(255,220,0,0.06)',
    padding: 12,
  },
  trialBannerText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18 },
  trialStrong: { color: '#FFDC00', fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    padding: 16,
  },
  cardCurrent: { borderColor: 'rgba(255,220,0,0.35)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  currentPill: {
    backgroundColor: 'rgba(255,220,0,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  currentPillText: { color: '#FFDC00', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  cardPrice: { color: '#FFDC00', fontSize: 22, fontWeight: '800', marginTop: 8 },
  cardTerm: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 4 },
  cardDesc: { color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 18, marginTop: 8 },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  secondaryBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryBtnText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.45 },
  legal: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  legalLink: { color: '#FFDC00', fontSize: 12, fontWeight: '600' },
  legalDot: { color: 'rgba(255,255,255,0.25)', fontSize: 12 },
  guestHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 8,
  },
  loginLink: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  errorText: { color: '#f87171', fontSize: 13, textAlign: 'center' },
})

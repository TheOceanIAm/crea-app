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
    description: 'Apply to jobs, post listings, full Workspace, Sun Planner, Brief AI, and Invoicing.',
  },
]

const COMPANY_PLANS: PlanCard[] = [
  {
    key: 'pro',
    packageKey: RC_PACKAGE_AGENCY,
    title: 'Pro',
    description: 'Unlimited listings & pool, 2 team seats included, all hiring tools.',
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
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null)
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

  const availableOptions = useMemo(() => {
    const packageKey =
      role === 'company'
        ? COMPANY_PLANS[0]?.packageKey ?? RC_PACKAGE_AGENCY
        : FREELANCER_PLANS[0]?.packageKey ?? RC_PACKAGE_PRO
    const primaryProductId = RC_PACKAGE_TO_PRODUCT[packageKey]
    const matching = packages.filter((pkg) => {
      if (pkg.identifier === packageKey) return true
      if (primaryProductId && pkg.product.identifier === primaryProductId) return true
      return false
    })
    const filtered = matching.length ? matching : packages

    const rank = (pkg: PurchasesPackage) => {
      const type = (pkg.packageType || '').toLowerCase()
      if (type.includes('annual') || type.includes('year')) return 0
      if (type.includes('monthly') || type.includes('month')) return 1
      return 2
    }

    return [...filtered].sort((a, b) => rank(a) - rank(b))
  }, [packages, role])

  useEffect(() => {
    if (!availableOptions.length) {
      setSelectedPackageId(null)
      return
    }
    if (!selectedPackageId || !availableOptions.some((pkg) => pkg.identifier === selectedPackageId)) {
      setSelectedPackageId(availableOptions[0]?.identifier ?? null)
    }
  }, [availableOptions, selectedPackageId])

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
  const selectedPackage = availableOptions.find((pkg) => pkg.identifier === selectedPackageId) ?? null
  const selectedPlan = planCards[0]
  const selectedPackageType = (selectedPackage?.packageType || '').toLowerCase()
  const ctaLabel = selectedPackageType.includes('annual') || selectedPackageType.includes('year')
    ? 'Get Pro Yearly'
    : 'Get Pro'

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
          New subscribers: <Text style={styles.trialStrong}>3 months free</Text> trial with your Apple ID.
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
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{selectedPlan?.title ?? 'Pro'}</Text>
              {currentPlan === 'pro' ? (
                <View style={styles.currentPill}>
                  <Text style={styles.currentPillText}>CURRENT</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.cardDesc}>{selectedPlan?.description ?? 'Unlock full access in CREA.'}</Text>

            {availableOptions.map((pkg) => {
              const isSelected = selectedPackageId === pkg.identifier
              const isBusy = busyPackageId === pkg.identifier
              const type = (pkg.packageType || '').toLowerCase()
              const cadence = type.includes('annual') || type.includes('year') ? 'Yearly' : 'Monthly'
              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                  onPress={() => setSelectedPackageId(pkg.identifier)}
                  disabled={isBusy}
                >
                  <View>
                    <Text style={styles.optionLabel}>{cadence}</Text>
                    <Text style={styles.optionSub}>
                      {type.includes('annual') || type.includes('year') ? 'Auto-renewing yearly' : 'Auto-renewing monthly'}
                    </Text>
                  </View>
                  <Text style={styles.optionPrice}>{pkg.product.priceString}</Text>
                </TouchableOpacity>
              )
            })}

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (!selectedPackage || currentPlan === 'pro' || !!busyPackageId) && styles.btnDisabled,
              ]}
              disabled={!selectedPackage || currentPlan === 'pro' || !!busyPackageId}
              onPress={() => selectedPackage && selectedPlan && void purchase(selectedPackage, selectedPlan.key)}
            >
              <Text style={styles.primaryBtnText}>
                {currentPlan === 'pro' ? 'Active' : busyPackageId ? 'Processing…' : ctaLabel}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.legal}>
            Payment is charged to your Apple ID at confirmation. Subscription auto-renews unless canceled at
            least 24 hours before the current period ends.
          </Text>

          <View style={styles.legalLinks}>
            <TouchableOpacity onPress={openTerms} hitSlop={8}>
              <Text style={styles.legalLink}>Terms of service</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity onPress={openPrivacy} hitSlop={8}>
              <Text style={styles.legalLink}>Privacy policy</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity
              disabled={restoring}
              onPress={() => void restore()}
              hitSlop={8}
            >
              <Text style={styles.legalLink}>{restoring ? 'Restoring…' : 'Restore'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push('/login')} hitSlop={8}>
            <Text style={styles.loginLink}>Already have an account? Log in</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  back: { color: 'rgba(250,246,234,0.5)', fontSize: 14, marginBottom: 12 },
  title: {
    color: '#FFDC00',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: { color: 'rgba(250,246,234,0.52)', fontSize: 13, marginTop: 6 },
  trialBanner: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
    backgroundColor: 'rgba(255,220,0,0.06)',
    padding: 12,
  },
  trialBannerText: { color: 'rgba(250,246,234,0.72)', fontSize: 12, lineHeight: 18 },
  trialStrong: { color: '#FFDC00', fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(250,246,234,0.12)',
    backgroundColor: '#12150f',
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  cardCurrent: { borderColor: 'rgba(255,220,0,0.55)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#faf6ea', fontSize: 18, fontWeight: '700' },
  currentPill: {
    backgroundColor: 'rgba(255,220,0,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  currentPillText: { color: '#FFDC00', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  cardDesc: { color: 'rgba(250,246,234,0.62)', fontSize: 13, lineHeight: 20, marginTop: 8 },
  optionRow: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,246,234,0.14)',
    backgroundColor: '#0c0f0a',
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionRowSelected: {
    borderColor: 'rgba(255,220,0,0.95)',
    shadowColor: '#FFDC00',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  optionLabel: { color: '#faf6ea', fontSize: 16, fontWeight: '600' },
  optionSub: { color: 'rgba(250,246,234,0.48)', fontSize: 12, marginTop: 2 },
  optionPrice: { color: '#faf6ea', fontSize: 18, fontWeight: '700' },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 17 },
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
    color: 'rgba(250,246,234,0.4)',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    textAlign: 'center',
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  legalLink: {
    color: 'rgba(250,246,234,0.58)',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  legalDot: { color: 'rgba(250,246,234,0.25)', fontSize: 12 },
  loginLink: {
    color: 'rgba(250,246,234,0.74)',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 4,
    fontWeight: '500',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  errorText: { color: '#f87171', fontSize: 13, textAlign: 'center' },
})

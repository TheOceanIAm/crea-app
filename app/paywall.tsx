import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  ImageBackground,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import Purchases, {
  PURCHASES_ERROR_CODE,
  type PurchasesError,
  type PurchasesPackage,
} from 'react-native-purchases'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, X } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useSubscription } from '@/hooks/useSubscription'
import { useRevenueCat } from '@/contexts/RevenueCatContext'
import { SubscriptionLegalLinks } from '@/components/SubscriptionLegalLinks'
import {
  buildSubscriptionDisclosure,
  subscriptionLengthLabel,
  subscriptionProductTitle,
} from '@/lib/subscriptionDisclosure'
import {
  RC_DEFAULT_OFFERING_ID,
  RC_PACKAGE_AGENCY,
  RC_PACKAGE_PRO,
  type SubscriptionPlanKey,
} from '@/lib/revenuecat/config'
import { resolveAppRole } from '@/lib/profileRole'
import { PLATFORM_TRIAL_DAYS } from '@/lib/platformTrial'
import { formatCatalogPrice } from '@/lib/planCatalogPrices'
import { filterPackagesForRole } from '@/lib/revenuecat/offeringsPackages'
import {
  offeringsEmptyMessage,
  offeringsLoadErrorMessage,
  purchasesUnavailableUserMessage,
} from '@/lib/revenuecat/purchasesEnvironment'
import {
  formatPackageDisplayPrice,
  packageCadence,
  storeCurrencyRegionHint,
} from '@/lib/revenuecat/storeProductPrice'
import { ICON_STROKE } from '@/lib/iconTheme'

const HEADER_IMAGE = require('@/assets/header_image.jpg')

type PaywallRole = 'freelancer' | 'company'

const PAYWALL_COPY: Record<
  PaywallRole,
  { headline: string; features: readonly string[]; trialLead: string; cta: string }
> = {
  freelancer: {
    headline: 'Land the job that changes everything.',
    features: [
      'Apply to unlimited jobs',
      'Get instant job alerts',
      'Full Workspace, Sun Planner & Invoicing',
    ],
    trialLead: 'New subscribers:',
    cta: 'Get Pro',
  },
  company: {
    headline: 'Fill your roster and hire faster on every shoot.',
    features: [
      'Unlimited job listings & talent pool',
      '2 team seats included on Pro',
      'Applications, postings & hiring dashboard',
    ],
    trialLead: 'New company accounts:',
    cta: 'Get Company Pro',
  },
}

type PlanCard = {
  key: SubscriptionPlanKey
  packageKey: string
  title: string
}

const FREELANCER_PLANS: PlanCard[] = [{ key: 'pro', packageKey: RC_PACKAGE_PRO, title: 'Pro' }]
const COMPANY_PLANS: PlanCard[] = [{ key: 'pro', packageKey: RC_PACKAGE_AGENCY, title: 'Pro' }]

const HERO_HEIGHT = Math.min(420, Math.round(Dimensions.get('window').height * 0.46))

function isPurchaseCancelled(error: PurchasesError): boolean {
  return error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
}

function packagePriceMain(
  pkg: PurchasesPackage,
  role: 'freelancer' | 'company',
  cadence: 'monthly' | 'yearly'
): string {
  const display = formatPackageDisplayPrice(pkg, role, cadence)
  return display.text.replace(/\/mo$|\/yr$/i, '').trim()
}

function yearlyPerMonthLabel(
  yearlyPkg: PurchasesPackage,
  role: 'freelancer' | 'company'
): string | null {
  const perMonth = yearlyPkg.product.price / 12
  if (!Number.isFinite(perMonth) || perMonth <= 0) return null
  return `${formatCatalogPrice(perMonth)}/mo`
}

function yearlySavingsLabel(
  monthlyPkg: PurchasesPackage | undefined,
  yearlyPkg: PurchasesPackage
): string | null {
  const monthly = monthlyPkg?.product.price
  const yearly = yearlyPkg.product.price
  if (monthly == null || !Number.isFinite(monthly) || !Number.isFinite(yearly)) return null
  const save = monthly * 12 - yearly
  if (save < 0.5) return null
  return `SAVE ${formatCatalogPrice(save)}/YR`
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
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const storeRole: PaywallRole = role === 'company' ? 'company' : 'freelancer'
  const planCards = useMemo(() => (role === 'company' ? COMPANY_PLANS : FREELANCER_PLANS), [role])
  const copy = PAYWALL_COPY[storeRole]

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
      const offering = offerings.all[RC_DEFAULT_OFFERING_ID] ?? offerings.current ?? null
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
      if (!user) {
        setIsLoggedIn(false)
        setRole('freelancer')
        return
      }
      setIsLoggedIn(true)
      const roleHint = resolveAppRole(user.user_metadata?.role, user)
      if (roleHint === 'company') setRole('company')
      const { data: pr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      const r = resolveAppRole(pr?.role, user)
      setRole(r === 'company' ? 'company' : 'freelancer')
    })()
  }, [])

  useEffect(() => {
    if (!ready) return
    void loadOfferings()
  }, [ready, loadOfferings])

  const availableOptions = useMemo(() => {
    if (!role) return packages
    return filterPackagesForRole(packages, storeRole)
  }, [packages, role, storeRole])

  const yearlyPackage = useMemo(
    () => availableOptions.find((p) => packageCadence(p) === 'yearly') ?? null,
    [availableOptions]
  )
  const monthlyPackage = useMemo(
    () => availableOptions.find((p) => packageCadence(p) === 'monthly') ?? null,
    [availableOptions]
  )

  const usesCatalogPriceFallback = useMemo(() => {
    if (!role || !availableOptions.length) return false
    return availableOptions.some((pkg) => {
      const cadence = packageCadence(pkg)
      if (cadence === 'other') return false
      return formatPackageDisplayPrice(pkg, storeRole, cadence).usesCatalogFallback
    })
  }, [availableOptions, role, storeRole])

  const currencyHint = useMemo(() => {
    const sample = availableOptions[0]?.product
    if (!sample?.currencyCode) return null
    return storeCurrencyRegionHint(sample.currencyCode, { usesCatalogFallback: usesCatalogPriceFallback })
  }, [availableOptions, usesCatalogPriceFallback])

  useEffect(() => {
    if (!availableOptions.length) {
      setSelectedPackageId(null)
      return
    }
    const preferred =
      yearlyPackage?.identifier ?? monthlyPackage?.identifier ?? availableOptions[0]?.identifier ?? null
    if (!selectedPackageId || !availableOptions.some((pkg) => pkg.identifier === selectedPackageId)) {
      setSelectedPackageId(preferred)
    }
  }, [availableOptions, yearlyPackage, monthlyPackage, selectedPackageId])

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

  const selectedPackage = availableOptions.find((pkg) => pkg.identifier === selectedPackageId) ?? null
  const selectedPlan = planCards[0]
  const savingsLabel =
    yearlyPackage && role ? yearlySavingsLabel(monthlyPackage ?? undefined, yearlyPackage) : null
  const busy = !!busyPackageId

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/login')
  }, [router])

  const renderPlanOption = (pkg: PurchasesPackage, cadence: 'monthly' | 'yearly') => {
    if (!role) return null
    const isSelected = selectedPackageId === pkg.identifier
    const isYearly = cadence === 'yearly'
    const priceMain = packagePriceMain(pkg, storeRole, cadence)
    const perMonthSub = isYearly ? yearlyPerMonthLabel(pkg, storeRole) : null
    const productTitle = subscriptionProductTitle(pkg, storeRole)
    const lengthLabel = subscriptionLengthLabel(cadence)

    return (
      <TouchableOpacity
        key={pkg.identifier}
        style={[styles.planCard, isSelected && styles.planCardSelected]}
        onPress={() => setSelectedPackageId(pkg.identifier)}
        disabled={busy}
        activeOpacity={0.9}
      >
        <View style={styles.planCardLeft}>
          <Text style={styles.planCardTitle}>{productTitle}</Text>
          <Text style={styles.planCardLength}>{lengthLabel}</Text>
          {isYearly && savingsLabel ? (
            <View style={styles.savePill}>
              <Text style={styles.savePillText}>{savingsLabel}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.planCardRight}>
          <Text style={styles.planCardPrice}>{priceMain}</Text>
          {perMonthSub ? <Text style={styles.planCardSubPrice}>{perMonthSub}</Text> : null}
        </View>
      </TouchableOpacity>
    )
  }

  const selectedDisclosure =
    selectedPackage && role ? buildSubscriptionDisclosure(selectedPackage, storeRole) : null

  return (
    <View style={styles.root}>
      <ImageBackground source={HEADER_IMAGE} style={[styles.hero, { height: HERO_HEIGHT }]} resizeMode="cover">
        <LinearGradient
          colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.heroContent, { paddingTop: insets.top + 8 }]}>
          <View style={styles.heroTopRow}>
            <View style={styles.brandRow}>
              <Text style={styles.brandLogo}>CREA</Text>
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>Pro</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={goBack}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityLabel="Close"
            >
              <X size={22} color="#ffffff" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>

          <Text style={styles.headline}>{copy.headline}</Text>

          <View style={styles.featureList}>
            {copy.features.map((line) => (
              <View key={line} style={styles.featureRow}>
                <Check size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.featureText}>{line}</Text>
              </View>
            ))}
          </View>
        </View>
      </ImageBackground>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        {loadingOfferings ? (
          <View style={styles.sheetCentered}>
            <ActivityIndicator color="#0a0a0a" />
            <Text style={styles.sheetMuted}>Loading plans from the App Store…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.sheetCentered}>
            <Text style={styles.sheetError}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void loadOfferings()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={styles.trialLine}>
              {copy.trialLead}{' '}
              <Text style={styles.trialStrong}>{PLATFORM_TRIAL_DAYS}-day free trial</Text>, then billed
              through Apple.
            </Text>

            {yearlyPackage ? renderPlanOption(yearlyPackage, 'yearly') : null}
            {monthlyPackage ? renderPlanOption(monthlyPackage, 'monthly') : null}

            {!yearlyPackage && !monthlyPackage
              ? availableOptions.map((pkg) => {
                  const cadence = packageCadence(pkg)
                  if (cadence === 'other') return null
                  return renderPlanOption(pkg, cadence)
                })
              : null}

            {selectedDisclosure ? (
              <View style={styles.disclosureBox}>
                <Text style={styles.disclosureTitle}>Auto-renewing subscription</Text>
                <Text style={styles.disclosureLine}>
                  <Text style={styles.disclosureLabel}>Title: </Text>
                  {selectedDisclosure.title}
                </Text>
                <Text style={styles.disclosureLine}>
                  <Text style={styles.disclosureLabel}>Length: </Text>
                  {selectedDisclosure.length}
                </Text>
                <Text style={styles.disclosureLine}>
                  <Text style={styles.disclosureLabel}>Price: </Text>
                  {selectedDisclosure.price}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.ctaBtn,
                (!selectedPackage || currentPlan === 'pro' || busy) && styles.ctaBtnDisabled,
              ]}
              disabled={!selectedPackage || currentPlan === 'pro' || busy}
              onPress={() => selectedPackage && selectedPlan && void purchase(selectedPackage, selectedPlan.key)}
              activeOpacity={0.9}
            >
              <Text style={styles.ctaBtnText}>
                {currentPlan === 'pro' ? 'Active' : busy ? 'Processing…' : copy.cta}
              </Text>
            </TouchableOpacity>

            {currencyHint ? <Text style={styles.currencyHint}>{currencyHint}</Text> : null}

            <Text style={styles.legal}>
              Payment will be charged to your Apple ID account at confirmation of purchase. Subscription
              automatically renews unless canceled at least 24 hours before the end of the current period.
              Manage or cancel in Settings → Apple ID → Subscriptions.
            </Text>

            <View style={styles.legalLinks}>
              <SubscriptionLegalLinks
                layout="stack"
                onRestore={() => void restore()}
                restoring={restoring}
              />
            </View>

            {!isLoggedIn ? (
              <TouchableOpacity
                style={styles.loginBtn}
                onPress={() => router.push('/login')}
                activeOpacity={0.75}
              >
                <Text style={styles.loginLink}>Already have an account? Log in</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  hero: { width: '100%', justifyContent: 'flex-end' },
  heroContent: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 22, paddingBottom: 22 },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandLogo: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 3,
  },
  proBadge: {
    backgroundColor: '#FFDC00',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  proBadgeText: { color: '#0a0a0a', fontSize: 11, fontWeight: '800' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  headline: {
    color: '#FFDC00',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
    marginBottom: 16,
  },
  featureList: { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { color: '#ffffff', fontSize: 15, fontWeight: '500', flex: 1 },
  sheet: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -20,
    overflow: 'hidden',
  },
  sheetScroll: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 24 },
  sheetCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  sheetMuted: { color: 'rgba(10,10,10,0.45)', fontSize: 13 },
  sheetError: { color: '#b91c1c', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  retryBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.15)',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryBtnText: { color: '#0a0a0a', fontWeight: '700', fontSize: 14 },
  trialLine: {
    color: 'rgba(10,10,10,0.45)',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 16,
  },
  trialStrong: { color: '#0a0a0a', fontWeight: '700' },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    backgroundColor: '#ffffff',
  },
  planCardSelected: {
    borderColor: '#FFDC00',
    borderWidth: 2,
    shadowColor: '#FFDC00',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  planCardLeft: { flex: 1, paddingRight: 8 },
  planCardTitle: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },
  planCardLength: { color: 'rgba(10,10,10,0.45)', fontSize: 12, marginTop: 3, fontWeight: '600' },
  savePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFDC00',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  savePillText: { color: '#0a0a0a', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  planCardRight: { alignItems: 'flex-end' },
  planCardPrice: { color: '#0a0a0a', fontSize: 20, fontWeight: '800' },
  planCardSubPrice: { color: 'rgba(10,10,10,0.42)', fontSize: 12, marginTop: 2, fontWeight: '600' },
  ctaBtn: {
    marginTop: 8,
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaBtnDisabled: { opacity: 0.45 },
  ctaBtnText: { color: '#0a0a0a', fontSize: 17, fontWeight: '800' },
  disclosureBox: {
    marginTop: 4,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.08)',
    backgroundColor: 'rgba(10,10,10,0.03)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  disclosureTitle: {
    color: '#0a0a0a',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  disclosureLine: { color: 'rgba(10,10,10,0.62)', fontSize: 12, lineHeight: 17 },
  disclosureLabel: { color: '#0a0a0a', fontWeight: '700' },
  currencyHint: {
    color: 'rgba(10,10,10,0.42)',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    textAlign: 'center',
  },
  legal: {
    color: 'rgba(10,10,10,0.38)',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 14,
    textAlign: 'center',
  },
  legalLinks: {
    marginTop: 14,
    marginBottom: 4,
  },
  loginBtn: {
    alignSelf: 'center',
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  loginLink: {
    color: 'rgba(10,10,10,0.55)',
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '500',
  },
})

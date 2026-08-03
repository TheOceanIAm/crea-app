import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
  Platform,
  Linking,
  Image,
} from 'react-native'
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView'
import * as Device from 'expo-device'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { router, type Href } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Eye,
  FileText,
  Hammer,
  Link2,
  MessageCircle,
  Plus,
  Receipt,
  Settings,
  Trash2,
  UserRound,
  Share2,
} from 'lucide-react-native'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { SubscriptionLegalLinks } from '@/components/SubscriptionLegalLinks'
import { LocationAutocompleteInput } from '@/components/LocationAutocompleteInput'
import { supabase } from '@/lib/supabase'
import { getAuthUser } from '@/lib/getAuthUser'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import { readCachedDashboardOverview } from '@/lib/dashboardOverview'
import { deleteAccountViaApi } from '@/lib/deleteAccountApi'
import {
  openCreaWebsiteInBrowser,
  getCreaMarketingSiteUrl,
  getLoggedOutEntryRoute,
} from '@/lib/iosAppStoreCompliance'
import { useSubscription } from '@/hooks/useSubscription'
import { ICON_STROKE, ICON_STROKE_LARGE } from '@/lib/iconTheme'
import { pickAndUploadProfileAvatar } from '@/lib/uploadProfileAvatar'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { profileShareUrl } from '@/lib/shareLinks'
import { EQUIPMENT_PRESETS, SKILL_PRESETS } from '@/lib/profileSettingsPresets'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationDigest,
  type NotificationSettings,
  type PortfolioProject,
  parseNotificationSettings,
  parsePortfolioProjects,
} from '@/lib/profileSettingsExtras'
import { loadPortfolioProjectsForSettings } from '@/lib/freelancerPortfolioTable'
import { resolveCanonicalFreelancerHeadline } from '@/lib/freelancerHeadlineSync'
import { postSyncFreelancerProfileToWeb } from '@/lib/syncFreelancerProfileApi'
import {
  mirrorProfilesToFreelancerProfiles,
  syncFreelancerCoreProfileToWeb,
  syncFreelancerInvoiceFieldsToWeb,
} from '@/lib/syncFreelancerProfileToWeb'
import { registerForExpoPushTokenAsync } from '@/lib/pushNotifications'
import { CreaProfileTabSkeleton } from '@/components/CreaLoading'
import { useUnreadDmCount } from '@/hooks/useUnreadDmCount'
import { resolveCompanySubscriptionPlanFromSources } from '@/lib/companyPlanFromSession'
import { resolveFreelancerPlanFromUser, isFreelancerPro } from '@/lib/freelancerPlan'
import {
  freelancerPlanDescription,
  freelancerPlanLabel,
  companyStripePlanDescription,
  companyStripePlanLabel,
  normalizeFreelancerPlanKey,
  normalizeCompanyStripePlan,
  type NormalizedFreelancerPlan,
  type CompanyStripePlan,
} from '@/lib/billingDisplay'
import type { CompanySubscriptionPlanDb } from '@/lib/companyPlanFromSession'
import {
  companyPlanPriceLinePerMonth,
  companyPlanPriceLinePerYear,
  companySeatAddonPriceLine,
  freelancerProPriceLineMonthly,
  freelancerProPriceLineYearly,
} from '@/lib/planCatalogPrices'
import { openCompanySeatManagementOnWeb } from '@/lib/companySeatBilling'
import { useAppStorePlanPrices } from '@/hooks/useAppStorePlanPrices'
import { storeCurrencyRegionHint } from '@/lib/revenuecat/storeProductPrice'
import { formatCatalogPrice } from '@/lib/planCatalogPrices'
import { postTrialPlan } from '@/lib/trialPlanApi'
import { setBillingNotice } from '@/lib/billingNotice'
import { openCreaServicesStripeUrl } from '@/lib/stripeWebCheckout'
import {
  fetchFreelancerStripeConnectFromSupabase,
  fetchFreelancerStripeConnectStatus,
  mergeFreelancerStripeConnectStatus,
  openFreelancerStripeConnectOnboarding,
  type FreelancerStripeConnectStatus,
} from '@/lib/freelancerStripeConnect'
import {
  computeCompanyProfileCompletion,
  computeFreelancerProfileCompletion,
  computeFreelancerBillingReadiness,
  computeCompanyBillingReadiness,
  type CompanyProfileCompletionRow,
} from '@/lib/profile-completion'
import { PlatformTrialBar } from '@/components/PlatformTrialBar'
import {
  isWithinPlatformTrialPeriod,
  PLATFORM_TRIAL_DAYS,
  platformTrialDaysLeft,
} from '@/lib/platformTrial'

const SUPPORT_EMAIL = 'support@creaservices.com'
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('CREA App Support')}`
const PROFILE_MENU_EXTRA_BOTTOM = 28
const PROFILE_PLAN_EXTRA_BOTTOM = 48

type MenuId =
  | 'profile'
  | 'preview'
  | 'portfolio'
  | 'rates'
  | 'availability'
  | 'billing'
  | 'plan'
  | 'notifications'
  | 'account'

type MenuItem = {
  id: MenuId
  label: string
  icon: LucideIcon
  href?: Href
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'preview', label: 'Preview', icon: Eye, href: '/(tabs)/profile-preview' },
  { id: 'portfolio', label: 'Portfolio', icon: Link2 },
  { id: 'rates', label: 'Rates', icon: CircleDollarSign },
  {
    id: 'availability',
    label: 'Availability',
    icon: CalendarDays,
    href: '/(tabs)/availability',
  },
  { id: 'billing', label: 'Invoice & bank', icon: Receipt },
  { id: 'plan', label: 'Plan', icon: CreditCard },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'account', label: 'Account', icon: Settings },
]

const CEO_HIDDEN_MENU_IDS: MenuId[] = ['portfolio', 'rates', 'availability', 'billing', 'plan']
/** Rates, availability & links are freelancer-focused; companies edit website/social under Profile. */
const COMPANY_HIDDEN_MENU_IDS: MenuId[] = ['portfolio', 'rates', 'availability']

function roleLabel(role: string) {
  if (role === 'company') return 'Company'
  if (role === 'freelancer') return 'Freelancer'
  if (role === 'ceo') return 'CEO'
  return role || '—'
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  )
}

function PlanRow({
  title,
  price,
  desc,
  cta,
  current,
  disabled,
  onPress,
}: {
  title: string
  price: string
  desc: string
  cta: string
  current?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.planRowCard, current && styles.planRowCardCurrent]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      <View style={styles.planRowTop}>
        <View style={styles.planRowTitleCol}>
          <View style={styles.planRowTitleRow}>
            <Text style={styles.planRowTitle}>{title}</Text>
            {current ? (
              <View style={styles.currentTag}>
                <Text style={styles.currentTagText}>CURRENT</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.planRowPrice}>{price}</Text>
          <Text style={styles.planRowDesc}>{desc}</Text>
        </View>
        <View style={[styles.planRowCta, disabled && styles.planRowCtaDisabled]}>
          <Text style={[styles.planRowCtaText, disabled && styles.planRowCtaTextDisabled]}>{cta}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

function CompanySeatWebPanel() {
  return (
    <View style={styles.seatWebPanel}>
      <Text style={styles.seatWebTitle}>Team seats</Text>
      <Text style={styles.seatWebText}>
        Pro includes 5 seats. Additional seats ({companySeatAddonPriceLine()}) are purchased on creaservices.de
        via Stripe — not in the App Store.
      </Text>
      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => void openCompanySeatManagementOnWeb()}
        activeOpacity={0.85}
      >
        <Text style={styles.secondaryBtnText}>Manage seats on web</Text>
      </TouchableOpacity>
    </View>
  )
}

function CurrentPlanSummary({
  company,
  freelancerPlan,
  companyPlan,
}: {
  company: boolean
  freelancerPlan: NormalizedFreelancerPlan
  companyPlan: CompanyStripePlan
}) {
  const name = company ? companyStripePlanLabel(companyPlan ?? 'free') : freelancerPlanLabel(freelancerPlan)
  const desc = company
    ? companyStripePlanDescription(companyPlan ?? 'free')
    : freelancerPlanDescription(freelancerPlan)

  return (
    <View style={styles.currentPlanBox}>
      <Text style={styles.currentPlanLabel}>Current plan</Text>
      <Text style={styles.currentPlanName}>{name}</Text>
      <Text style={styles.currentPlanDesc}>{desc}</Text>
    </View>
  )
}

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true)
  const [activeMenu, setActiveMenu] = useState<MenuId>('profile')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editName, setEditName] = useState('')
  const [headline, setHeadline] = useState('')
  const [location, setLocation] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [skillsList, setSkillsList] = useState<string[]>([])
  const [equipmentList, setEquipmentList] = useState<string[]>([])
  const [customSkill, setCustomSkill] = useState('')
  const [customEquip, setCustomEquip] = useState('')

  const [savingProfile, setSavingProfile] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const [portfolioWebsite, setPortfolioWebsite] = useState('')
  const [portfolioInstagram, setPortfolioInstagram] = useState('')
  const [portfolioLinkedin, setPortfolioLinkedin] = useState('')
  const [portfolioVimeo, setPortfolioVimeo] = useState('')
  const [portfolioBehance, setPortfolioBehance] = useState('')
  const [portfolioProjects, setPortfolioProjects] = useState<PortfolioProject[]>([])
  const [projTitle, setProjTitle] = useState('')
  const [projClient, setProjClient] = useState('')
  const [projLink, setProjLink] = useState('')
  const [savingPortfolio, setSavingPortfolio] = useState(false)

  const [bankHolder, setBankHolder] = useState('')
  const [bankIban, setBankIban] = useState('')
  const [bankBic, setBankBic] = useState('')
  const [paypalEmail, setPaypalEmail] = useState('')
  const [invoiceAddress, setInvoiceAddress] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [vatRegistered, setVatRegistered] = useState(false)
  const [savingInvoice, setSavingInvoice] = useState(false)

  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false)

  const [notif, setNotif] = useState<NotificationSettings>({ ...DEFAULT_NOTIFICATION_SETTINGS })
  const [savingNotif, setSavingNotif] = useState(false)
  const [registeringPush, setRegisteringPush] = useState(false)

  const [connectStatusLoading, setConnectStatusLoading] = useState(false)
  const [connectStatusError, setConnectStatusError] = useState<string | null>(null)
  const [connectStatus, setConnectStatus] = useState<FreelancerStripeConnectStatus | null>(null)
  const [connectBusy, setConnectBusy] = useState(false)

  const [subscriptionTier, setSubscriptionTier] = useState<'free' | 'pro'>('free')
  /** ISO from `profiles.trial_ends_at` — platform exploration end (same as web). */
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [accountCreatedAt, setAccountCreatedAt] = useState<string | null>(null)
  const [switchingTrialPlan, setSwitchingTrialPlan] = useState(false)
  const [stripeCheckoutBusy, setStripeCheckoutBusy] = useState(false)
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(null)

  const [dayRate, setDayRate] = useState('')
  const [halfDayRate, setHalfDayRate] = useState('')
  const [ratesCurrency, setRatesCurrency] = useState('EUR')
  const [ratesNotes, setRatesNotes] = useState('')
  const [savingRates, setSavingRates] = useState(false)

  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [shareProfileOpen, setShareProfileOpen] = useState(false)
  /** Extra company_profiles columns for completion (industry, size, YouTube, etc.). */
  const [companyCpExtras, setCompanyCpExtras] = useState<CompanyProfileCompletionRow | null>(null)
  const profileLoadedAtRef = useRef(0)
  const PROFILE_STALE_MS = 30_000

  const freelancer = isFreelancerProfile(role)
  const ceo = isCeoProfile(role)
  const company = isCompanyProfile(role)
  const { unreadDmCount } = useUnreadDmCount(authUserId, Boolean(authUserId))
  const { isSubscribed: iosStoreSubscribed, currentPlan: iosStorePlan } = useSubscription()
  const inPlatformTrial = useMemo(
    () => isWithinPlatformTrialPeriod(trialEndsAt, accountCreatedAt),
    [trialEndsAt, accountCreatedAt]
  )

  const normalizedFreelancerPlan = useMemo(
    (): NormalizedFreelancerPlan =>
      freelancer ? normalizeFreelancerPlanKey(subscriptionTier) : 'free',
    [freelancer, subscriptionTier]
  )

  const normalizedCompanyPlan = useMemo((): CompanyStripePlan => {
    if (!company) return null
    return normalizeCompanyStripePlan(subscriptionTier) ?? 'free'
  }, [company, subscriptionTier])

  const iosDisplayFreelancerPlan = useMemo((): NormalizedFreelancerPlan => {
    if (iosStoreSubscribed && iosStorePlan !== 'free') {
      return normalizeFreelancerPlanKey(iosStorePlan)
    }
    return normalizedFreelancerPlan
  }, [iosStoreSubscribed, iosStorePlan, normalizedFreelancerPlan])

  const iosDisplayCompanyPlan = useMemo((): CompanySubscriptionPlanDb => {
    if (iosStoreSubscribed && iosStorePlan !== 'free') {
      return normalizeCompanyStripePlan(iosStorePlan) ?? 'free'
    }
    return normalizedCompanyPlan ?? 'free'
  }, [iosStoreSubscribed, iosStorePlan, normalizedCompanyPlan])

  const iosPlanStoreRole: 'freelancer' | 'company' | '' = company
    ? 'company'
    : freelancer
      ? 'freelancer'
      : ''
  const {
    displayPrice: iosStorePriceLine,
    usesCatalogFallback: iosUsesCatalogFallback,
    reload: reloadIosStorePrices,
  } = useAppStorePlanPrices(Platform.OS === 'ios' ? iosPlanStoreRole : '')

  const iosStorePriceHint = useMemo(
    () =>
      iosUsesCatalogFallback
        ? storeCurrencyRegionHint('USD', { usesCatalogFallback: true })
        : null,
    [iosUsesCatalogFallback]
  )

  const profileStrengthPct = useMemo(() => {
    if (ceo) return null
    if (freelancer) {
      const dr = dayRate.trim() === '' ? null : Number.parseFloat(dayRate.replace(',', '.'))
      const rate = dr != null && Number.isFinite(dr) && dr > 0 ? dr : null
      return computeFreelancerProfileCompletion({
        avatar_url: avatarUrl,
        headline,
        location,
        bio,
        skills: skillsList,
        day_rate_amount: rate,
        portfolio_website: portfolioWebsite,
        portfolio_projects: portfolioProjects,
      }).pct
    }
    if (company) {
      const webPrimary = portfolioWebsite.trim()
      const cpMerged: CompanyProfileCompletionRow = {
        company_name: editName,
        logo_url: companyCpExtras?.logo_url ?? avatarUrl ?? undefined,
        website: webPrimary || companyCpExtras?.website?.trim() || undefined,
        industry: companyCpExtras?.industry,
        size: companyCpExtras?.size,
        location,
        bio,
        instagram: portfolioInstagram.trim() || companyCpExtras?.instagram,
        linkedin: portfolioLinkedin.trim() || companyCpExtras?.linkedin,
        vimeo: portfolioVimeo.trim() || companyCpExtras?.vimeo,
        behance: portfolioBehance.trim() || companyCpExtras?.behance,
        youtube: companyCpExtras?.youtube,
        twitter_x: companyCpExtras?.twitter_x,
      }
      return computeCompanyProfileCompletion(editName, avatarUrl, cpMerged).pct
    }
    return null
  }, [
    ceo,
    freelancer,
    company,
    dayRate,
    avatarUrl,
    headline,
    location,
    bio,
    skillsList,
    portfolioWebsite,
    portfolioProjects,
    editName,
    portfolioInstagram,
    portfolioLinkedin,
    portfolioVimeo,
    portfolioBehance,
    companyCpExtras,
  ])

  const billingReadinessPct = useMemo(() => {
    if (ceo) return null
    if (freelancer) {
      return computeFreelancerBillingReadiness({
        invoice_address: invoiceAddress,
        bank_iban: bankIban,
        bank_account_holder: bankHolder,
        paypal_email: paypalEmail,
        bank_bic: bankBic,
        tax_number: taxNumber,
      }).pct
    }
    if (company) {
      return computeCompanyBillingReadiness({
        billing_address: companyCpExtras?.billing_address ?? null,
        billing_email: companyCpExtras?.billing_email ?? null,
        account_email: email,
        vat_id: companyCpExtras?.vat_id ?? null,
      }).pct
    }
    return null
  }, [
    ceo,
    freelancer,
    company,
    invoiceAddress,
    bankIban,
    bankHolder,
    paypalEmail,
    bankBic,
    taxNumber,
    companyCpExtras,
    email,
  ])

  const loadStripeConnectStatus = useCallback(async () => {
    if (!freelancer) return
    setConnectStatusLoading(true)
    setConnectStatusError(null)

    const fromDb = await fetchFreelancerStripeConnectFromSupabase()

    const r = await fetchFreelancerStripeConnectStatus()
    setConnectStatusLoading(false)
    if (r.ok === true) {
      setConnectStatus(mergeFreelancerStripeConnectStatus(r.status, fromDb))
      setConnectStatusError(null)
      return
    }

    setConnectStatus(fromDb)
    setConnectStatusError(r.errorMessage)
  }, [freelancer])

  const visibleMenuItems = useMemo(() => {
    if (ceo) return MENU_ITEMS.filter((item) => !CEO_HIDDEN_MENU_IDS.includes(item.id))
    if (company) return MENU_ITEMS.filter((item) => !COMPANY_HIDDEN_MENU_IDS.includes(item.id))
    return MENU_ITEMS
  }, [ceo, company])

  useEffect(() => {
    const hidden = ceo ? CEO_HIDDEN_MENU_IDS : company ? COMPANY_HIDDEN_MENU_IDS : []
    if (hidden.length && hidden.includes(activeMenu)) setActiveMenu('profile')
  }, [ceo, company, activeMenu])

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (
      !opts?.force &&
      profileLoadedAtRef.current > 0 &&
      Date.now() - profileLoadedAtRef.current < PROFILE_STALE_MS
    ) {
      return
    }
    setLoadError(null)
    const user = await getAuthUser()
    if (!user) {
      setAuthUserId(null)
      setStripeCustomerId(null)
      setTrialEndsAt(null)
      setAccountCreatedAt(null)
      setLoading(false)
      router.replace(getLoggedOutEntryRoute())
      return
    }
    setEmail(user.email ?? '')
    setAuthUserId(user.id)
    setAccountCreatedAt(typeof user.created_at === 'string' ? user.created_at : null)
    const cid = user.user_metadata?.stripe_customer_id
    setStripeCustomerId(typeof cid === 'string' && cid.trim() ? cid.trim() : null)

    // Instant paint from dashboard cache while full settings load.
    const dash = readCachedDashboardOverview(user.id)
    if (dash && !opts?.force) {
      if (dash.name) setEditName(dash.name)
      if (dash.role) setRole(dash.role)
      if (dash.avatarUrl) setAvatarUrl(dash.avatarUrl)
      if (dash.trialEndsAt) setTrialEndsAt(dash.trialEndsAt)
      setLoading(false)
    }

    const [{ data, error }, { data: freelancerRates, data: freelancerMirror }] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'name, role, headline, location, bio, skills, equipment, avatar_url, day_rate_amount, half_day_rate_amount, rates_currency, rates_notes, open_to_remote, open_to_travel, portfolio_website, portfolio_instagram, portfolio_linkedin, portfolio_vimeo, portfolio_behance, portfolio_projects, bank_account_holder, bank_iban, bank_bic, paypal_email, invoice_address, tax_number, vat_registered, notification_settings, subscription_tier, trial_ends_at'
        )
        .eq('id', user.id)
        .single(),
      supabase
        .from('freelancer_profiles')
        .select(
          'day_rate, half_day_rate, job_title, bio, location, skills, essentials, open_to_remote, open_to_travel, website, instagram, linkedin, vimeo, behance, bank_account_holder, bank_iban, bank_bic, paypal_email, invoice_address, steuer_id, vat_registered'
        )
        .eq('id', user.id)
        .maybeSingle(),
    ])

    if (error) {
      setLoadError(userFacingErrorMessage(error, error.message))
      setEditName('')
      setRole('')
      setHeadline('')
      setLocation('')
      setBio('')
      setAvatarUrl('')
      setSkillsList([])
      setEquipmentList([])
      setPortfolioWebsite('')
      setPortfolioInstagram('')
      setPortfolioLinkedin('')
      setPortfolioVimeo('')
      setPortfolioBehance('')
      setPortfolioProjects([])
      setBankHolder('')
      setBankIban('')
      setBankBic('')
      setPaypalEmail('')
      setInvoiceAddress('')
      setTaxNumber('')
      setVatRegistered(false)
      setNotif({ ...DEFAULT_NOTIFICATION_SETTINGS })
      setSubscriptionTier('free')
      setTrialEndsAt(null)
      setDayRate('')
      setHalfDayRate('')
      setRatesCurrency('EUR')
      setRatesNotes('')
      setCompanyCpExtras(null)
    } else {
      const fp = freelancerMirror as Record<string, unknown> | null
      setEditName(data?.name ?? '')
      setRole(resolveAppRole(data?.role, user))
      setHeadline(
        resolveCanonicalFreelancerHeadline(
          typeof data?.headline === 'string' ? data.headline : null,
          typeof fp?.job_title === 'string' ? fp.job_title : null
        )
      )
      setLocation(String(data?.location ?? fp?.location ?? ''))
      setBio(String(data?.bio ?? fp?.bio ?? ''))
      setAvatarUrl(data?.avatar_url ?? '')
      const skillsFromProfiles = Array.isArray(data?.skills) ? data.skills : []
      const skillsFromFp = Array.isArray(fp?.skills) ? (fp.skills as string[]) : []
      setSkillsList(skillsFromProfiles.length > 0 ? skillsFromProfiles : skillsFromFp)
      const equipmentFromProfiles = Array.isArray(data?.equipment) ? data.equipment : []
      const essentialsFromFp = Array.isArray(fp?.essentials) ? (fp.essentials as string[]) : []
      setEquipmentList(
        equipmentFromProfiles.length > 0 ? equipmentFromProfiles : essentialsFromFp
      )
      setPortfolioWebsite(String(data?.portfolio_website ?? fp?.website ?? ''))
      setPortfolioInstagram(String(data?.portfolio_instagram ?? fp?.instagram ?? ''))
      setPortfolioLinkedin(String(data?.portfolio_linkedin ?? fp?.linkedin ?? ''))
      setPortfolioVimeo(String(data?.portfolio_vimeo ?? fp?.vimeo ?? ''))
      setPortfolioBehance(String(data?.portfolio_behance ?? fp?.behance ?? ''))
      const appRole = resolveAppRole(data?.role, user)
      const [mergedPortfolio, companyProfileResult] = await Promise.all([
        loadPortfolioProjectsForSettings(user.id),
        appRole === 'company'
          ? supabase
              .from('company_profiles')
              .select(
                'subscription_plan, company_name, industry, size, website, logo_url, bio, location, instagram, linkedin, vimeo, behance, youtube, twitter_x, billing_address, billing_email, vat_id'
              )
              .eq('id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null as CompanyProfileCompletionRow | null }),
      ])
      setPortfolioProjects(mergedPortfolio)
      setBankHolder(String(data?.bank_account_holder ?? fp?.bank_account_holder ?? ''))
      setBankIban(String(data?.bank_iban ?? fp?.bank_iban ?? ''))
      setBankBic(String(data?.bank_bic ?? fp?.bank_bic ?? ''))
      setPaypalEmail(String(data?.paypal_email ?? fp?.paypal_email ?? ''))
      setInvoiceAddress(String(data?.invoice_address ?? fp?.invoice_address ?? ''))
      setTaxNumber(String(data?.tax_number ?? fp?.steuer_id ?? ''))
      setVatRegistered(Boolean(data?.vat_registered ?? fp?.vat_registered))
      setNotif(parseNotificationSettings(data?.notification_settings))
      const dbTier = String((data?.subscription_tier as string) || '')
        .trim()
        .toLowerCase()
      const authTier = resolveFreelancerPlanFromUser(user)
      // Freelancers: JWT `freelancer_plan` (same as web). Companies: JWT `company_plan` → company_profiles → profiles (crea-services webhook order).
      let effectiveTier: 'free' | 'pro'
      if (appRole === 'freelancer') {
        setCompanyCpExtras(null)
        effectiveTier = authTier
      } else if (appRole === 'company') {
        const cp = companyProfileResult.data
        setCompanyCpExtras(cp && typeof cp === 'object' ? (cp as CompanyProfileCompletionRow) : null)
        effectiveTier = resolveCompanySubscriptionPlanFromSources(
          user,
          data?.subscription_tier,
          (cp as { subscription_plan?: string } | null)?.subscription_plan
        )
      } else {
        setCompanyCpExtras(null)
        effectiveTier = normalizeFreelancerPlanKey(dbTier)
      }
      setSubscriptionTier(effectiveTier)
      const dayRateCanonical =
        freelancerRates?.day_rate != null ? freelancerRates.day_rate : data?.day_rate_amount ?? null
      const halfDayCanonical =
        freelancerRates?.half_day_rate != null
          ? freelancerRates.half_day_rate
          : data?.half_day_rate_amount ?? null
      setDayRate(dayRateCanonical != null ? String(dayRateCanonical) : '')
      setHalfDayRate(halfDayCanonical != null ? String(halfDayCanonical) : '')
      setRatesCurrency((data?.rates_currency as string) || 'EUR')
      setRatesNotes((data?.rates_notes as string) || '')
      const rawTrial = data?.trial_ends_at
      setTrialEndsAt(typeof rawTrial === 'string' && rawTrial.trim() ? rawTrial.trim() : null)

      if (isFreelancerProfile(resolveAppRole(data?.role, user))) {
        void mirrorProfilesToFreelancerProfiles(user.id)
      }
    }

    setLoading(false)
    profileLoadedAtRef.current = Date.now()
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  useEffect(() => {
    if (activeMenu !== 'billing' || !freelancer) return
    void loadStripeConnectStatus()
  }, [activeMenu, freelancer, loadStripeConnectStatus])

  useFocusEffect(
    useCallback(() => {
      if (activeMenu !== 'billing' || !freelancer) return
      void loadStripeConnectStatus()
    }, [activeMenu, freelancer, loadStripeConnectStatus])
  )

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'ios' || activeMenu !== 'plan') return
      void reloadIosStorePrices()
    }, [activeMenu, reloadIosStorePrices])
  )

  useEffect(() => {
    if (!switchingTrialPlan) return
    const guard = setTimeout(() => {
      setSwitchingTrialPlan(false)
    }, 25000)
    return () => clearTimeout(guard)
  }, [switchingTrialPlan])

  const switchTrialTier = useCallback(
    async (target: 'free' | 'pro') => {
      if (switchingTrialPlan) return
      setSwitchingTrialPlan(true)
      const fallbackDirectTierUpdate = async (): Promise<boolean> => {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return false

        if (company) {
          const { error: metaErr } = await supabase.auth.updateUser({
            data: { company_plan: target },
          })
          if (metaErr) return false
          const { error: companyErr } = await supabase
            .from('company_profiles')
            .update({ subscription_plan: target })
            .eq('id', user.id)
          if (companyErr) return false
        } else {
          const { error: metaErr } = await supabase.auth.updateUser({
            data: { freelancer_plan: target },
          })
          if (metaErr) return false
        }

        const { error: profileErr } = await supabase
          .from('profiles')
          .update({ subscription_tier: target })
          .eq('id', user.id)
        if (profileErr) return false

        return true
      }
      const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T | null> => {
        return await Promise.race([
          promise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
        ])
      }
      try {
        const res = company
          ? await postTrialPlan({ company_plan: target })
          : await postTrialPlan({ freelancer_plan: target })

        if (!res.ok) {
          if (res.error === 'timeout' || res.error === 'network_error') {
            const localOk = await fallbackDirectTierUpdate()
            if (localOk) {
              await withTimeout(supabase.auth.refreshSession(), 6000)
              setSubscriptionTier(target)
              void load()
              Alert.alert(
                'Plan updated',
                'The plan was updated directly in the app (web sync was temporarily unavailable).'
              )
              return
            }
          }
          const errorCopy =
            res.error === 'missing_web_url'
              ? 'Web URL missing. Please set EXPO_PUBLIC_CREA_WEB_URL.'
              : res.error === 'timeout'
                ? 'Plan switch timed out. Check your connection and confirm creaservices.de is reachable.'
                : res.error === 'network_error'
                  ? 'Network error while switching plan. Please try again.'
                  : res.error || 'Please try again later.'
          void setBillingNotice(errorCopy)
          Alert.alert('Could not switch plan', errorCopy)
          return
        }

        await withTimeout(supabase.auth.refreshSession(), 6000)
        setSubscriptionTier(target)
        void load()
        Alert.alert('Plan updated', 'Your trial plan was updated.')
      } finally {
        setSwitchingTrialPlan(false)
      }
    },
    [company, load, switchingTrialPlan]
  )

  const openStripeCustomerPortal = useCallback(async () => {
    if (stripeCheckoutBusy || !stripeCustomerId) return
    setStripeCheckoutBusy(true)
    try {
      const returnPath = company ? '/settings/company' : '/settings/freelancer'
      const ok = await openCreaServicesStripeUrl({
        apiPath: '/api/stripe/portal',
        body: { returnPath },
      })
      if (ok) {
        Alert.alert(
          'Billing portal',
          'When you are done in Stripe, return to the app. Open Plan again to refresh if your subscription changed.'
        )
      }
    } finally {
      setStripeCheckoutBusy(false)
    }
  }, [stripeCheckoutBusy, stripeCustomerId, company])

  const startFreelancerPaidCheckout = useCallback(async () => {
    if (stripeCheckoutBusy) return
    setStripeCheckoutBusy(true)
    try {
      const ok = await openCreaServicesStripeUrl({ apiPath: '/api/stripe/checkout', body: { plan: 'pro' } })
      if (ok) {
        Alert.alert(
          'Stripe checkout',
          'Complete payment in the browser. Apple Pay and cards are offered when supported. Then return here and open Plan again to refresh.'
        )
      }
    } finally {
      setStripeCheckoutBusy(false)
    }
  }, [stripeCheckoutBusy])

  const startCompanyPaidCheckout = useCallback(async () => {
    if (stripeCheckoutBusy) return
    setStripeCheckoutBusy(true)
    try {
      const ok = await openCreaServicesStripeUrl({
        apiPath: '/api/stripe/checkout-company',
        body: { company_plan: 'pro' },
      })
      if (ok) {
        Alert.alert(
          'Stripe checkout',
          'Complete payment in the browser. Apple Pay and cards are offered when supported. Then return here and open Plan again to refresh.'
        )
      }
    } finally {
      setStripeCheckoutBusy(false)
    }
  }, [stripeCheckoutBusy])

  const displayLetter = useMemo(
    () => (editName || email || '?').trim().charAt(0).toUpperCase() || '?',
    [editName, email]
  )

  const profilePublicUrl = useMemo(
    () => (authUserId ? profileShareUrl(authUserId) : null),
    [authUserId]
  )
  const profileCardMessage = useMemo(
    () => `${editName.trim() || 'My Crea profile'} — view my profile on Crea`,
    [editName]
  )

  const avatarUri = avatarUrl.trim()
  const showAvatarImage = /^https?:\/\//i.test(avatarUri)

  const toggleSkill = (label: string) => {
    setSkillsList((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]))
  }

  const toggleEquipment = (label: string) => {
    setEquipmentList((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
    )
  }

  const addCustomSkill = () => {
    const t = customSkill.trim()
    if (!t) return
    if (!skillsList.includes(t)) setSkillsList((p) => [...p, t])
    setCustomSkill('')
  }

  const addCustomEquip = () => {
    const t = customEquip.trim()
    if (!t) return
    if (!equipmentList.includes(t)) setEquipmentList((p) => [...p, t])
    setCustomEquip('')
  }

  const saveProfile = async () => {
    const trimmed = editName.trim()
    if (!trimmed) {
      Alert.alert('Profile', 'Please enter a name.')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setSavingProfile(true)
    const payload: Record<string, unknown> = {
      name: trimmed,
      headline: headline.trim() || null,
      location: location.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatarUrl.trim() || null,
    }
    if (freelancer) {
      payload.skills = skillsList
      payload.equipment = equipmentList
    }
    if (company) {
      payload.portfolio_website = portfolioWebsite.trim() || null
      payload.portfolio_instagram = portfolioInstagram.trim() || null
      payload.portfolio_linkedin = portfolioLinkedin.trim() || null
      payload.portfolio_vimeo = portfolioVimeo.trim() || null
      payload.portfolio_behance = portfolioBehance.trim() || null
    }

    const { error } = await supabase.from('profiles').update(payload).eq('id', user.id)
    if (error) {
      setSavingProfile(false)
      Alert.alert('Save failed', error.message)
      return
    }

    if (freelancer) {
      const mirror = await syncFreelancerCoreProfileToWeb(user.id, {
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        location: location.trim() || null,
        skills: skillsList,
        equipment: equipmentList,
      })
      if (mirror.error) {
        setSavingProfile(false)
        Alert.alert('Save failed', mirror.error)
        return
      }
    }

    setSavingProfile(false)
    Alert.alert('Saved', 'Your profile was updated.')
  }

  const changePhoto = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUploadingAvatar(true)
    const result = await pickAndUploadProfileAvatar(user.id)
    setUploadingAvatar(false)
    if (result.ok === false) {
      if (!result.cancelled) Alert.alert('Photo', result.error)
      return
    }
    setAvatarUrl(result.publicUrl)
    Alert.alert('Saved', 'Your profile photo was updated.')
  }

  const saveRates = async () => {
    if (!freelancer) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const dr = dayRate.trim() === '' ? null : parseFloat(dayRate.replace(',', '.'))
    const hr = halfDayRate.trim() === '' ? null : parseFloat(halfDayRate.replace(',', '.'))
    if (dr != null && (Number.isNaN(dr) || dr < 0)) {
      Alert.alert('Rates', 'Day rate must be a valid number.')
      return
    }
    if (hr != null && (Number.isNaN(hr) || hr < 0)) {
      Alert.alert('Rates', 'Half-day rate must be a valid number.')
      return
    }
    setSavingRates(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        day_rate_amount: dr,
        half_day_rate_amount: hr,
        rates_currency: ratesCurrency.trim().toUpperCase() || 'EUR',
        rates_notes: ratesNotes.trim() || null,
      })
      .eq('id', user.id)
    const { error: legacyRateError } = await supabase
      .from('freelancer_profiles')
      .upsert(
        {
          id: user.id,
          day_rate: dr,
          half_day_rate: hr,
        },
        { onConflict: 'id' }
      )
    if (!error && !legacyRateError && freelancer) {
      await mirrorProfilesToFreelancerProfiles(user.id)
    }
    setSavingRates(false)
    if (error || legacyRateError) {
      Alert.alert('Save failed', error?.message || legacyRateError?.message || 'Could not save rates.')
      return
    }
    Alert.alert('Saved', 'Your rates were updated.')
  }

  const addPortfolioProject = () => {
    const t = projTitle.trim()
    if (!t) {
      Alert.alert('Portfolio', 'Please enter a project title.')
      return
    }
    setPortfolioProjects((p) => [...p, { title: t, client: projClient.trim(), link: projLink.trim() }])
    setProjTitle('')
    setProjClient('')
    setProjLink('')
  }

  const removePortfolioProject = (index: number) => {
    setPortfolioProjects((p) => p.filter((_, i) => i !== index))
  }

  const savePortfolio = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSavingPortfolio(true)
    const payload: Record<string, unknown> = {
      portfolio_website: portfolioWebsite.trim() || null,
      portfolio_instagram: portfolioInstagram.trim() || null,
      portfolio_linkedin: portfolioLinkedin.trim() || null,
      portfolio_vimeo: portfolioVimeo.trim() || null,
      portfolio_behance: portfolioBehance.trim() || null,
    }
    if (!company) {
      payload.portfolio_projects = portfolioProjects
    }
    const { error } = await supabase.from('profiles').update(payload).eq('id', user.id)
    if (error) {
      setSavingPortfolio(false)
      Alert.alert('Save failed', error.message)
      return
    }

    if (!company) {
      const sync = await postSyncFreelancerProfileToWeb()
      if (!sync.ok) {
        const fallback = await mirrorProfilesToFreelancerProfiles(user.id)
        if (fallback.error) {
          setSavingPortfolio(false)
          Alert.alert('Save failed', sync.error ?? fallback.error)
          return
        }
      }
      const refreshed = await loadPortfolioProjectsForSettings(user.id)
      setPortfolioProjects(refreshed)
    }

    setSavingPortfolio(false)
    Alert.alert('Saved', company ? 'Links were updated.' : 'Portfolio & links were updated.')
  }

  const saveInvoiceBank = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSavingInvoice(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        bank_account_holder: bankHolder.trim() || null,
        bank_iban: bankIban.trim() || null,
        bank_bic: bankBic.trim() || null,
        paypal_email: paypalEmail.trim() || null,
        invoice_address: invoiceAddress.trim() || null,
        tax_number: taxNumber.trim() || null,
        vat_registered: vatRegistered,
      })
      .eq('id', user.id)
    if (error) {
      setSavingInvoice(false)
      Alert.alert('Save failed', error.message)
      return
    }

    if (freelancer) {
      const mirror = await syncFreelancerInvoiceFieldsToWeb(user.id, {
        bank_account_holder: bankHolder,
        bank_iban: bankIban,
        bank_bic: bankBic,
        paypal_email: paypalEmail,
        invoice_address: invoiceAddress,
        tax_number: taxNumber,
        vat_registered: vatRegistered,
      })
      if (mirror.error) {
        setSavingInvoice(false)
        Alert.alert('Save failed', mirror.error)
        return
      }
    }

    setSavingInvoice(false)
    Alert.alert('Saved', 'Invoice details were saved.')
  }

  const writeNotificationSettings = async (
    payload: NotificationSettings
  ): Promise<{ error: Error | null }> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: new Error('Not signed in') }
    const { error } = await supabase
      .from('profiles')
      .update({ notification_settings: payload })
      .eq('id', user.id)
    return { error: error ? new Error(error.message) : null }
  }

  const saveNotificationSettings = async () => {
    setSavingNotif(true)
    const { error } = await writeNotificationSettings(notif)
    setSavingNotif(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    Alert.alert('Saved', 'Notifications were updated.')
  }

  const setDigest = (d: NotificationDigest) => {
    setNotif((n) => ({ ...n, digest: d }))
  }

  const enablePushOnDevice = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'Push notifications are not supported in the web build.')
      return
    }
    setRegisteringPush(true)
    const res = await registerForExpoPushTokenAsync()
    setRegisteringPush(false)
    if (res.ok === false) {
      if (res.reason === 'simulator') {
        Alert.alert(
          'Simulator',
          'Push tokens are only available on a physical iPhone or Android device.'
        )
        return
      }
      if (res.reason === 'denied') {
        Alert.alert(
          'Permission needed',
          'Allow notifications for CREA in your system settings to receive pushes.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open settings', onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        )
        return
      }
      Alert.alert('Push unavailable', res.reason)
      return
    }
    const next: NotificationSettings = {
      ...notif,
      pushEnabled: true,
      expoPushToken: res.token,
    }
    setNotif(next)
    const { error } = await writeNotificationSettings(next)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    Alert.alert('Push enabled', 'This device is registered.')
  }

  const disablePushOnDevice = async () => {
    const next: NotificationSettings = {
      ...notif,
      pushEnabled: false,
      expoPushToken: null,
    }
    setNotif(next)
    const { error } = await writeNotificationSettings(next)
    if (error) {
      Alert.alert('Save failed', error.message)
    }
  }

  const pushRegistered = Boolean(notif.pushEnabled && notif.expoPushToken)

  const savePassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert('Password', 'At least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Password', 'Passwords do not match.')
      return
    }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)

    if (error) {
      Alert.alert('Password', error.message)
      return
    }
    setNewPassword('')
    setConfirmPassword('')
    Alert.alert('Saved', 'Your password was changed.')
  }

  const openHelp = () => {
    void Linking.openURL(SUPPORT_MAILTO).catch(() => {
      Alert.alert('Contact support', `Could not open Mail. Email us at ${SUPPORT_EMAIL}`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Mail',
          onPress: () => {
            void Linking.openURL(SUPPORT_MAILTO)
          },
        },
      ])
    })
  }

  const handleLogout = async () => {
    Alert.alert('Sign out', 'Sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.auth.signOut({ scope: 'local' })
          if (error) {
            Alert.alert('Sign out failed', error.message)
            return
          }
          router.replace(getLoggedOutEntryRoute())
        },
      },
    ])
  }

  const runDeleteAccount = async () => {
    setDeleteAccountBusy(true)
    try {
      const r = await deleteAccountViaApi()
      if (r.ok) {
        await supabase.auth.signOut({ scope: 'local' })
        router.replace(getLoggedOutEntryRoute())
      } else {
        Alert.alert('Delete failed', 'error' in r ? r.error : 'Unknown error')
      }
    } finally {
      setDeleteAccountBusy(false)
    }
  }

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'Your account and all associated data will be permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: () => void runDeleteAccount(),
        },
      ]
    )
  }

  const onMenuPress = (item: MenuItem) => {
    if (item.href) {
      router.navigate(item.href)
      return
    }
    setActiveMenu(item.id)
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <CreaProfileTabSkeleton />
      </SafeAreaView>
    )
  }

  const bottomExtra = activeMenu === 'plan' ? PROFILE_PLAN_EXTRA_BOTTOM : PROFILE_MENU_EXTRA_BOTTOM

  const placeholder = (title: string, body: string) => (
    <View style={styles.sectionCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSubtitle}>{body}</Text>
      <View style={styles.placeholderBox}>
        <Hammer size={28} color="rgba(255,220,0,0.35)" strokeWidth={ICON_STROKE_LARGE} />
        <Text style={styles.placeholderText}>Coming soon</Text>
      </View>
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.flex}>
        <View style={styles.headerRow}>
          <Text style={styles.brand}>Crea</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerShareBtn}
              onPress={() => router.push('/(tabs)/messages')}
              hitSlop={10}
              accessibilityLabel="Messages"
            >
              <MessageCircle size={20} color="rgba(255,255,255,0.55)" strokeWidth={ICON_STROKE} />
              {unreadDmCount > 0 ? <View style={styles.headerMsgDot} /> : null}
            </TouchableOpacity>
            {(freelancer || company) && authUserId ? (
              <TouchableOpacity
                style={styles.headerShareBtn}
                onPress={() => setShareProfileOpen(true)}
                hitSlop={10}
                accessibilityLabel="Share profile"
              >
                <Share2 size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            ) : null}
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleLabel(role)}</Text>
            </View>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.menuScroll}
          contentContainerStyle={styles.menuScrollContent}
        >
          {visibleMenuItems.map((item) => {
            const active = activeMenu === item.id
            const MenuIcon = item.icon
            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => onMenuPress(item)}
                style={[styles.menuItem, active && styles.menuItemActive]}
                activeOpacity={0.8}
              >
                <MenuIcon
                  size={16}
                  color={active ? '#FFDC00' : 'rgba(255,255,255,0.35)'}
                  strokeWidth={ICON_STROKE}
                />
                <Text style={[styles.menuLabel, active && styles.menuLabelActive]}>{item.label}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          extraBottomPadding={bottomExtra}
        >
          {loadError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorTitle}>Couldn’t load profile</Text>
              <Text style={styles.errorText}>{loadError}</Text>
              {/connection pool|timed out|timeout|temporarily unavailable|database is busy/i.test(
                loadError
              ) ? (
                <Text style={styles.errorHint}>
                  The database is busy right now (connection pool). Wait a few seconds, leave this tab and
                  come back — or tap Retry. No SQL migrations needed for this error.
                </Text>
              ) : /column|schema|does not exist|PGRST/i.test(loadError) ? (
                <Text style={styles.errorHint}>
                  In Supabase → SQL Editor, run scripts from{' '}
                  <Text style={styles.errorMono}>supabase/sql</Text>:{' '}
                  <Text style={styles.errorMono}>extend_profile_identity.sql</Text>,{' '}
                  <Text style={styles.errorMono}>extend_profile_settings_pages.sql</Text>, and{' '}
                  <Text style={styles.errorMono}>extend_profile_rates.sql</Text> (adds day rates). For jobs,
                  applications, and projects, also run{' '}
                  <Text style={styles.errorMono}>crea_app_features.sql</Text>.
                </Text>
              ) : (
                <Text style={styles.errorHint}>Try again in a moment. If it keeps failing, sign out and back in.</Text>
              )}
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => void load({ force: true })}
                activeOpacity={0.85}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {profileStrengthPct !== null ? (
            <View style={styles.profileStrengthCard}>
              <View style={styles.profileStrengthTop}>
                <Text style={styles.profileStrengthTitle}>
                  {company ? 'Company profile strength' : 'Profile strength'}
                </Text>
                <Text
                  style={[
                    styles.profileStrengthPct,
                    profileStrengthPct >= 100 && styles.profileStrengthPctDone,
                  ]}
                >
                  {profileStrengthPct}%
                </Text>
              </View>
              <View style={styles.profileStrengthTrack}>
                <View style={[styles.profileStrengthFill, { width: `${profileStrengthPct}%` }]} />
              </View>
              {profileStrengthPct < 100 ? (
                <Text style={styles.profileStrengthHint}>
                  Fill missing sections to reach 100%. Push reminders use the same checklist (optional under
                  Notifications).
                </Text>
              ) : null}
            </View>
          ) : null}

          {billingReadinessPct !== null ? (
            <View style={styles.billingReadinessCard}>
              <View style={styles.profileStrengthTop}>
                <Text style={styles.profileStrengthTitle}>Billing &amp; invoices</Text>
                <Text
                  style={[
                    styles.profileStrengthPct,
                    billingReadinessPct >= 100 && styles.profileStrengthPctDone,
                  ]}
                >
                  {billingReadinessPct}%
                </Text>
              </View>
              <View style={styles.profileStrengthTrack}>
                <View style={[styles.billingReadinessFill, { width: `${billingReadinessPct}%` }]} />
              </View>
              <Text style={styles.billingReadinessPrivacy}>
                For PDF invoices and payouts — not shown on your public profile. Complete details under Invoice
                &amp; bank / Billing.
              </Text>
            </View>
          ) : null}

          {activeMenu === 'profile' && (
            <>
              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Your identity</Text>
                <Text style={styles.cardSubtitle}>
                  {company
                    ? 'How freelancers see your company on job posts and your public profile.'
                    : 'How companies see you on Crea.'}
                </Text>

                <Text style={styles.fieldLabel}>Profile photo</Text>
                <View style={styles.photoRow}>
                  <TouchableOpacity
                    onPress={changePhoto}
                    disabled={uploadingAvatar}
                    activeOpacity={0.85}
                    accessibilityLabel="Change profile photo"
                  >
                    {showAvatarImage ? (
                      <Image source={{ uri: avatarUri }} style={styles.photoSquare} />
                    ) : (
                      <View style={styles.photoPlaceholder}>
                        {uploadingAvatar ? (
                          <ActivityIndicator color="#0a0a0a" />
                        ) : (
                          <Text style={styles.photoLetter}>{displayLetter}</Text>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={styles.photoMeta}>
                    <Text style={styles.photoHint}>
                      Tap the image to choose a new photo. It is stored in your Supabase bucket{' '}
                      <Text style={styles.photoHintMono}>avatars</Text> (see SQL in repo).
                    </Text>
                    <TouchableOpacity
                      style={styles.photoUploadBtn}
                      onPress={changePhoto}
                      disabled={uploadingAvatar}
                    >
                      {uploadingAvatar ? (
                        <ActivityIndicator color="#FFDC00" />
                      ) : (
                        <Text style={styles.photoUploadBtnText}>Choose from library</Text>
                      )}
                    </TouchableOpacity>
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Or image URL</Text>
                    <TextInput
                      style={styles.input}
                      value={avatarUrl}
                      onChangeText={setAvatarUrl}
                      placeholder="https://…"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Full name</Text>
                <TextInput
                  style={styles.input}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Name"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="words"
                />

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Job title / role</Text>
                <TextInput
                  style={styles.input}
                  value={headline}
                  onChangeText={setHeadline}
                  placeholder={company ? 'e.g. Production company · Commercials' : 'e.g. Director · DoP'}
                  placeholderTextColor="rgba(255,255,255,0.28)"
                />
                <Text style={styles.inlineHint}>
                  {company
                    ? 'Short line under your company name on listings and your public page.'
                    : 'Shown under your name on your public profile.'}
                </Text>

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Location</Text>
                <LocationAutocompleteInput
                  value={location}
                  onChangeText={setLocation}
                  placeholder="e.g. Berlin, Germany"
                  inputStyle={styles.input}
                />

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Bio</Text>
                <TextInput
                  style={[styles.input, styles.bioInput]}
                  value={bio}
                  onChangeText={setBio}
                  placeholder={
                    company
                      ? 'About your company — visible on your public profile.'
                      : '2–4 sentences about your work and style …'
                  }
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  multiline
                  textAlignVertical="top"
                />

                {company ? (
                  <>
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Website</Text>
                    <TextInput
                      style={styles.input}
                      value={portfolioWebsite}
                      onChangeText={setPortfolioWebsite}
                      placeholder="https://yourcompany.com"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Instagram</Text>
                    <TextInput
                      style={styles.input}
                      value={portfolioInstagram}
                      onChangeText={setPortfolioInstagram}
                      placeholder="@handle or full URL"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>LinkedIn</Text>
                    <TextInput
                      style={styles.input}
                      value={portfolioLinkedin}
                      onChangeText={setPortfolioLinkedin}
                      placeholder="linkedin.com/company/… or full URL"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Vimeo</Text>
                    <TextInput
                      style={styles.input}
                      value={portfolioVimeo}
                      onChangeText={setPortfolioVimeo}
                      placeholder="vimeo.com/…"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Behance</Text>
                    <TextInput
                      style={styles.input}
                      value={portfolioBehance}
                      onChangeText={setPortfolioBehance}
                      placeholder="behance.net/…"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      autoCapitalize="none"
                    />
                    <Text style={styles.inlineHint}>
                      These appear on your public company profile under Website and Socials.
                    </Text>
                  </>
                ) : null}
              </View>

              {freelancer && (
                <>
                  <View style={styles.sectionCard}>
                    <Text style={styles.cardTitle}>Skills</Text>
                    <Text style={styles.cardSubtitle}>For job matching and your public profile.</Text>
                    <View style={styles.chipGrid}>
                      {SKILL_PRESETS.map((s) => (
                        <Chip key={s} label={s} selected={skillsList.includes(s)} onPress={() => toggleSkill(s)} />
                      ))}
                    </View>
                    <View style={styles.addRow}>
                      <TextInput
                        style={[styles.input, styles.addInput]}
                        value={customSkill}
                        onChangeText={setCustomSkill}
                        placeholder="Add a custom skill…"
                        placeholderTextColor="rgba(255,255,255,0.28)"
                        onSubmitEditing={addCustomSkill}
                      />
                      <TouchableOpacity style={styles.addBtn} onPress={addCustomSkill} accessibilityLabel="Add skill">
                        <Plus size={22} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.sectionCard}>
                    <Text style={styles.cardTitle}>Equipment &amp; credentials</Text>
                    <Text style={styles.cardSubtitle}>Licenses, gear, certifications — visible like skills.</Text>
                    <Text style={styles.presetLabel}>Quick picks</Text>
                    <View style={styles.chipGrid}>
                      {EQUIPMENT_PRESETS.map((s) => (
                        <Chip
                          key={s}
                          label={s}
                          selected={equipmentList.includes(s)}
                          onPress={() => toggleEquipment(s)}
                        />
                      ))}
                    </View>
                    <View style={styles.addRow}>
                      <TextInput
                        style={[styles.input, styles.addInput]}
                        value={customEquip}
                        onChangeText={setCustomEquip}
                        placeholder="Add custom (e.g. lens kit)…"
                        placeholderTextColor="rgba(255,255,255,0.28)"
                        onSubmitEditing={addCustomEquip}
                      />
                      <TouchableOpacity style={styles.addBtn} onPress={addCustomEquip} accessibilityLabel="Add item">
                        <Plus size={22} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, savingProfile && styles.btnDisabled]}
                onPress={saveProfile}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save profile</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {activeMenu === 'portfolio' && (
            <>
              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>{company ? 'Links' : 'Social & portfolio links'}</Text>
                <Text style={styles.cardSubtitle}>
                  {company
                    ? 'Website and social profiles on your public company profile.'
                    : 'Shown as icons on your public profile.'}
                </Text>

                <Text style={styles.fieldLabel}>Website</Text>
                <TextInput
                  style={styles.input}
                  value={portfolioWebsite}
                  onChangeText={setPortfolioWebsite}
                  placeholder={company ? 'https://yourcompany.com' : 'https://yoursite.com'}
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="none"
                />

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Instagram</Text>
                <TextInput
                  style={styles.input}
                  value={portfolioInstagram}
                  onChangeText={setPortfolioInstagram}
                  placeholder="@handle or full URL"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="none"
                />

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>LinkedIn</Text>
                <TextInput
                  style={styles.input}
                  value={portfolioLinkedin}
                  onChangeText={setPortfolioLinkedin}
                  placeholder={company ? 'linkedin.com/company/… or full URL' : 'linkedin.com/in/… or handle'}
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="none"
                />

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Vimeo</Text>
                <TextInput
                  style={styles.input}
                  value={portfolioVimeo}
                  onChangeText={setPortfolioVimeo}
                  placeholder="vimeo.com/…"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="none"
                />

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Behance</Text>
                <TextInput
                  style={styles.input}
                  value={portfolioBehance}
                  onChangeText={setPortfolioBehance}
                  placeholder="behance.net/…"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="none"
                />
              </View>

              {!company ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.cardTitle}>Portfolio projects</Text>
                  <Text style={styles.cardSubtitle}>Highlights on your profile.</Text>

                  {portfolioProjects.map((p, i) => (
                    <View key={`${p.title}-${i}`} style={styles.projectRow}>
                      <View style={styles.projectRowBody}>
                        <Text style={styles.projectTitle}>{p.title}</Text>
                        {p.client ? <Text style={styles.projectMeta}>{p.client}</Text> : null}
                        {p.link ? <Text style={styles.projectLink} numberOfLines={1}>{p.link}</Text> : null}
                      </View>
                      <TouchableOpacity onPress={() => removePortfolioProject(i)} hitSlop={10}>
                        <Trash2 size={20} color="rgba(255,100,100,0.85)" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                    </View>
                  ))}

                  <Text style={styles.presetLabel}>Add project</Text>
                  <TextInput
                    style={styles.input}
                    value={projTitle}
                    onChangeText={setProjTitle}
                    placeholder="Project title"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                  />
                  <TextInput
                    style={[styles.input, styles.inputSpaced]}
                    value={projClient}
                    onChangeText={setProjClient}
                    placeholder="Client"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                  />
                  <TextInput
                    style={[styles.input, styles.inputSpaced]}
                    value={projLink}
                    onChangeText={setProjLink}
                    placeholder="Link (Vimeo, YouTube, website …)"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={[styles.primaryBtn, styles.addProjectBtn]} onPress={addPortfolioProject}>
                    <Text style={styles.primaryBtnText}>Add project</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.primaryBtn, savingPortfolio && styles.btnDisabled]}
                onPress={savePortfolio}
                disabled={savingPortfolio}
              >
                {savingPortfolio ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save changes</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {activeMenu === 'rates' &&
            (freelancer ? (
              <>
                <View style={styles.sectionCard}>
                  <Text style={styles.cardTitle}>Rates &amp; services</Text>
                  <Text style={styles.cardSubtitle}>
                    Default numbers for quotes; you can still negotiate per job.
                  </Text>
                  <Text style={styles.fieldLabel}>Day rate</Text>
                  <TextInput
                    style={styles.input}
                    value={dayRate}
                    onChangeText={setDayRate}
                    placeholder="e.g. 850"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                    keyboardType="decimal-pad"
                  />
                  <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Half-day rate (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={halfDayRate}
                    onChangeText={setHalfDayRate}
                    placeholder="e.g. 500"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                    keyboardType="decimal-pad"
                  />
                  <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Currency</Text>
                  <TextInput
                    style={styles.input}
                    value={ratesCurrency}
                    onChangeText={setRatesCurrency}
                    placeholder="EUR"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                    autoCapitalize="characters"
                  />
                  <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Packages &amp; notes</Text>
                  <TextInput
                    style={[styles.input, styles.bioInput]}
                    value={ratesNotes}
                    onChangeText={setRatesNotes}
                    placeholder="e.g. Travel billed separately, buyout for 12 months web…"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                    multiline
                    textAlignVertical="top"
                  />
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtn, savingRates && styles.btnDisabled]}
                  onPress={saveRates}
                  disabled={savingRates}
                >
                  {savingRates ? (
                    <ActivityIndicator color="#0a0a0a" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Save rates</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              placeholder(
                'Rates & services',
                'Freelancers set day rates here. Companies manage job budgets when posting roles.'
              )
            ))}

          {activeMenu === 'billing' && freelancer && (
            <>
              <View style={styles.infoBanner}>
                <FileText size={20} color="rgba(255,220,0,0.7)" strokeWidth={ICON_STROKE} />
                <Text style={styles.infoBannerText}>
                  For the invoice editor: saved details are prefilled when you create an invoice (you can still edit
                  each invoice).
                </Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Stripe payouts</Text>
                <Text style={styles.cardSubtitle}>
                  Connect your bank through Stripe for card payouts when clients pay on the web. Your IBAN below is
                  still used for manual transfers and PDF invoices.
                </Text>
                {connectStatusLoading ? (
                  <ActivityIndicator color="#FFDC00" style={styles.connectSpinner} />
                ) : (
                  <>
                    {connectStatusError ? (
                      <Text style={styles.connectWarningText}>{connectStatusError}</Text>
                    ) : null}
                    {connectStatus?.connected ? (
                      <Text style={styles.connectLinkedLine}>Stripe payout account is linked.</Text>
                    ) : null}
                    {connectStatus ? (
                      <Text style={styles.connectStatusSummary}>
                        Details:{' '}
                        <Text style={connectStatus.detailsSubmitted ? styles.connectOk : styles.connectPending}>
                          {connectStatus.detailsSubmitted ? 'Submitted' : 'Not yet'}
                        </Text>
                        {'  ·  '}
                        Charges:{' '}
                        <Text style={connectStatus.chargesEnabled ? styles.connectOk : styles.connectPending}>
                          {connectStatus.chargesEnabled ? 'Enabled' : 'Pending'}
                        </Text>
                        {'  ·  '}
                        Payouts:{' '}
                        <Text style={connectStatus.payoutsEnabled ? styles.connectOk : styles.connectPending}>
                          {connectStatus.payoutsEnabled ? 'Enabled' : 'Pending'}
                        </Text>
                      </Text>
                    ) : null}
                  </>
                )}
                <TouchableOpacity
                  style={[styles.secondaryBtn, (connectBusy || connectStatusLoading) && styles.btnDisabled]}
                  disabled={connectBusy || connectStatusLoading}
                  activeOpacity={0.8}
                  onPress={() =>
                    void (async () => {
                      setConnectBusy(true)
                      await openFreelancerStripeConnectOnboarding()
                      setConnectBusy(false)
                      void loadStripeConnectStatus()
                    })()
                  }
                >
                  {connectBusy ? (
                    <ActivityIndicator color="#FFDC00" />
                  ) : (
                    <Text style={styles.secondaryBtnText}>
                      {connectStatus?.connected ? 'Update payout details in Stripe' : 'Set up Stripe payouts'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Bank &amp; PayPal</Text>
                <Text style={styles.cardSubtitle}>Bank details for transfers — shown on the PDF invoice.</Text>
                <Text style={styles.fieldLabel}>Account holder</Text>
                <TextInput
                  style={styles.input}
                  value={bankHolder}
                  onChangeText={setBankHolder}
                  placeholder="Name"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                />
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>IBAN</Text>
                <TextInput
                  style={styles.input}
                  value={bankIban}
                  onChangeText={setBankIban}
                  placeholder="DE89 …"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="characters"
                />
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>BIC / SWIFT (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={bankBic}
                  onChangeText={setBankBic}
                  placeholder="COBADEFFXXX"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="characters"
                />
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>PayPal (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={paypalEmail}
                  onChangeText={setPaypalEmail}
                  placeholder="you@paypal.com"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="default"
                  textContentType="emailAddress"
                  autoComplete="email"
                />
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Invoice address &amp; tax</Text>
                <Text style={styles.cardSubtitle}>
                  Pro unlocks invoicing and full tax fields. Free users can set up bank details for future use.
                </Text>
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Invoice address</Text>
                <TextInput
                  style={[styles.input, styles.bioInput]}
                  value={invoiceAddress}
                  onChangeText={setInvoiceAddress}
                  placeholder="Name, street, postal code, city, country"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  multiline
                  textAlignVertical="top"
                />
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Tax number (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={taxNumber}
                  onChangeText={setTaxNumber}
                  placeholder="e.g. 12/123/12345"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                />
                <Text style={styles.inlineHint}>Local tax number (e.g. Germany) — not the VAT ID.</Text>
                <View style={styles.notifyBlock}>
                  <View style={styles.notifyBlockText}>
                    <Text style={styles.notifyBlockTitle}>VAT registered</Text>
                    <Text style={styles.notifyBlockSub}>You charge VAT on invoices.</Text>
                  </View>
                  <Switch
                    value={vatRegistered}
                    onValueChange={setVatRegistered}
                    trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                    thumbColor={vatRegistered ? '#FFDC00' : '#888'}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, savingInvoice && styles.btnDisabled]}
                onPress={saveInvoiceBank}
                disabled={savingInvoice}
              >
                {savingInvoice ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save changes</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.linkToInvoices}
                onPress={() => router.navigate('/(tabs)/invoices')}
                activeOpacity={0.7}
              >
                <Text style={styles.linkToInvoicesText}>My invoices</Text>
                <ChevronRight size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            </>
          )}

          {activeMenu === 'billing' && !freelancer && (
            <View style={styles.sectionCard}>
              <Text style={styles.cardTitle}>Invoice &amp; bank</Text>
              <Text style={styles.cardSubtitle}>
                Bank details are for freelancer invoices. As a company, use the invoice list in the Invoices tab.
              </Text>
              <Text style={styles.fieldLabel}>Account holder</Text>
              <TextInput
                style={styles.input}
                value={bankHolder}
                onChangeText={setBankHolder}
                placeholder="Company name or account holder"
                placeholderTextColor="rgba(255,255,255,0.28)"
              />
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>IBAN</Text>
              <TextInput
                style={styles.input}
                value={bankIban}
                onChangeText={setBankIban}
                placeholder="DE89 …"
                placeholderTextColor="rgba(255,255,255,0.28)"
                autoCapitalize="characters"
              />
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>BIC / SWIFT (optional)</Text>
              <TextInput
                style={styles.input}
                value={bankBic}
                onChangeText={setBankBic}
                placeholder="COBADEFFXXX"
                placeholderTextColor="rgba(255,255,255,0.28)"
                autoCapitalize="characters"
              />
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>PayPal (optional)</Text>
              <TextInput
                style={styles.input}
                value={paypalEmail}
                onChangeText={setPaypalEmail}
                placeholder="billing@company.com"
                placeholderTextColor="rgba(255,255,255,0.28)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
                textContentType="emailAddress"
                autoComplete="email"
              />
              <TouchableOpacity
                style={[styles.secondaryBtn, savingInvoice && styles.btnDisabled]}
                onPress={saveInvoiceBank}
                disabled={savingInvoice}
              >
                {savingInvoice ? (
                  <ActivityIndicator color="#FFDC00" />
                ) : (
                  <Text style={styles.secondaryBtnText}>Save bank details</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.navigate('/(tabs)/invoices')}>
                <Text style={styles.secondaryBtnText}>Open invoices (annual budget)</Text>
              </TouchableOpacity>
            </View>
          )}

          {activeMenu === 'plan' ? (
            Platform.OS === 'ios' ? (
              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Plan</Text>
                <Text style={styles.cardSubtitle}>
                  {PLATFORM_TRIAL_DAYS}-day Pro trial, then Free or subscribe to Pro via Apple In-App Purchase (same as
                  creaservices.de).
                </Text>

                <CurrentPlanSummary
                  company={company}
                  freelancerPlan={iosDisplayFreelancerPlan}
                  companyPlan={iosDisplayCompanyPlan}
                />

                {!ceo && !iosStoreSubscribed ? (
                  <PlatformTrialBar
                    trialEndsAt={trialEndsAt}
                    accountCreatedAt={accountCreatedAt}
                    embedded
                    style={styles.trialBarEmbedded}
                  />
                ) : null}

                {company ? (
                  <>
                    <PlanRow
                      title="Pro"
                      price={iosStorePriceLine}
                      desc={companyStripePlanDescription('pro')}
                      cta={iosDisplayCompanyPlan === 'pro' ? 'Your plan' : 'View in App Store'}
                      current={iosDisplayCompanyPlan === 'pro'}
                      disabled={iosDisplayCompanyPlan === 'pro'}
                      onPress={() => router.push('/paywall')}
                    />
                    <CompanySeatWebPanel />
                  </>
                ) : (
                  <>
                    <PlanRow
                      title="Free"
                      price={formatCatalogPrice(0)}
                      desc={freelancerPlanDescription('free')}
                      cta={!isFreelancerPro(iosDisplayFreelancerPlan) ? 'Your plan' : 'Included'}
                      current={!isFreelancerPro(iosDisplayFreelancerPlan)}
                      disabled={!isFreelancerPro(iosDisplayFreelancerPlan)}
                      onPress={() => {}}
                    />
                    <PlanRow
                      title="Pro"
                      price={iosStorePriceLine}
                      desc={freelancerPlanDescription('pro')}
                      cta={isFreelancerPro(iosDisplayFreelancerPlan) ? 'Your plan' : 'View in App Store'}
                      current={isFreelancerPro(iosDisplayFreelancerPlan)}
                      disabled={isFreelancerPro(iosDisplayFreelancerPlan)}
                      onPress={() => router.push('/paywall')}
                    />
                  </>
                )}

                {iosStorePriceHint ? (
                  <Text style={[styles.stripeFoot, styles.planIosPriceHint]}>{iosStorePriceHint}</Text>
                ) : null}

                <View style={styles.planIosFooter}>
                  <Text style={[styles.stripeFoot, styles.planIosStripeFoot]}>
                    Subscriptions are managed through your Apple Account in Settings → Apple ID → Subscriptions.
                  </Text>

                  <View style={styles.planIosLegalLinks}>
                    <SubscriptionLegalLinks variant="dark" />
                  </View>

                  {!ceo && !iosStoreSubscribed ? (
                    <TouchableOpacity
                      style={[styles.primaryBtn, styles.planIosFooterBtn, styles.planIosFooterBtnLast]}
                      onPress={() => router.push('/paywall')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.primaryBtnText}>Subscribe in app</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : (
            <>
              {!ceo && !stripeCustomerId ? (
                <PlatformTrialBar
                  trialEndsAt={trialEndsAt}
                  accountCreatedAt={accountCreatedAt}
                  embedded
                  style={styles.trialBarEmbedded}
                />
              ) : null}

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Plan &amp; billing</Text>
                <Text style={styles.cardSubtitle}>
                  {PLATFORM_TRIAL_DAYS}-day Pro trial, then Free or subscribe to Pro — same plans as creaservices.de (Stripe
                  in browser or on the website).
                </Text>

                <CurrentPlanSummary
                  company={company}
                  freelancerPlan={normalizedFreelancerPlan}
                  companyPlan={normalizedCompanyPlan}
                />

                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => Linking.openURL('https://creaservices.de/pricing').catch(() => {})}
                >
                  <Text style={styles.secondaryBtnText}>View comparison on web</Text>
                </TouchableOpacity>

                {!ceo ? (
                  <View style={styles.inAppPayBlock}>
                    <Text style={styles.inAppPayTitle}>Subscribe from the app</Text>
                    <Text style={styles.inAppPaySub}>
                      Secure Stripe Checkout in the browser — Apple Pay and cards when supported.
                    </Text>
                    {stripeCustomerId ? (
                      <TouchableOpacity
                        style={[styles.secondaryBtn, stripeCheckoutBusy && styles.btnDisabled]}
                        disabled={stripeCheckoutBusy}
                        onPress={() => void openStripeCustomerPortal()}
                      >
                        <Text style={styles.secondaryBtnText}>
                          {stripeCheckoutBusy ? 'Opening…' : 'Manage subscription & billing'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}

                {company ? (
                  <>
                    <PlanRow
                      title="Pro"
                      price={`${companyPlanPriceLinePerMonth()} · ${companyPlanPriceLinePerYear()}`}
                      desc={`${companyStripePlanDescription('pro')} ${companySeatAddonPriceLine()}.`}
                      cta={
                        normalizedCompanyPlan === 'pro'
                          ? 'Active'
                          : switchingTrialPlan || stripeCheckoutBusy
                            ? 'Please wait…'
                            : inPlatformTrial && !stripeCustomerId
                              ? 'Preview in trial'
                              : 'Subscribe'
                      }
                      current={normalizedCompanyPlan === 'pro'}
                      disabled={normalizedCompanyPlan === 'pro' || switchingTrialPlan || stripeCheckoutBusy}
                      onPress={() =>
                        void (inPlatformTrial && !stripeCustomerId
                          ? switchTrialTier('pro')
                          : startCompanyPaidCheckout())
                      }
                    />
                    <CompanySeatWebPanel />
                  </>
                ) : (
                  <>
                    <PlanRow
                      title="Free"
                      price="€0"
                      desc={freelancerPlanDescription('free')}
                      cta={
                        !isFreelancerPro(normalizedFreelancerPlan)
                          ? 'Active'
                          : switchingTrialPlan || stripeCheckoutBusy
                            ? 'Please wait…'
                            : inPlatformTrial
                              ? 'Preview in trial'
                              : 'Downgrade on web'
                      }
                      current={!isFreelancerPro(normalizedFreelancerPlan)}
                      disabled={
                        !isFreelancerPro(normalizedFreelancerPlan) ||
                        switchingTrialPlan ||
                        stripeCheckoutBusy ||
                        (!inPlatformTrial && isFreelancerPro(normalizedFreelancerPlan))
                      }
                      onPress={() => {
                        if (inPlatformTrial && isFreelancerPro(normalizedFreelancerPlan)) {
                          void switchTrialTier('free')
                          return
                        }
                        Linking.openURL('https://creaservices.de/settings/freelancer?tab=plan').catch(() => {})
                      }}
                    />
                    <PlanRow
                      title="Pro"
                      price={`${freelancerProPriceLineMonthly()} · ${freelancerProPriceLineYearly()}`}
                      desc={freelancerPlanDescription('pro')}
                      cta={
                        isFreelancerPro(normalizedFreelancerPlan)
                          ? 'Active'
                          : switchingTrialPlan || stripeCheckoutBusy
                            ? 'Please wait…'
                            : inPlatformTrial && !stripeCustomerId
                              ? 'Preview in trial'
                              : 'Subscribe'
                      }
                      current={isFreelancerPro(normalizedFreelancerPlan)}
                      disabled={isFreelancerPro(normalizedFreelancerPlan) || switchingTrialPlan || stripeCheckoutBusy}
                      onPress={() =>
                        void (inPlatformTrial && !stripeCustomerId
                          ? switchTrialTier('pro')
                          : startFreelancerPaidCheckout())
                      }
                    />
                  </>
                )}

                <Text style={styles.stripeFoot}>
                  With an active subscription, change plans or payment details under Plan &amp; billing on creaservices.de.
                </Text>
              </View>
            </>
            )
          ) : null}

          {activeMenu === 'notifications' && (
            <>
              {Platform.OS !== 'web' ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.cardTitle}>Push notifications</Text>
                  <Text style={styles.cardSubtitle}>
                    You can get alerts when CREA is in the background or fully closed (standard iOS/Android push). Allow
                    notifications when prompted, tap Register this device, choose categories below, then Save.
                  </Text>
                  {!Device.isDevice ? (
                    <Text style={styles.inlineHint}>Simulators don’t receive push tokens — use a physical device.</Text>
                  ) : null}
                  {pushRegistered ? (
                    <>
                      <Text style={styles.pushStatusOn}>This device is registered.</Text>
                      <TouchableOpacity
                        style={[styles.secondaryBtn, styles.pushUnregisterBtn]}
                        onPress={disablePushOnDevice}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.secondaryBtnText}>Turn off push on this device</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={[styles.primaryBtn, (registeringPush || !Device.isDevice) && styles.btnDisabled]}
                      onPress={enablePushOnDevice}
                      disabled={registeringPush || !Device.isDevice}
                      activeOpacity={0.85}
                    >
                      {registeringPush ? (
                        <ActivityIndicator color="#0a0a0a" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Register this device</Text>
                      )}
                    </TouchableOpacity>
                  )}

                  {pushRegistered ? (
                    <>
                      <Text style={[styles.cardSubtitle, styles.pushTypesTitle]}>Which pushes we may send</Text>
                      {freelancer && !ceo ? (
                        <>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Job matches</Text>
                              <Text style={styles.notifyBlockSub}>New roles that fit your profile.</Text>
                            </View>
                            <Switch
                              value={notif.pushJobMatch}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushJobMatch: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushJobMatch ? '#FFDC00' : '#888'}
                            />
                          </View>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Messages</Text>
                              <Text style={styles.notifyBlockSub}>When a company messages you.</Text>
                            </View>
                            <Switch
                              value={notif.pushMessage}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushMessage: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushMessage ? '#FFDC00' : '#888'}
                            />
                          </View>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Invoice paid</Text>
                              <Text style={styles.notifyBlockSub}>When a client marks your invoice as paid.</Text>
                            </View>
                            <Switch
                              value={notif.pushInvoicePaid}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushInvoicePaid: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushInvoicePaid ? '#FFDC00' : '#888'}
                            />
                          </View>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Client confirmed receipt</Text>
                              <Text style={styles.notifyBlockSub}>
                                When a client acknowledges your invoice before paying on the website.
                              </Text>
                            </View>
                            <Switch
                              value={notif.pushInvoiceReceiptConfirmed}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushInvoiceReceiptConfirmed: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushInvoiceReceiptConfirmed ? '#FFDC00' : '#888'}
                            />
                          </View>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Profile reminders</Text>
                              <Text style={styles.notifyBlockSub}>
                                If your profile is still incomplete after a few days, we send one gentle nudge.
                              </Text>
                            </View>
                            <Switch
                              value={notif.pushProfileCompletion}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushProfileCompletion: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushProfileCompletion ? '#FFDC00' : '#888'}
                            />
                          </View>
                        </>
                      ) : null}
                      {company ? (
                        <>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>New applications</Text>
                              <Text style={styles.notifyBlockSub}>Someone applies to one of your jobs.</Text>
                            </View>
                            <Switch
                              value={notif.pushNewApplication}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushNewApplication: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushNewApplication ? '#FFDC00' : '#888'}
                            />
                          </View>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Messages</Text>
                              <Text style={styles.notifyBlockSub}>When a freelancer messages you.</Text>
                            </View>
                            <Switch
                              value={notif.pushMessage}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushMessage: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushMessage ? '#FFDC00' : '#888'}
                            />
                          </View>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Incoming invoices</Text>
                              <Text style={styles.notifyBlockSub}>When a freelancer sends or updates an invoice.</Text>
                            </View>
                            <Switch
                              value={notif.pushInvoiceReceived}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushInvoiceReceived: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushInvoiceReceived ? '#FFDC00' : '#888'}
                            />
                          </View>
                          <View style={styles.notifyBlock}>
                            <View style={styles.notifyBlockText}>
                              <Text style={styles.notifyBlockTitle}>Profile reminders</Text>
                              <Text style={styles.notifyBlockSub}>
                                If your company profile is still incomplete after a few days, we send one gentle nudge.
                              </Text>
                            </View>
                            <Switch
                              value={notif.pushProfileCompletion}
                              onValueChange={(v) => setNotif((n) => ({ ...n, pushProfileCompletion: v }))}
                              trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                              thumbColor={notif.pushProfileCompletion ? '#FFDC00' : '#888'}
                            />
                          </View>
                        </>
                      ) : null}
                      {ceo ? (
                        <View style={styles.notifyBlock}>
                          <View style={styles.notifyBlockText}>
                            <Text style={styles.notifyBlockTitle}>Messages</Text>
                            <Text style={styles.notifyBlockSub}>Direct messages and platform mentions.</Text>
                          </View>
                          <Switch
                            value={notif.pushMessage}
                            onValueChange={(v) => setNotif((n) => ({ ...n, pushMessage: v }))}
                            trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                            thumbColor={notif.pushMessage ? '#FFDC00' : '#888'}
                          />
                        </View>
                      ) : null}
                      <Text style={styles.inlineHint}>Tap “Save changes” below to sync push categories.</Text>
                    </>
                  ) : null}
                </View>
              ) : (
                <View style={styles.sectionCard}>
                  <Text style={styles.cardTitle}>Push notifications</Text>
                  <Text style={styles.cardSubtitle}>Available in the iOS and Android app — not in the browser build.</Text>
                </View>
              )}

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Email notifications</Text>
                <Text style={styles.cardSubtitle}>We’ll email you when …</Text>

                {freelancer && !ceo ? (
                  <>
                    <View style={styles.notifyBlock}>
                      <View style={styles.notifyBlockText}>
                        <Text style={styles.notifyBlockTitle}>New job match</Text>
                        <Text style={styles.notifyBlockSub}>A job matches your skills and location.</Text>
                      </View>
                      <Switch
                        value={notif.emailJobMatch}
                        onValueChange={(v) => setNotif((n) => ({ ...n, emailJobMatch: v }))}
                        trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                        thumbColor={notif.emailJobMatch ? '#FFDC00' : '#888'}
                      />
                    </View>
                    <View style={styles.notifyBlock}>
                      <View style={styles.notifyBlockText}>
                        <Text style={styles.notifyBlockTitle}>New message</Text>
                        <Text style={styles.notifyBlockSub}>When a company messages you.</Text>
                      </View>
                      <Switch
                        value={notif.emailMessage}
                        onValueChange={(v) => setNotif((n) => ({ ...n, emailMessage: v }))}
                        trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                        thumbColor={notif.emailMessage ? '#FFDC00' : '#888'}
                      />
                    </View>
                    <View style={styles.notifyBlock}>
                      <View style={styles.notifyBlockText}>
                        <Text style={styles.notifyBlockTitle}>Invoice paid</Text>
                        <Text style={styles.notifyBlockSub}>A client marks your invoice as paid.</Text>
                      </View>
                      <Switch
                        value={notif.emailInvoicePaid}
                        onValueChange={(v) => setNotif((n) => ({ ...n, emailInvoicePaid: v }))}
                        trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                        thumbColor={notif.emailInvoicePaid ? '#FFDC00' : '#888'}
                      />
                    </View>
                  </>
                ) : null}

                {company ? (
                  <>
                    <View style={styles.notifyBlock}>
                      <View style={styles.notifyBlockText}>
                        <Text style={styles.notifyBlockTitle}>New applications</Text>
                        <Text style={styles.notifyBlockSub}>Someone applies to one of your jobs.</Text>
                      </View>
                      <Switch
                        value={notif.emailNewApplication}
                        onValueChange={(v) => setNotif((n) => ({ ...n, emailNewApplication: v }))}
                        trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                        thumbColor={notif.emailNewApplication ? '#FFDC00' : '#888'}
                      />
                    </View>
                    <View style={styles.notifyBlock}>
                      <View style={styles.notifyBlockText}>
                        <Text style={styles.notifyBlockTitle}>New message</Text>
                        <Text style={styles.notifyBlockSub}>When a freelancer messages you.</Text>
                      </View>
                      <Switch
                        value={notif.emailMessage}
                        onValueChange={(v) => setNotif((n) => ({ ...n, emailMessage: v }))}
                        trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                        thumbColor={notif.emailMessage ? '#FFDC00' : '#888'}
                      />
                    </View>
                    <View style={styles.notifyBlock}>
                      <View style={styles.notifyBlockText}>
                        <Text style={styles.notifyBlockTitle}>Incoming invoices</Text>
                        <Text style={styles.notifyBlockSub}>When a freelancer sends or updates an invoice to you.</Text>
                      </View>
                      <Switch
                        value={notif.emailInvoiceReceived}
                        onValueChange={(v) => setNotif((n) => ({ ...n, emailInvoiceReceived: v }))}
                        trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                        thumbColor={notif.emailInvoiceReceived ? '#FFDC00' : '#888'}
                      />
                    </View>
                  </>
                ) : null}

                {ceo ? (
                  <View style={styles.notifyBlock}>
                    <View style={styles.notifyBlockText}>
                      <Text style={styles.notifyBlockTitle}>New message</Text>
                      <Text style={styles.notifyBlockSub}>Direct messages and important platform notices.</Text>
                    </View>
                    <Switch
                      value={notif.emailMessage}
                      onValueChange={(v) => setNotif((n) => ({ ...n, emailMessage: v }))}
                      trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                      thumbColor={notif.emailMessage ? '#FFDC00' : '#888'}
                    />
                  </View>
                ) : null}
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Digest</Text>
                <Text style={styles.cardSubtitle}>Summary by email.</Text>
                <View style={styles.segmentRow}>
                  {(['none', 'daily', 'weekly'] as const).map((d) => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => setDigest(d)}
                      style={[styles.segmentBtn, notif.digest === d && styles.segmentBtnActive]}
                    >
                      <Text style={[styles.segmentBtnText, notif.digest === d && styles.segmentBtnTextActive]}>
                        {d === 'none' ? 'None' : d === 'daily' ? 'Daily' : 'Weekly'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, savingNotif && styles.btnDisabled]}
                onPress={saveNotificationSettings}
                disabled={savingNotif}
              >
                {savingNotif ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save changes</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {activeMenu === 'account' && (
            <>
              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>Account</Text>
                <Text style={styles.cardSubtitle}>Email and security.</Text>
                <Text style={styles.fieldLabel}>Email</Text>
                <Text style={styles.readOnly}>{email || '—'}</Text>
                <Text style={styles.inlineHint}>Tied to your login — can’t be changed here.</Text>

                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>New password</Text>
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="New password"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  secureTextEntry
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.input, styles.inputSpaced]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  secureTextEntry
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.secondaryBtn, savingPassword && styles.btnDisabled]}
                  onPress={savePassword}
                  disabled={savingPassword || !newPassword}
                >
                  {savingPassword ? (
                    <ActivityIndicator color="#FFDC00" />
                  ) : (
                    <Text style={styles.secondaryBtnText}>Update password</Text>
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.linkRow} onPress={openHelp} activeOpacity={0.7}>
                <MessageCircle size={20} color="rgba(255,255,255,0.5)" strokeWidth={ICON_STROKE} />
                <Text style={styles.linkRowLabel}>Contact support</Text>
                <ChevronRight size={18} color="rgba(255,255,255,0.2)" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.deleteAccountBtn, deleteAccountBusy && styles.btnDisabled]}
                onPress={confirmDeleteAccount}
                disabled={deleteAccountBusy}
                activeOpacity={0.75}
              >
                {deleteAccountBusy ? (
                  <ActivityIndicator color="#ff8888" />
                ) : (
                  <Text style={styles.deleteAccountText}>Delete account</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                <Text style={styles.logoutText}>Sign out</Text>
              </TouchableOpacity>
            </>
          )}
          </KeyboardAwareScrollView>
      </View>

      <ShareSheetModal
        visible={shareProfileOpen}
        onClose={() => setShareProfileOpen(false)}
        sheetTitle="Share profile"
        shareMessage={profileCardMessage}
        shareUrl={profilePublicUrl}
        mailSubject={`Crea profile: ${editName.trim() || 'Freelancer'}`}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  brand: { fontSize: 22, fontWeight: '900', color: '#FFDC00', letterSpacing: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerShareBtn: { padding: 4, position: 'relative' },
  headerMsgDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#ff2d55',
  },
  roleBadge: {
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  roleText: { color: '#FFDC00', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  menuScroll: { flexGrow: 0, marginBottom: 8 },
  menuScrollContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111111',
  },
  menuItemActive: {
    borderColor: '#FFDC00',
    backgroundColor: 'rgba(255,220,0,0.08)',
  },
  menuLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  menuLabelActive: { color: '#FFDC00' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  errorBanner: {
    backgroundColor: 'rgba(255,80,80,0.1)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.25)',
  },
  errorTitle: { color: '#ff8888', fontWeight: '700', marginBottom: 6 },
  errorText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 8 },
  errorHint: { color: 'rgba(255,255,255,0.35)', fontSize: 11, lineHeight: 16 },
  errorMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10 },
  retryBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#FFDC00',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryBtnText: { color: '#0a0a0a', fontWeight: '700', fontSize: 13 },
  profileStrengthCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  profileStrengthTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  profileStrengthTitle: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  profileStrengthPct: { fontSize: 14, fontWeight: '900', color: 'rgba(255,255,255,0.55)', fontVariant: ['tabular-nums'] },
  profileStrengthPctDone: { color: '#FFDC00' },
  profileStrengthTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  profileStrengthFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FFDC00',
  },
  profileStrengthHint: {
    marginTop: 10,
    fontSize: 11,
    color: 'rgba(255,255,255,0.32)',
    lineHeight: 15,
  },
  billingReadinessCard: {
    backgroundColor: 'rgba(255,220,0,0.06)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.18)',
  },
  billingReadinessFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,220,0,0.92)',
  },
  billingReadinessPrivacy: {
    marginTop: 10,
    fontSize: 11,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 15,
  },
  sectionCard: {
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 6 },
  cardSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.38)', lineHeight: 18, marginBottom: 18 },
  connectSpinner: { marginVertical: 6, alignSelf: 'flex-start' },
  connectErrorText: { fontSize: 12, color: 'rgba(255,140,120,0.9)', lineHeight: 17, marginBottom: 12 },
  connectWarningText: { fontSize: 12, color: 'rgba(255,211,106,0.85)', lineHeight: 17, marginBottom: 12 },
  connectStatusSummary: { fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 18, marginBottom: 12 },
  connectOk: { color: 'rgba(120,220,160,0.95)', fontWeight: '600' },
  connectPending: { color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  connectLinkedLine: { fontSize: 13, fontWeight: '600', color: 'rgba(120,220,160,0.92)', marginBottom: 10 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  fieldLabelSpaced: { marginTop: 16 },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
  },
  inputSpaced: { marginTop: 10 },
  bioInput: { minHeight: 110, paddingTop: 12 },
  inlineHint: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 6 },
  photoRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  photoSquare: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#222' },
  photoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#FFDC00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoLetter: { fontSize: 28, fontWeight: '900', color: '#0a0a0a' },
  photoMeta: { flex: 1 },
  photoHint: { fontSize: 11, color: 'rgba(255,255,255,0.32)', lineHeight: 16, marginBottom: 8 },
  photoHintMono: { fontFamily: 'Courier', color: 'rgba(255,220,0,0.65)' },
  photoUploadBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    marginBottom: 12,
  },
  photoUploadBtnText: { color: '#FFDC00', fontWeight: '700', fontSize: 13 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'transparent',
  },
  chipSelected: {
    borderColor: '#FFDC00',
    backgroundColor: 'rgba(255,220,0,0.12)',
  },
  chipText: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  chipTextSelected: { color: '#FFDC00', fontWeight: '700' },
  presetLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  addInput: { flex: 1 },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 100,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  secondaryBtn: {
    marginTop: 14,
    borderRadius: 100,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.45)',
  },
  planIosPricingHeading: {
    alignSelf: 'flex-start',
    marginTop: 20,
    marginBottom: 14,
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,220,0,0.88)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFDC00',
    textAlign: 'center',
  },
  btnDisabled: { opacity: 0.55 },
  inAppPayBlock: { marginTop: 20, gap: 0 },
  inAppPayTitle: { fontSize: 14, fontWeight: '800', color: '#ffffff', marginTop: 4 },
  inAppPaySub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.42)',
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 18,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  placeholderBox: {
    marginTop: 20,
    paddingVertical: 36,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderStyle: 'dashed',
  },
  placeholderText: { marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.35)' },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  notifyLabel: { fontSize: 15, fontWeight: '600', color: '#ffffff' },
  readOnly: { fontSize: 15, color: '#ffffff', fontWeight: '600' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 12,
  },
  linkRowLabel: { flex: 1, fontSize: 15, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  deleteAccountBtn: {
    alignSelf: 'stretch',
    marginTop: 24,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.55)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,60,60,0.08)',
  },
  deleteAccountText: { color: '#ff6b6b', fontSize: 15, fontWeight: '700' },
  logoutBtn: {
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,50,50,0.35)',
    borderRadius: 100,
    paddingHorizontal: 28,
    paddingVertical: 13,
  },
  logoutText: { color: '#ff5555', fontSize: 14, fontWeight: '600' },
  trialBarEmbedded: {
    marginTop: 14,
    marginBottom: 4,
  },
  currentPlanBox: {
    borderWidth: 1,
    borderColor: '#FFDC00',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    backgroundColor: 'rgba(255,220,0,0.06)',
  },
  currentPlanLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  currentPlanName: { fontSize: 20, fontWeight: '900', color: '#ffffff', marginBottom: 6 },
  currentPlanDesc: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },
  stripeHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 10, lineHeight: 17 },
  stripeFoot: { fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 16, lineHeight: 16 },
  seatWebPanel: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    gap: 8,
  },
  seatWebTitle: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  seatWebText: { fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },
  planIosFooter: {
    marginTop: 12,
    gap: 16,
    paddingBottom: 8,
  },
  planIosPriceHint: {
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.42)',
  },
  planIosStripeFoot: {
    marginTop: 0,
    marginBottom: 4,
    lineHeight: 18,
  },
  planIosLegalLinks: {
    marginTop: 4,
    marginBottom: 4,
  },
  planIosFooterBtn: {
    marginTop: 0,
    marginBottom: 0,
  },
  planIosFooterBtnLast: {
    marginBottom: 4,
  },
  planRowCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    backgroundColor: '#0a0a0a',
  },
  planRowCardCurrent: { borderColor: 'rgba(255,220,0,0.35)' },
  planRowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  planRowTitleCol: { flex: 1 },
  planRowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  planRowTitle: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  currentTag: {
    backgroundColor: 'rgba(255,220,0,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  currentTagText: { fontSize: 9, fontWeight: '800', color: '#FFDC00', letterSpacing: 0.5 },
  planRowPrice: { fontSize: 14, fontWeight: '700', color: '#FFDC00', marginTop: 4, marginBottom: 6 },
  planRowDesc: { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 17 },
  planRowCta: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  planRowCtaDisabled: { opacity: 0.45 },
  planRowCtaText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.65)' },
  planRowCtaTextDisabled: { color: 'rgba(255,255,255,0.35)' },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
  },
  segmentBtnActive: {
    borderColor: '#FFDC00',
    backgroundColor: 'rgba(255,220,0,0.1)',
  },
  segmentBtnText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  segmentBtnTextActive: { color: '#FFDC00' },
  pushStatusOn: { fontSize: 13, color: 'rgba(255,220,0,0.85)', fontWeight: '600', marginBottom: 10 },
  pushUnregisterBtn: { marginTop: 4, marginBottom: 12, alignSelf: 'stretch' },
  pushTypesTitle: { marginTop: 8, marginBottom: 8 },
  notifyBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 12,
  },
  notifyBlockText: { flex: 1 },
  notifyBlockTitle: { fontSize: 15, fontWeight: '600', color: '#ffffff', marginBottom: 4 },
  notifyBlockSub: { fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 16 },
  infoBanner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(255,220,0,0.06)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.15)',
  },
  infoBannerText: { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 19 },
  premiumHint: {
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    borderRadius: 10,
    padding: 12,
    backgroundColor: 'rgba(255,220,0,0.05)',
  },
  premiumHintText: { fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 17 },
  premiumHintLink: { color: '#FFDC00', fontWeight: '700' },
  linkToInvoices: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 20,
  },
  linkToInvoicesText: { fontSize: 14, fontWeight: '600', color: '#FFDC00' },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  projectRowBody: { flex: 1 },
  projectTitle: { fontSize: 15, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  projectMeta: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 2 },
  projectLink: { fontSize: 12, color: 'rgba(255,220,0,0.7)' },
  addProjectBtn: { marginTop: 12 },
})

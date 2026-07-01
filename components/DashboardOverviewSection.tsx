import { useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
  ScrollView,
} from 'react-native'
import { useRouter, type Href } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  AppWindow,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDollarSign,
  ExternalLink,
  MessageCircle,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { money } from '@/lib/invoiceFormatting'
import { getCreaWebBaseUrl, openCreaWebPath } from '@/lib/creaWeb'
import { isDevDemoWorkspaceRouteEnabled } from '@/lib/devDemoWorkspace'
import {
  isCeoProfile,
  isCompanyProfile,
  isFreelancerProfile,
} from '@/lib/profileRole'
import { isFreelancerPro } from '@/lib/freelancerPlan'
import {
  parseCeoSnapshot,
  quickActionsForRole,
  type DashboardOverviewData,
} from '@/lib/dashboardOverview'
import { DashboardSkeleton } from '@/components/ScreenSkeletons'
import { PlatformTrialBanners } from '@/components/PlatformTrialBanners'

type CeoQuick = { label: string; icon: LucideIcon; onPress: () => void }

export function DashboardOverviewSection({
  overview,
  loading,
  collapsed,
  onToggleCollapsed,
  showCollapseToggle = true,
}: {
  overview: DashboardOverviewData | null
  loading: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Off in bottom-sheet dashboard (close via sheet header). */
  showCollapseToggle?: boolean
}) {
  const router = useRouter()

  const role = overview?.role ?? null
  const name = overview?.name ?? ''
  const avatarUrl = overview?.avatarUrl
  const stats = overview?.stats ?? []
  const income = overview?.income
  const freelancerPlan = overview?.freelancerPlan ?? 'free'
  const companyPlan = overview?.companyPlan ?? 'free'

  const quickActions = useMemo(
    () => quickActionsForRole(role, { freelancerPlan, companyPlan }),
    [role, freelancerPlan, companyPlan]
  )

  const workspaceOnly =
    isFreelancerProfile(role ?? undefined) && !isFreelancerPro(freelancerPlan)

  if (loading && !overview) {
    return (
      <View style={styles.shell}>
        <DashboardSkeleton />
      </View>
    )
  }

  if (!overview) return null

  const firstName = name.split(' ')[0] || name || 'there'
  const webBase = getCreaWebBaseUrl()

  const collapseToggle = showCollapseToggle ? (
    <TouchableOpacity
      style={styles.collapseBtn}
      onPress={onToggleCollapsed}
      accessibilityRole="button"
      accessibilityLabel={collapsed ? 'Show overview' : 'Hide overview'}
    >
      <Text style={styles.collapseLabel}>{collapsed ? 'Show overview' : 'Hide overview'}</Text>
      {collapsed ? (
        <ChevronDown size={16} color="rgba(255,255,255,0.4)" strokeWidth={ICON_STROKE} />
      ) : (
        <ChevronUp size={16} color="rgba(255,255,255,0.4)" strokeWidth={ICON_STROKE} />
      )}
    </TouchableOpacity>
  ) : null

  const trialBanners = (
    <PlatformTrialBanners
      role={role}
      trialEndsAt={overview.trialEndsAt}
      accountCreatedAt={overview.accountCreatedAt}
      hasStripeCustomer={overview.hasStripeCustomer}
    />
  )

  if (collapsed) {
    return (
      <View style={styles.shell}>
        {trialBanners}
        <View style={styles.collapsedRow}>
          <View style={styles.collapsedGreeting}>
            <Text style={styles.collapsedHey}>Hey, {firstName}</Text>
            {stats.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {stats.map((s) => (
                  <View key={s.label} style={styles.chip}>
                    <Text style={styles.chipValue}>{s.value}</Text>
                    <Text style={styles.chipLabel}>{s.label}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>
          {collapseToggle}
        </View>
      </View>
    )
  }

  if (isCeoProfile(role ?? undefined)) {
    const snap = overview.ceoSnap ?? parseCeoSnapshot(null)
    const ceoRpcError = overview.ceoRpcError
    const statDefs: {
      label: string
      value: string
      sub: string
      Icon: LucideIcon
      onPress: () => void
    }[] = [
      {
        label: 'Platform users',
        value: String(snap.all_users),
        sub: 'Freelancers + companies',
        Icon: Users,
        onPress: () => router.push('/(tabs)/ceo-users' as Href),
      },
      {
        label: 'New users',
        value: String(snap.new_users),
        sub: 'Last 7 days',
        Icon: UserPlus,
        onPress: () =>
          router.push({ pathname: '/(tabs)/ceo-users', params: { view: 'recent' } } as Href),
      },
      {
        label: 'Active projects',
        value: String(snap.active_jobs),
        sub: 'Open listings',
        Icon: Briefcase,
        onPress: () => router.navigate('/(tabs)/jobs'),
      },
      {
        label: 'Completed',
        value: String(snap.completed_jobs),
        sub: 'Closed / filled',
        Icon: CircleCheck,
        onPress: () => router.navigate('/(tabs)/jobs'),
      },
    ]

    const ceoQuick: CeoQuick[] = [
      { label: 'Users', icon: Users, onPress: () => router.push('/(tabs)/ceo-users' as Href) },
      { label: 'Companies', icon: Building2, onPress: () => router.push('/(tabs)/ceo-companies' as Href) },
      { label: 'Subscriptions', icon: CircleDollarSign, onPress: () => router.push('/(tabs)/ceo-revenue' as Href) },
      { label: 'Messages', icon: MessageCircle, onPress: () => router.navigate('/(tabs)/messages') },
      { label: 'Job pool', icon: Briefcase, onPress: () => router.navigate('/(tabs)/jobs') },
      { label: 'Settings', icon: Settings2, onPress: () => router.push('/(tabs)/ceo-settings' as Href) },
      {
        label: 'Web admin',
        icon: ExternalLink,
        onPress: () => {
          if (webBase) Linking.openURL(webBase).catch(() => {})
        },
      },
      ...(isDevDemoWorkspaceRouteEnabled()
        ? [
            {
              label: 'Demo workspace',
              icon: AppWindow,
              onPress: () => router.push('/project/demo' as Href),
            } satisfies CeoQuick,
          ]
        : []),
    ]

    return (
      <View style={styles.shell}>
        {trialBanners}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.ceoKicker}>WELCOME BACK</Text>
            <Text style={styles.greeting}>{firstName}</Text>
            <Text style={styles.roleLabel}>Platform CEO</Text>
          </View>
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={() => router.push('/(tabs)/profile-preview' as Href)}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarLetter}>{name.charAt(0).toUpperCase() || 'C'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {ceoRpcError ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Couldn’t load CEO metrics</Text>
            <Text style={styles.bannerText}>{ceoRpcError}</Text>
          </View>
        ) : null}

        {!ceoRpcError && overview.ceoSnap != null && !overview.ceoSnap.ok ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>CEO access not active</Text>
            <Text style={styles.bannerText}>Your profile role must be ceo in profiles.</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Platform overview</Text>
        <View style={styles.ceoGrid}>
          {statDefs.map((s) => {
            const Icon = s.Icon
            return (
              <TouchableOpacity key={s.label} style={styles.ceoTile} onPress={s.onPress} activeOpacity={0.75}>
                <View style={styles.actionIconWrap}>
                  <Icon size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
                </View>
                <Text style={styles.statLabel}>{s.label}</Text>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statSub}>{s.sub}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.actionsGrid}>
          {ceoQuick.map((a) => {
            const Icon = a.icon
            const disabled = a.label === 'Web admin' && !webBase
            return (
              <TouchableOpacity
                key={a.label}
                style={[styles.actionCard, disabled && styles.actionCardDisabled]}
                onPress={a.onPress}
                disabled={disabled}
                activeOpacity={0.7}
              >
                <View style={styles.actionIconWrap}>
                  <Icon size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        {collapseToggle}
        <View style={styles.divider} />
      </View>
    )
  }

  return (
    <View style={styles.shell}>
      {trialBanners}
      <View style={styles.header}>
        <View style={styles.headerText}>
          {isCompanyProfile(role ?? undefined) ? (
            <Text style={styles.companyKicker}>HIRING ON CREA</Text>
          ) : null}
          <Text style={styles.greeting}>Hey, {firstName}</Text>
          <Text style={styles.roleLabel}>
            {isCompanyProfile(role ?? undefined) ? 'Company account' : 'Freelancer account'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.avatarCircle}
          onPress={() => router.push('/(tabs)/profile-preview' as Href)}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarLetter}>{name.charAt(0).toUpperCase()}</Text>
          )}
        </TouchableOpacity>
      </View>

      {!workspaceOnly && income ? (
        <>
          <Text style={styles.sectionTitle}>
            {isCompanyProfile(role ?? undefined) ? 'Invoice overview' : 'Income overview'}
          </Text>
          <View style={styles.incomeRow}>
            <View style={styles.incomeCard}>
              <Text style={styles.incomeLabel}>Paid</Text>
              <Text style={styles.incomeValue}>{money(income.paid, income.currency)}</Text>
            </View>
            <View style={styles.incomeCard}>
              <Text style={styles.incomeLabel}>Incoming</Text>
              <Text style={styles.incomeValue}>{money(income.incoming, income.currency)}</Text>
            </View>
            <View style={styles.incomeCard}>
              <Text style={styles.incomeLabel}>Overdue</Text>
              <Text style={styles.incomeValue}>{money(income.overdue, income.currency)}</Text>
            </View>
          </View>
        </>
      ) : null}

      {workspaceOnly ? (
        <View style={styles.workspaceBanner}>
          <Text style={styles.workspaceBannerTitle}>Free plan</Text>
          <Text style={styles.workspaceBannerText}>
            Browse jobs and use Workspace with Call Sheet + Shot List. Upgrade to Pro to apply, invoice, and unlock production tools.
          </Text>
        </View>
      ) : null}

      {!workspaceOnly && stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text
                style={[
                  styles.statValue,
                  isCompanyProfile(role ?? undefined) && stats.length > 2 ? styles.statValueTight : null,
                ]}
              >
                {s.value}
              </Text>
              <Text style={styles.statSub}>{s.sub}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Quick actions</Text>
      <View style={styles.actionsGrid}>
        {quickActions.map((a) => {
          const Icon = a.icon
          return (
            <TouchableOpacity
              key={a.label}
              style={[styles.actionCard, a.disabled && styles.actionCardDisabled]}
              activeOpacity={0.7}
              disabled={!!a.disabled}
              onPress={() => {
                if (a.disabled) return
                if (a.href) {
                  router.push(a.href as Href)
                  return
                }
                if (a.webPath) void openCreaWebPath(a.webPath)
              }}
            >
              <View style={styles.actionIconWrap}>
                <Icon
                  size={20}
                  color={a.disabled ? 'rgba(255,220,0,0.22)' : '#FFDC00'}
                  strokeWidth={ICON_STROKE}
                />
              </View>
              <Text style={[styles.actionLabel, a.disabled && styles.actionLabelMuted]}>{a.label}</Text>
              {a.hint ? <Text style={styles.actionHint}>{a.hint}</Text> : null}
            </TouchableOpacity>
          )
        })}
      </View>

      {collapseToggle}
      <View style={styles.divider} />
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { marginBottom: 4 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 16,
  },
  headerText: { flex: 1, minWidth: 0, paddingRight: 12 },
  companyKicker: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 4,
  },
  ceoKicker: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 4,
  },
  greeting: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  roleLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFDC00',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 44, height: 44, borderRadius: 22 },
  avatarLetter: { fontSize: 18, fontWeight: '800', color: '#0a0a0a' },
  incomeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  incomeCard: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  incomeLabel: {
    fontSize: 8,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  incomeValue: { fontSize: 13, fontWeight: '800', color: '#FFDC00' },
  workspaceBanner: {
    backgroundColor: 'rgba(255,220,0,0.06)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.14)',
  },
  workspaceBannerTitle: { fontSize: 13, fontWeight: '700', color: '#FFDC00', marginBottom: 4 },
  workspaceBannerText: { fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.55)' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  statValue: { fontSize: 28, fontWeight: '900', color: '#FFDC00', lineHeight: 32 },
  statValueTight: { fontSize: 22, lineHeight: 26 },
  statSub: { fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 },
  sectionTitle: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
  },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  actionCard: {
    width: '47%',
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  actionCardDisabled: { opacity: 0.55 },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionLabel: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  actionLabelMuted: { color: 'rgba(255,255,255,0.38)' },
  actionHint: { fontSize: 9, color: 'rgba(255,255,255,0.28)', marginTop: 4, lineHeight: 13 },
  ceoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  ceoTile: {
    width: '47%',
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  banner: {
    backgroundColor: 'rgba(255,80,80,0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.2)',
  },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: '#fca5a5', marginBottom: 4 },
  bannerText: { fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 18 },
  collapseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 4,
  },
  collapseLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.35)', letterSpacing: 0.5 },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingBottom: 8,
  },
  collapsedGreeting: { flex: 1, minWidth: 0 },
  collapsedHey: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 8 },
  chipScroll: { flexGrow: 0 },
  chip: {
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  chipValue: { fontSize: 16, fontWeight: '800', color: '#FFDC00' },
  chipLabel: { fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 2, textTransform: 'uppercase' },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 12,
    marginBottom: 16,
  },
})

import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, type Href } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  Briefcase,
  Building2,
  CalendarDays,
  CircleCheck,
  CircleDollarSign,
  ClipboardList,
  ExternalLink,
  LayoutGrid,
  MessageCircle,
  PlusCircle,
  Receipt,
  Search,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { money } from '@/lib/invoiceFormatting'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'

type IncomeTotals = { paid: number; incoming: number; overdue: number; currency: string }

function computeIncomeTotals(
  rows: { amount: number | null; currency: string | null; status: string | null; due_date: string | null }[]
): IncomeTotals {
  const out: IncomeTotals = { paid: 0, incoming: 0, overdue: 0, currency: 'EUR' }
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  for (const r of rows) {
    const amt = typeof r.amount === 'number' ? r.amount : 0
    const st = (r.status || '').toLowerCase()
    if (r.currency) out.currency = r.currency
    if (st === 'paid') {
      out.paid += amt
      continue
    }
    if (st === 'overdue') {
      out.overdue += amt
      continue
    }
    if (st === 'pending' || st === 'draft') {
      const due = r.due_date ? new Date(r.due_date) : null
      if (due && due < startOfToday && st === 'pending') out.overdue += amt
      else out.incoming += amt
    }
  }
  return out
}

type StatCard = { label: string; value: string; sub: string }

type QuickAction = { label: string; icon: LucideIcon; href: `/(tabs)/${string}` }

type CeoSnapshot = {
  ok: boolean
  all_users: number
  new_users: number
  active_jobs: number
  completed_jobs: number
  recent_users: { id: string; name: string; role: string; avatar_url: string | null }[]
}

function parseCeoSnapshot(raw: unknown): CeoSnapshot {
  const empty: CeoSnapshot = {
    ok: false,
    all_users: 0,
    new_users: 0,
    active_jobs: 0,
    completed_jobs: 0,
    recent_users: [],
  }
  if (!raw || typeof raw !== 'object') return empty
  const o = raw as Record<string, unknown>
  const recent = Array.isArray(o.recent_users) ? o.recent_users : []
  return {
    ok: o.ok === true,
    all_users: Number(o.all_users) || 0,
    new_users: Number(o.new_users) || 0,
    active_jobs: Number(o.active_jobs) || 0,
    completed_jobs: Number(o.completed_jobs) || 0,
    recent_users: recent.map((r) => {
      const row = r as Record<string, unknown>
      const av = row.avatar_url
      return {
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        role: String(row.role ?? ''),
        avatar_url: typeof av === 'string' ? av : null,
      }
    }),
  }
}

function quickActionsForRole(role: string | null): QuickAction[] {
  if (isCompanyProfile(role ?? undefined)) {
    return [
      { label: 'Company tools', icon: LayoutGrid, href: '/(tabs)/company-hub' },
      { label: 'Post job', icon: PlusCircle, href: '/(tabs)/company-post-job' },
      { label: 'Applications', icon: ClipboardList, href: '/(tabs)/company-applications' },
      { label: 'My jobs', icon: Briefcase, href: '/(tabs)/company-my-jobs' },
      { label: 'Job feed', icon: Search, href: '/(tabs)/jobs' },
      { label: 'Messages', icon: MessageCircle, href: '/(tabs)/messages' },
      { label: 'Invoices', icon: Receipt, href: '/(tabs)/invoices' },
      { label: 'Settings', icon: Settings2, href: '/(tabs)/profile' },
    ]
  }
  const base: QuickAction[] = [
    { label: 'Browse jobs', icon: Briefcase, href: '/(tabs)/jobs' },
    { label: 'Messages', icon: MessageCircle, href: '/(tabs)/messages' },
    { label: 'Invoices', icon: Receipt, href: '/(tabs)/invoices' },
  ]
  if (isFreelancerProfile(role ?? undefined)) {
    base.push({ label: 'Availability', icon: CalendarDays, href: '/(tabs)/availability' })
  }
  base.push({ label: 'Settings', icon: Settings2, href: '/(tabs)/profile' })
  return base
}

type CeoQuick = { label: string; icon: LucideIcon; onPress: () => void }

export default function DashboardScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [stats, setStats] = useState<StatCard[]>([])
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [income, setIncome] = useState<IncomeTotals | null>(null)
  const [ceoSnap, setCeoSnap] = useState<CeoSnapshot | null>(null)
  const [ceoRpcError, setCeoRpcError] = useState<string | null>(null)
  const quickActions = quickActionsForRole(role)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('name, role, avatar_url')
        .eq('id', user.id)
        .single()

      setName(profile?.name ?? '')
      const resolvedRole = resolveAppRole(profile?.role, user)
      setRole(resolvedRole || null)
      const av = (profile?.avatar_url as string | undefined)?.trim()
      setAvatarUrl(av && /^https?:\/\//i.test(av) ? av : null)

      if (isCeoProfile(resolvedRole)) {
        setCeoRpcError(null)
        const { data: ceoData, error: ceoErr } = await supabase.rpc('ceo_dashboard_snapshot')
        if (ceoErr) {
          setCeoRpcError(ceoErr.message)
          setCeoSnap(null)
        } else {
          setCeoSnap(parseCeoSnapshot(ceoData))
        }
        setStats([])
        setIncome(null)
        setLoading(false)
        return
      }

      setCeoSnap(null)
      setCeoRpcError(null)

      if (isCompanyProfile(resolvedRole)) {
        const { count: jobCount } = await supabase
          .from('jobs').select('*', { count: 'exact', head: true })
          .eq('company_id', user.id).eq('status', 'active')
        const { count: invCount } = await supabase
          .from('invoices').select('*', { count: 'exact', head: true })
          .eq('company_id', user.id).eq('status', 'pending')

        const { data: myJobRows } = await supabase.from('jobs').select('id').eq('company_id', user.id)
        const jobIds = (myJobRows ?? []).map((r) => r.id as string).filter(Boolean)
        let pendingApps = 0
        if (jobIds.length > 0) {
          const { count: appCount } = await supabase
            .from('job_applications')
            .select('*', { count: 'exact', head: true })
            .in('job_id', jobIds)
            .eq('status', 'pending')
          pendingApps = appCount ?? 0
        }

        setStats([
          { label: 'Active jobs', value: String(jobCount ?? 0), sub: 'Open' },
          { label: 'Pending apps', value: String(pendingApps), sub: 'To review' },
          { label: 'Open invoices', value: String(invCount ?? 0), sub: 'Pending' },
        ])
        setIncome(null)
      } else {
        const { count: appCount } = await supabase
          .from('job_applications').select('*', { count: 'exact', head: true })
          .eq('freelancer_id', user.id).eq('status', 'pending')
        const { count: viewCount } = await supabase
          .from('profile_views').select('*', { count: 'exact', head: true })
          .eq('viewed_freelancer_id', user.id)

        setStats([
          { label: 'Applications', value: String(appCount ?? 0), sub: 'Pending' },
          { label: 'Profile views', value: String(viewCount ?? 0), sub: 'Total' },
        ])

        const { data: invs } = await supabase
          .from('invoices')
          .select('amount, currency, status, due_date')
          .eq('freelancer_id', user.id)
        setIncome(computeIncomeTotals(invs ?? []))
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  const webBase = getCreaWebBaseUrl()
  const ceoQuick: CeoQuick[] = [
    { label: 'Users', icon: Users, onPress: () => router.push('/(tabs)/ceo-users' as Href) },
    { label: 'Companies', icon: Building2, onPress: () => router.push('/(tabs)/ceo-companies' as Href) },
    { label: 'Subscriptions', icon: CircleDollarSign, onPress: () => router.push('/(tabs)/ceo-revenue' as Href) },
    { label: 'Messages', icon: MessageCircle, onPress: () => router.navigate('/(tabs)/messages') },
    { label: 'Jobs', icon: Briefcase, onPress: () => router.navigate('/(tabs)/jobs') },
    { label: 'Settings', icon: Settings2, onPress: () => router.push('/(tabs)/ceo-settings' as Href) },
    {
      label: 'Web admin',
      icon: ExternalLink,
      onPress: () => {
        if (webBase) Linking.openURL(webBase).catch(() => {})
      },
    },
  ]

  if (isCeoProfile(role)) {
    const snap = ceoSnap ?? parseCeoSnapshot(null)
    const statDefs: {
      label: string
      value: string
      sub: string
      Icon: LucideIcon
      onPress: () => void
    }[] = [
      {
        label: 'All users',
        value: String(snap.all_users),
        sub: 'With login',
        Icon: Users,
        onPress: () => router.push('/(tabs)/ceo-users' as Href),
      },
      {
        label: 'New users',
        value: String(snap.new_users),
        sub: 'Last 7 days',
        Icon: UserPlus,
        onPress: () =>
          router.push({
            pathname: '/(tabs)/ceo-users',
            params: { view: 'recent' },
          } as Href),
      },
      {
        label: 'Active jobs',
        value: String(snap.active_jobs),
        sub: 'Open listings',
        Icon: Briefcase,
        onPress: () => router.navigate('/(tabs)/jobs'),
      },
      {
        label: 'Completed jobs',
        value: String(snap.completed_jobs),
        sub: 'Closed / filled',
        Icon: CircleCheck,
        onPress: () => router.navigate('/(tabs)/jobs'),
      },
    ]
    const first = name.split(' ')[0] || name || 'there'

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.ceoHeaderText}>
              <Text style={styles.ceoKicker}>WELCOME BACK</Text>
              <Text style={styles.greeting}>{first}</Text>
              <Text style={styles.roleLabel}>Platform CEO</Text>
            </View>
            <View style={styles.avatarCircle}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarLetter}>{name.charAt(0).toUpperCase() || 'C'}</Text>
              )}
            </View>
          </View>

          {ceoRpcError ? (
            <View style={styles.ceoBanner}>
              <Text style={styles.ceoBannerTitle}>Couldn’t load CEO metrics</Text>
              <Text style={styles.ceoBannerText}>{ceoRpcError}</Text>
              <Text style={styles.ceoBannerHint}>
                In Supabase → SQL Editor, run <Text style={styles.ceoMono}>supabase/sql/ceo_dashboard_rpc.sql</Text>.
              </Text>
            </View>
          ) : null}

          {!ceoRpcError && ceoSnap != null && !ceoSnap.ok ? (
            <View style={styles.ceoBanner}>
              <Text style={styles.ceoBannerTitle}>CEO access not active</Text>
              <Text style={styles.ceoBannerText}>
                Your profile role must be <Text style={styles.ceoMono}>ceo</Text> in the{' '}
                <Text style={styles.ceoMono}>profiles</Text> table for this dashboard.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Platform overview</Text>
          <View style={styles.ceoStatsGrid}>
            {statDefs.map((s) => {
              const Icon = s.Icon
              return (
                <TouchableOpacity
                  key={s.label}
                  style={styles.ceoStatTile}
                  activeOpacity={0.75}
                  onPress={s.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.label}: ${s.value}. ${s.sub}. Tap to open.`}
                >
                  <View style={styles.ceoStatIconWrap}>
                    <Icon size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                  </View>
                  <Text style={styles.ceoStatLabel}>{s.label}</Text>
                  <Text style={styles.ceoStatValue}>{s.value}</Text>
                  <Text style={styles.ceoStatSub}>{s.sub}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.sectionTitle}>Recent users</Text>
          <View style={styles.ceoRecentCard}>
            {snap.recent_users.length === 0 ? (
              <Text style={styles.ceoRecentEmpty}>No profiles yet</Text>
            ) : (
              snap.recent_users.map((u) => {
                const uri = u.avatar_url?.trim() ?? ''
                const show = /^https?:\/\//i.test(uri)
                const initial = (u.name || '?').trim().charAt(0).toUpperCase() || '?'
                return (
                  <TouchableOpacity
                    key={u.id}
                    style={styles.ceoRecentRow}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/profile/${u.id}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open public profile for ${u.name.trim() || 'user'}`}
                  >
                    {show ? (
                      <Image source={{ uri }} style={styles.ceoRecentAvatar} />
                    ) : (
                      <View style={styles.ceoRecentAvatarPh}>
                        <Text style={styles.ceoRecentAvatarLetter}>{initial}</Text>
                      </View>
                    )}
                    <View style={styles.ceoRecentMeta}>
                      <Text style={styles.ceoRecentName} numberOfLines={1}>
                        {u.name.trim() || 'Unnamed'}
                      </Text>
                      <Text style={styles.ceoRecentRole} numberOfLines={1}>
                        {(u.role || '—').trim()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )
              })
            )}
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
                  activeOpacity={0.7}
                  onPress={a.onPress}
                  disabled={disabled}
                >
                  <View style={styles.actionIconWrap}>
                    <Icon size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                  </View>
                  <Text style={styles.actionLabel}>{a.label}</Text>
                  {disabled ? (
                    <Text style={styles.ceoHint}>Set EXPO_PUBLIC_CREA_WEB_URL</Text>
                  ) : null}
                </TouchableOpacity>
              )
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            {isCompanyProfile(role) ? (
              <Text style={styles.companyKicker}>HIRING ON CREA</Text>
            ) : null}
            <Text style={styles.greeting}>Hey, {name.split(' ')[0]}</Text>
            <Text style={styles.roleLabel}>
              {isCompanyProfile(role) ? 'Company account' : 'Freelancer account'}
            </Text>
          </View>
          <View style={styles.avatarCircle}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarLetter}>{name.charAt(0).toUpperCase()}</Text>
            )}
          </View>
        </View>

        {income ? (
          <>
            <Text style={styles.sectionTitle}>Income overview</Text>
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

        {/* Stats */}
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text
                style={[
                  styles.statValue,
                  isCompanyProfile(role) && stats.length > 2 ? styles.statValueTight : null,
                ]}
              >
                {s.value}
              </Text>
              <Text style={styles.statSub}>{s.sub}</Text>
            </View>
          ))}
        </View>

        {isCompanyProfile(role) ? (
          <TouchableOpacity
            style={styles.companyToolsBanner}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/company-hub' as Href)}
          >
            <Building2 size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <View style={styles.companyToolsBannerText}>
              <Text style={styles.companyToolsBannerTitle}>Company tools</Text>
              <Text style={styles.companyToolsBannerSub}>
                Post jobs, review applicants, incoming invoices, and profile — all in one place.
              </Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.actionsGrid}>
          {quickActions.map((a) => {
            const Icon = a.icon
            return (
              <TouchableOpacity
                key={a.href}
                style={styles.actionCard}
                activeOpacity={0.7}
                onPress={() => router.navigate(a.href as Href)}
              >
                <View style={styles.actionIconWrap}>
                  <Icon size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  loadingContainer: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  /** Horizontal padding here so content + tab bar align; extra bottom so last row clears the tab bar. */
  scrollContent: { paddingHorizontal: 20, paddingBottom: 28 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 20, paddingBottom: 28,
  },
  greeting: { fontSize: 26, fontWeight: '800', color: '#ffffff', letterSpacing: 0.3 },
  roleLabel: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4, letterSpacing: 1, textTransform: 'uppercase' },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFDC00', justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  avatarImage: { width: 44, height: 44, borderRadius: 22 },
  avatarLetter: { fontSize: 18, fontWeight: '800', color: '#0a0a0a' },
  incomeRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  incomeCard: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  incomeLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  incomeValue: { fontSize: 14, fontWeight: '800', color: '#FFDC00' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  statCard: {
    flex: 1, backgroundColor: '#111111',
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  statLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  statValue: { fontSize: 36, fontWeight: '900', color: '#FFDC00', lineHeight: 40 },
  statValueTight: { fontSize: 26, lineHeight: 30 },
  statSub: { fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 4 },
  sectionTitle: {
    fontSize: 11, color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12,
  },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 40 },
  actionCard: {
    width: '47%', backgroundColor: '#111111',
    borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'flex-start',
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  actionLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  ceoHeaderText: { flex: 1, paddingRight: 12 },
  ceoKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 6,
  },
  ceoStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
  ceoStatTile: {
    width: '47%',
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  ceoStatIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  ceoStatLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  ceoStatValue: { fontSize: 28, fontWeight: '900', color: '#FFDC00', lineHeight: 32 },
  ceoStatSub: { fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 4 },
  ceoBanner: {
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  ceoBannerTitle: { fontSize: 14, fontWeight: '800', color: '#FFDC00', marginBottom: 6 },
  ceoBannerText: { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 19 },
  ceoBannerHint: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 8, lineHeight: 16 },
  ceoMono: { fontFamily: 'monospace', fontSize: 12, color: '#FFDC00' },
  ceoRecentCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  ceoRecentEmpty: { fontSize: 13, color: 'rgba(255,255,255,0.35)', paddingVertical: 8 },
  ceoRecentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  ceoRecentAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#222' },
  ceoRecentAvatarPh: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,220,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ceoRecentAvatarLetter: { fontSize: 16, fontWeight: '800', color: '#FFDC00' },
  ceoRecentMeta: { flex: 1 },
  ceoRecentName: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  ceoRecentRole: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2, textTransform: 'capitalize' },
  actionCardDisabled: { opacity: 0.45 },
  ceoHint: { fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  companyKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 6,
  },
  companyToolsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.15)',
  },
  companyToolsBannerText: { flex: 1 },
  companyToolsBannerTitle: { fontSize: 16, fontWeight: '800', color: '#ffffff', marginBottom: 4 },
  companyToolsBannerSub: { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 17 },
})

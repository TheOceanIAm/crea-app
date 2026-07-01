import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, type Href } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { useCeoAccess } from '@/lib/useCeoAccess'
import {
  COMPANY_PLAN_PRICE_EUR,
  FREELANCER_PLAN_PRICE_EUR,
} from '@/lib/planCatalogPrices'
import {
  computeCeoMrrTotals,
  formatCeoMrr,
  loadCeoMrrCounts,
  type CeoMrrTotals,
} from '@/lib/ceoPlatformMetrics'

type PlanRow = { label: string; count: number; price: number }

function PlanBreakdown({
  title,
  rows,
  subtotal,
}: {
  title: string
  rows: PlanRow[]
  subtotal: number
}) {
  return (
    <View style={styles.breakdownCard}>
      <Text style={styles.breakdownTitle}>{title}</Text>
      {rows.map((row) => (
        <View key={row.label} style={styles.planRow}>
          <View style={styles.planLeft}>
            <Text style={styles.planLabel}>{row.label}</Text>
            <Text style={styles.planPrice}>
              {row.price > 0 ? `${formatCeoMrr(row.price)}/mo` : 'Free (€0)'}
            </Text>
          </View>
          <View style={styles.planRight}>
            <Text style={styles.planUsers}>{row.count} users</Text>
            <Text style={styles.planRev}>
              {row.price > 0 ? formatCeoMrr(row.count * row.price) : '—'}
            </Text>
          </View>
        </View>
      ))}
      <View style={styles.subtotalRow}>
        <Text style={styles.subtotalLabel}>Subtotal (paid tiers)</Text>
        <Text style={styles.subtotalValue}>{formatCeoMrr(subtotal)}/mo</Text>
      </View>
    </View>
  )
}

export default function CeoRevenueScreen() {
  const router = useRouter()
  const { ready, allowed } = useCeoAccess()
  const [loading, setLoading] = useState(true)
  const [mrr, setMrr] = useState<CeoMrrTotals | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async (isRefresh?: boolean) => {
      if (!allowed) return
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setHint(null)
      try {
        const counts = await loadCeoMrrCounts(supabase)
        setMrr(computeCeoMrrTotals(counts))
      } catch (e) {
        setHint(e instanceof Error ? e.message : 'Could not load subscription data.')
        setMrr(null)
      }
      setLoading(false)
      setRefreshing(false)
    },
    [allowed]
  )

  useEffect(() => {
    if (ready && allowed) load()
  }, [ready, allowed, load])

  const freelancerRows = useMemo<PlanRow[]>(
    () => [
      { label: 'Free', count: mrr?.freelancerFree ?? 0, price: 0 },
      {
        label: 'Pro',
        count: mrr?.freelancerPro ?? 0,
        price: FREELANCER_PLAN_PRICE_EUR.proMonthly,
      },
    ],
    [mrr]
  )

  const companyRows = useMemo<PlanRow[]>(
    () => [
      { label: 'Free trial', count: mrr?.companyFree ?? 0, price: 0 },
      { label: 'Pro', count: mrr?.companyPro ?? 0, price: COMPANY_PLAN_PRICE_EUR.proMonthly },
    ],
    [mrr]
  )

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.deniedTitle}>Access denied</Text>
          <Text style={styles.deniedSub}>This area is for CEO accounts only.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Dashboard</Text>
      </TouchableOpacity>

      <Text style={styles.kicker}>PLATFORM</Text>
      <Text style={styles.title}>Monthly revenue</Text>
      <Text style={styles.subtitle}>
        Recurring revenue from live plan counts — same basis as the web CEO dashboard. Beta testers
        are excluded.
      </Text>

      {hint ? (
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      ) : null}

      {loading && !mrr ? (
        <View style={styles.listPad}>
          <ActivityIndicator color="#FFDC00" />
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#FFDC00" />
        }
      >
        {mrr ? (
          <>
            <View style={styles.heroGrid}>
              <View style={[styles.heroCard, styles.heroCardAccent]}>
                <Text style={styles.heroLabel}>Total MRR</Text>
                <Text style={styles.heroValue}>{formatCeoMrr(mrr.totalMrr)}</Text>
              </View>
              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Freelancer rev.</Text>
                <Text style={styles.heroValueSm}>{formatCeoMrr(mrr.freelancerMrr)}</Text>
              </View>
              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Company rev.</Text>
                <Text style={styles.heroValueSm}>{formatCeoMrr(mrr.companyMrr)}</Text>
              </View>
              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Active subs</Text>
                <Text style={styles.heroValueSm}>{mrr.totalSubs}</Text>
              </View>
            </View>

            <PlanBreakdown
              title="Freelancer subscriptions"
              rows={freelancerRows}
              subtotal={mrr.freelancerMrr}
            />
            <PlanBreakdown
              title="Company subscriptions"
              rows={companyRows}
              subtotal={mrr.companyMrr}
            />

            <View style={styles.infoCard}>
              <Text style={styles.infoText}>
                Counts come from freelancer and company plan rows in Supabase. Pro MRR uses list
                prices ({formatCeoMrr(FREELANCER_PLAN_PRICE_EUR.proMonthly)}/mo freelancer,{' '}
                {formatCeoMrr(COMPANY_PLAN_PRICE_EUR.proMonthly)}/mo company). Beta invite accounts
                are omitted from these totals.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.linkOut}
              onPress={() => router.push('/(tabs)/invoices' as Href)}
              activeOpacity={0.75}
            >
              <Text style={styles.linkOutText}>Open job invoices (B2B) →</Text>
            </TouchableOpacity>
          </>
        ) : !loading ? (
          <Text style={styles.empty}>Could not load subscription revenue.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 20 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, alignSelf: 'flex-start' },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: { fontSize: 26, fontWeight: '900', color: '#ffffff', marginBottom: 8 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.42)', lineHeight: 19, marginBottom: 12 },
  hintBox: {
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  hintText: { fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 17 },
  listPad: { paddingVertical: 24 },
  scrollContent: { paddingBottom: 48 },
  heroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  heroCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  heroCardAccent: { borderColor: 'rgba(255,220,0,0.22)' },
  heroLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  heroValue: { fontSize: 28, fontWeight: '900', color: '#FFDC00' },
  heroValueSm: { fontSize: 22, fontWeight: '800', color: '#ffffff' },
  breakdownCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  breakdownTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  planLeft: { flex: 1, minWidth: 0 },
  planLabel: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  planPrice: { fontSize: 11, color: 'rgba(255,255,255,0.32)', marginTop: 3 },
  planRight: { alignItems: 'flex-end' },
  planUsers: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  planRev: { fontSize: 14, fontWeight: '800', color: '#ffffff', marginTop: 4 },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  subtotalLabel: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  subtotalValue: { fontSize: 14, fontWeight: '800', color: '#FFDC00' },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  infoText: { fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },
  linkOut: { paddingVertical: 14, marginBottom: 8 },
  linkOutText: { fontSize: 14, fontWeight: '600', color: '#FFDC00' },
  empty: { color: 'rgba(255,255,255,0.35)', fontSize: 14, textAlign: 'center', marginTop: 24 },
  deniedTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  deniedSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
})

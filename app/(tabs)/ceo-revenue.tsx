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
import { money } from '@/lib/invoiceFormatting'

type TierBreakdown = { gross: number; net: number; count: number }

type AudienceRevenue = {
  gross: number
  net: number
  count: number
  by_tier: Record<string, TierBreakdown>
}

type SubSnap = {
  ok: boolean
  has_revenue_table: boolean
  currency: string
  gross_total: number
  net_total: number
  vat_total: number
  entry_count: number
  month_gross: number | null
  month_net: number | null
  by_audience: Record<string, AudienceRevenue>
  plan_distribution: Record<string, Record<string, number>>
  hint?: string
  error?: string
}

function parseTierBreakdown(raw: unknown): TierBreakdown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { gross: 0, net: 0, count: 0 }
  }
  const o = raw as Record<string, unknown>
  return {
    gross: Number(o.gross) || 0,
    net: Number(o.net) || 0,
    count: Number(o.count) || 0,
  }
}

function parseAudienceRevenue(raw: unknown): AudienceRevenue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const by: Record<string, TierBreakdown> = {}
  if (o.by_tier && typeof o.by_tier === 'object' && !Array.isArray(o.by_tier)) {
    for (const [k, v] of Object.entries(o.by_tier as Record<string, unknown>)) {
      by[k] = parseTierBreakdown(v)
    }
  }
  return {
    gross: Number(o.gross) || 0,
    net: Number(o.net) || 0,
    count: Number(o.count) || 0,
    by_tier: by,
  }
}

function parsePlanDistribution(raw: unknown): Record<string, Record<string, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Record<string, number>> = {}
  for (const [aud, tiers] of Object.entries(raw as Record<string, unknown>)) {
    if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) continue
    const inner: Record<string, number> = {}
    for (const [tier, cnt] of Object.entries(tiers as Record<string, unknown>)) {
      inner[tier] = Number(cnt) || 0
    }
    out[aud] = inner
  }
  return out
}

function parseSubSnap(raw: unknown): SubSnap {
  const empty: SubSnap = {
    ok: false,
    has_revenue_table: false,
    currency: 'EUR',
    gross_total: 0,
    net_total: 0,
    vat_total: 0,
    entry_count: 0,
    month_gross: null,
    month_net: null,
    by_audience: {},
    plan_distribution: {},
  }
  if (!raw || typeof raw !== 'object') return empty
  const o = raw as Record<string, unknown>
  const by: Record<string, AudienceRevenue> = {}
  if (o.by_audience && typeof o.by_audience === 'object' && !Array.isArray(o.by_audience)) {
    for (const [k, v] of Object.entries(o.by_audience as Record<string, unknown>)) {
      const ar = parseAudienceRevenue(v)
      if (ar) by[k] = ar
    }
  }
  const mg = o.month_gross
  const mn = o.month_net
  return {
    ok: o.ok === true,
    has_revenue_table: o.has_revenue_table === true,
    currency: String(o.currency || 'EUR'),
    gross_total: Number(o.gross_total) || 0,
    net_total: Number(o.net_total) || 0,
    vat_total: Number(o.vat_total) || 0,
    entry_count: Number(o.entry_count) || 0,
    month_gross: mg === null || mg === undefined ? null : Number(mg),
    month_net: mn === null || mn === undefined ? null : Number(mn),
    by_audience: by,
    plan_distribution: parsePlanDistribution(o.plan_distribution),
    hint: typeof o.hint === 'string' ? o.hint : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  }
}

function tierSortKey(t: string) {
  const order = ['starter', 'pro', 'premium']
  const i = order.indexOf(t.toLowerCase())
  return i >= 0 ? i : 99
}

function AudienceBlock({
  label,
  data,
  plans,
  currency,
}: {
  label: string
  data: AudienceRevenue | undefined
  plans: Record<string, number> | undefined
  currency: string
}) {
  const tiers = useMemo(() => {
    const keys = new Set<string>()
    if (data?.by_tier) {
      for (const k of Object.keys(data.by_tier)) keys.add(k)
    }
    if (plans) {
      for (const k of Object.keys(plans)) keys.add(k)
    }
    return Array.from(keys).sort((a, b) => tierSortKey(a) - tierSortKey(b) || a.localeCompare(b))
  }, [data?.by_tier, plans])

  const gross = data?.gross ?? 0
  const net = data?.net ?? 0
  const booked = data?.count ?? 0

  return (
    <View style={styles.audienceCard}>
      <Text style={styles.audienceTitle}>{label}</Text>
      <View style={styles.audienceTotals}>
        <View style={styles.audienceMetric}>
          <Text style={styles.audienceMetricLabel}>Gross</Text>
          <Text style={styles.audienceMetricValue}>{money(gross, currency)}</Text>
        </View>
        <View style={styles.audienceMetric}>
          <Text style={styles.audienceMetricLabel}>Net</Text>
          <Text style={styles.audienceMetricValue}>{money(net, currency)}</Text>
        </View>
      </View>
      {booked > 0 ? (
        <Text style={styles.bookedLine}>{booked} booked payment{booked === 1 ? '' : 's'}</Text>
      ) : null}

      {tiers.length > 0 ? (
        <>
          <Text style={styles.tierSectionLabel}>By plan tier</Text>
          {tiers.map((tier) => {
            const rev = data?.by_tier?.[tier]
            const seats = plans?.[tier] ?? 0
            return (
              <View key={tier} style={styles.tierRow}>
                <Text style={styles.tierName}>{tier}</Text>
                <View style={styles.tierRight}>
                  <Text style={styles.tierMoney}>
                    {rev ? `${money(rev.gross, currency)} gross · ${money(rev.net, currency)} net` : '—'}
                  </Text>
                  {seats > 0 ? (
                    <Text style={styles.tierSeats}>{seats} active profile{seats === 1 ? '' : 's'}</Text>
                  ) : null}
                </View>
              </View>
            )
          })}
        </>
      ) : null}
    </View>
  )
}

export default function CeoRevenueScreen() {
  const router = useRouter()
  const { ready, allowed } = useCeoAccess()
  const [loading, setLoading] = useState(true)
  const [snap, setSnap] = useState<SubSnap | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async (isRefresh?: boolean) => {
      if (!allowed) return
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setHint(null)
      const { data, error } = await supabase.rpc('ceo_subscription_revenue_snapshot')
      setLoading(false)
      setRefreshing(false)
      if (error) {
        setHint(error.message)
        setSnap(null)
        return
      }
      const s = parseSubSnap(data)
      setSnap(s)
      if (s.error === 'forbidden') {
        setHint('Not allowed.')
      } else if (s.hint && !s.has_revenue_table) {
        setHint(s.hint)
      }
    },
    [allowed]
  )

  useEffect(() => {
    if (ready && allowed) load()
  }, [ready, allowed, load])

  const cur = snap?.currency ?? 'EUR'

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
      <Text style={styles.title}>Subscription revenue</Text>
      <Text style={styles.subtitle}>Abo-Umsatz: brutto &amp; netto, nach Freelancer / Company und Plan.</Text>

      {hint ? (
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      ) : null}

      {loading && !snap ? (
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
        {snap?.ok ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Total gross (subscriptions)</Text>
              <Text style={styles.heroValue}>{money(snap.gross_total, cur)}</Text>
              <View style={styles.heroRow}>
                <View>
                  <Text style={styles.heroSmallLabel}>Net</Text>
                  <Text style={styles.heroSmallValue}>{money(snap.net_total, cur)}</Text>
                </View>
                <View>
                  <Text style={styles.heroSmallLabel}>VAT (gross − net)</Text>
                  <Text style={styles.heroSmallValue}>{money(snap.vat_total, cur)}</Text>
                </View>
              </View>
              {snap.has_revenue_table ? (
                <Text style={styles.heroSub}>{snap.entry_count} line{snap.entry_count === 1 ? '' : 's'} in ledger</Text>
              ) : (
                <Text style={styles.heroSub}>No ledger rows yet — totals are zero.</Text>
              )}
            </View>

            {snap.month_gross != null && snap.month_net != null && snap.has_revenue_table ? (
              <View style={styles.monthCard}>
                <Text style={styles.monthLabel}>This month (booked)</Text>
                <Text style={styles.monthLine}>
                  Gross {money(snap.month_gross, cur)} · Net {money(snap.month_net, cur)}
                </Text>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>By audience</Text>
            <AudienceBlock
              label="Freelancer"
              data={snap.by_audience.freelancer}
              plans={snap.plan_distribution.freelancer}
              currency={cur}
            />
            <AudienceBlock
              label="Company"
              data={snap.by_audience.company}
              plans={snap.plan_distribution.company}
              currency={cur}
            />

            <Text style={styles.sectionTitle}>About the numbers</Text>
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>
                Record each subscription payment in <Text style={styles.infoMono}>subscription_revenue_entries</Text>{' '}
                (gross including VAT, net after VAT). Stripe webhooks or SQL inserts both work. Active plan counts come
                from user profiles (<Text style={styles.infoMono}>subscription_tier</Text>).
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
  heroCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
  },
  heroLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  heroValue: { fontSize: 28, fontWeight: '900', color: '#FFDC00' },
  heroRow: { flexDirection: 'row', gap: 24, marginTop: 16 },
  heroSmallLabel: { fontSize: 10, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: 1 },
  heroSmallValue: { fontSize: 16, fontWeight: '800', color: 'rgba(255,255,255,0.88)', marginTop: 4 },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 14 },
  monthCard: {
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  monthLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '600', marginBottom: 6 },
  monthLine: { fontSize: 15, fontWeight: '700', color: '#FFDC00' },
  sectionTitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
    marginTop: 8,
  },
  audienceCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  audienceTitle: { fontSize: 16, fontWeight: '800', color: '#ffffff', marginBottom: 12 },
  audienceTotals: { flexDirection: 'row', gap: 20 },
  audienceMetric: { flex: 1 },
  audienceMetricLabel: { fontSize: 10, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: 1 },
  audienceMetricValue: { fontSize: 18, fontWeight: '800', color: '#FFDC00', marginTop: 4 },
  bookedLine: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 10 },
  tierSectionLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 8,
  },
  tierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 12,
  },
  tierName: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.85)', textTransform: 'capitalize' },
  tierRight: { flex: 1, alignItems: 'flex-end' },
  tierMoney: { fontSize: 12, color: 'rgba(255,255,255,0.55)', textAlign: 'right' },
  tierSeats: { fontSize: 11, color: 'rgba(255,255,255,0.32)', marginTop: 4, textAlign: 'right' },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  infoText: { fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },
  infoMono: { fontSize: 11, color: 'rgba(255,220,0,0.7)', fontWeight: '600' },
  linkOut: { paddingVertical: 14, marginBottom: 8 },
  linkOutText: { fontSize: 14, fontWeight: '600', color: '#FFDC00' },
  empty: { color: 'rgba(255,255,255,0.35)', fontSize: 14, textAlign: 'center', marginTop: 24 },
  deniedTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  deniedSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
})

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { supabase } from '@/lib/supabase'
import {
  budgetVarianceTone,
  computeCrewSpendLines,
  computeForecastRemaining,
  computeWrapUpVariance,
  formatMoneyAmount,
  sumBudgetLineSpent,
  type CrewSpendMemberRow,
} from '@/lib/projectInternalBudget'
import { syncProjectListingBudget } from '@/lib/syncProjectListingBudget'

type BudgetPlanRow = {
  project_id: string
  currency: string
  total_budget: number | null
  production_budget: number | null
  notes: string | null
}

type BudgetLineRow = {
  id: string
  project_id: string
  label: string
  planned_amount: number
  spent_amount: number
  sort_order: number
}

type LineDraft = {
  id: string
  label: string
  plannedStr: string
  spentStr: string
  sort_order: number
}

type Props = {
  projectId: string
}

function parseMoneyInput(raw: string): number | null {
  const t = raw.trim().replace(/\s+/g, '')
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function moneyToInput(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return ''
  return String(n)
}

const PRESETS = ['Food & beverage', 'Travel', 'Rental cars', 'Equipment', 'Other']

export function ProjectBudgetTab({ projectId }: Props) {
  const [loading, setLoading] = useState(true)
  const [savingPlan, setSavingPlan] = useState(false)
  const [savingLines, setSavingLines] = useState(false)
  const [currency, setCurrency] = useState('EUR')
  const [totalStr, setTotalStr] = useState('')
  const [productionStr, setProductionStr] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  const [members, setMembers] = useState<CrewSpendMemberRow[]>([])
  const [deletedLineIds, setDeletedLineIds] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setDeletedLineIds([])
    const [planRes, linesRes, membersRes, manualRes] = await Promise.all([
      supabase.from('project_budget_plans').select('*').eq('project_id', projectId).maybeSingle(),
      supabase.from('project_budget_lines').select('*').eq('project_id', projectId).order('sort_order'),
      supabase
        .from('project_members')
        .select(
          'profile_id, member_role, booked_dates, scheduling_start_date, scheduling_end_date, profiles(name, day_rate_amount, half_day_rate_amount, rates_currency)'
        )
        .eq('project_id', projectId),
      supabase
        .from('project_manual_crew_readable')
        .select(
          'id, name, member_role, booked_dates, scheduling_start_date, scheduling_end_date, day_rate_amount, half_day_rate_amount, claimed_profile_id'
        )
        .eq('project_id', projectId)
        .is('claimed_profile_id', null),
    ])

    if (planRes.error) {
      Alert.alert('Budget', planRes.error.message)
      setLoading(false)
      return
    }
    if (linesRes.error) {
      Alert.alert('Budget', linesRes.error.message)
      setLoading(false)
      return
    }
    if (membersRes.error) {
      Alert.alert('Budget', membersRes.error.message)
      setLoading(false)
      return
    }

    const plan = planRes.data as BudgetPlanRow | null
    setCurrency((plan?.currency ?? 'EUR').trim() || 'EUR')
    setTotalStr(moneyToInput(plan?.total_budget ?? null))
    setProductionStr(moneyToInput(plan?.production_budget ?? null))

    const lr = (linesRes.data ?? []) as BudgetLineRow[]
    setLines(
      lr.map((r) => ({
        id: r.id,
        label: r.label ?? '',
        plannedStr: moneyToInput(r.planned_amount),
        spentStr: moneyToInput(r.spent_amount),
        sort_order: r.sort_order ?? 0,
      })),
    )

    const registered = (membersRes.data ?? []) as CrewSpendMemberRow[]
    const manualRows = (manualRes.error ? [] : (manualRes.data ?? [])) as Array<{
      id: string
      name: string | null
      member_role: string | null
      booked_dates?: unknown
      scheduling_start_date?: string | null
      scheduling_end_date?: string | null
      day_rate_amount?: number | null
      half_day_rate_amount?: number | null
    }>
    const manualAsSpend: CrewSpendMemberRow[] = manualRows.map((m) => ({
      profile_id: `manual:${m.id}`,
      member_role: (m.member_role ?? 'crew').trim() || 'crew',
      booked_dates: m.booked_dates,
      scheduling_start_date: m.scheduling_start_date,
      scheduling_end_date: m.scheduling_end_date,
      day_rate_amount: m.day_rate_amount,
      half_day_rate_amount: m.half_day_rate_amount,
      display_name: (m.name ?? '').trim() || 'Crew',
      profiles: null,
    }))
    setMembers([...registered, ...manualAsSpend])
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const crew = useMemo(() => computeCrewSpendLines(members, currency), [members, currency])
  const lineTotals = useMemo(
    () =>
      sumBudgetLineSpent(
        lines.map((l) => ({
          planned_amount: parseMoneyInput(l.plannedStr),
          spent_amount: parseMoneyInput(l.spentStr),
        })),
      ),
    [lines],
  )

  const totalBudgetNum = parseMoneyInput(totalStr)
  const productionCapNum = parseMoneyInput(productionStr)
  const otherPlanned = lineTotals.planned
  const otherSpent = lineTotals.spent

  const forecastRemaining = computeForecastRemaining(totalBudgetNum, crew.total, otherPlanned)
  const wrapUpVariance = computeWrapUpVariance(totalBudgetNum, crew.total, otherSpent)
  const wrapUpTone = budgetVarianceTone(wrapUpVariance)
  const remainingProduction =
    productionCapNum != null ? Math.round((productionCapNum - crew.total) * 100) / 100 : null

  const varianceStyle = (v: number | null) => {
    const tone = budgetVarianceTone(v)
    if (tone === 'over') return styles.neg
    if (tone === 'under') return styles.pos
    return undefined
  }

  const savePlan = async () => {
    setSavingPlan(true)
    const payload = {
      project_id: projectId,
      currency: currency.trim().toUpperCase() || 'EUR',
      total_budget: parseMoneyInput(totalStr),
      production_budget: parseMoneyInput(productionStr),
      notes: null as string | null,
    }
    const { error } = await supabase.from('project_budget_plans').upsert(payload, { onConflict: 'project_id' })
    setSavingPlan(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    const synced = await syncProjectListingBudget(supabase, projectId, {
      total_budget: payload.total_budget,
      currency: payload.currency,
    })
    if (!synced.ok) {
      Alert.alert(
        'Saved with warning',
        `Budget targets saved, but overview sync failed:\n${'error' in synced ? synced.error : 'Unknown error'}`
      )
      void load()
      return
    }
    Alert.alert('Saved', 'Budget targets updated.')
    void load()
  }

  const saveLines = async () => {
    setSavingLines(true)
    if (deletedLineIds.length > 0) {
      const { error: delErr } = await supabase.from('project_budget_lines').delete().in('id', deletedLineIds)
      if (delErr) {
        setSavingLines(false)
        Alert.alert('Save failed', delErr.message)
        return
      }
    }

    const rows = lines.map((l, i) => ({
      id: /^[0-9a-f-]{36}$/i.test(l.id) ? l.id : undefined,
      project_id: projectId,
      label: l.label.trim() || 'Expense',
      planned_amount: parseMoneyInput(l.plannedStr) ?? 0,
      spent_amount: parseMoneyInput(l.spentStr) ?? 0,
      sort_order: i,
    }))

    for (const r of rows) {
      if (r.id) {
        const { error } = await supabase
          .from('project_budget_lines')
          .update({
            label: r.label,
            planned_amount: r.planned_amount,
            spent_amount: r.spent_amount,
            sort_order: r.sort_order,
          })
          .eq('id', r.id)
        if (error) {
          setSavingLines(false)
          Alert.alert('Save failed', error.message)
          return
        }
      } else {
        const { error } = await supabase.from('project_budget_lines').insert({
          project_id: r.project_id,
          label: r.label,
          planned_amount: r.planned_amount,
          spent_amount: r.spent_amount,
          sort_order: r.sort_order,
        })
        if (error) {
          setSavingLines(false)
          Alert.alert('Save failed', error.message)
          return
        }
      }
    }

    setSavingLines(false)
    Alert.alert('Saved', 'Expense lines updated.')
    void load()
  }

  const addLine = (label?: string) => {
    const nextSort = lines.length ? Math.max(...lines.map((l) => l.sort_order)) + 1 : 0
    setLines((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: label ?? '',
        plannedStr: '',
        spentStr: '',
        sort_order: nextSort,
      },
    ])
  }

  const removeLine = (id: string) => {
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      setDeletedLineIds((d) => [...d, id])
    }
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.lead}>
        Internal planning only — freelancers never see this. Crew cost uses booked shoot days (full or half) × each
        person&apos;s public day / half-day rate when set. Enter planned estimates before the shoot; after wrap, enter
        actual spend for the final balance.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Targets</Text>
        <Text style={styles.hint}>Currency (ISO)</Text>
        <TextInput
          style={styles.input}
          value={currency}
          onChangeText={setCurrency}
          placeholder="EUR"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="characters"
        />
        <Text style={styles.hint}>Total project budget</Text>
        <TextInput
          style={styles.input}
          value={totalStr}
          onChangeText={setTotalStr}
          placeholder="e.g. 20000"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="decimal-pad"
        />
        <Text style={styles.hint}>Production bucket (crew day-rate burn)</Text>
        <TextInput
          style={styles.input}
          value={productionStr}
          onChangeText={setProductionStr}
          placeholder="e.g. 10000 — optional"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="decimal-pad"
        />
        <TouchableOpacity style={[styles.primaryBtn, savingPlan && styles.dim]} onPress={() => void savePlan()} disabled={savingPlan}>
          <Text style={styles.primaryBtnText}>{savingPlan ? 'Saving…' : 'Save targets'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Crew (auto)</Text>
        {crew.currenciesMixed ? (
          <Text style={styles.warn}>Some day rates use a different currency than the plan — totals may be misleading.</Text>
        ) : null}
        <Text style={styles.summaryBig}>{formatMoneyAmount(crew.total, currency)}</Text>
        <Text style={styles.muted}>Booked day-equivalents × profile rates (excludes client row). Half-days use half-day rate when set.</Text>
        {crew.lines.length === 0 ? (
          <Text style={styles.muted}>No booked days or rates yet.</Text>
        ) : (
          crew.lines.map((ln) => (
            <View key={ln.profileIdKey} style={styles.crewRow}>
              <Text style={styles.crewName}>{ln.displayName}</Text>
              <View style={styles.crewDetailRow}>
                <Text style={styles.crewMeta}>
                  {(ln.dayUnits % 1 === 0 ? String(ln.dayUnits) : ln.dayUnits.toFixed(1)) + 'd equiv'}
                  {ln.halfDayRate != null && ln.halfDayRate > 0
                    ? ` · day ${formatMoneyAmount(ln.dayRate, currency)} / half ${formatMoneyAmount(ln.halfDayRate, currency)}`
                    : ` · ${formatMoneyAmount(ln.dayRate, currency)} day`}
                </Text>
                <Text style={styles.crewAmt}>{formatMoneyAmount(ln.subtotal, currency)}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Forecast</Text>
        <Text style={styles.muted}>Before the shoot — uses planned other expenses.</Text>
        <View style={styles.snapRow}>
          <Text style={styles.snapLabel}>Crew (booked)</Text>
          <Text style={styles.snapVal}>{formatMoneyAmount(crew.total, currency)}</Text>
        </View>
        <View style={styles.snapRow}>
          <Text style={styles.snapLabel}>Other expenses (planned)</Text>
          <Text style={styles.snapVal}>{formatMoneyAmount(otherPlanned, currency)}</Text>
        </View>
        {productionCapNum != null ? (
          <View style={styles.snapRow}>
            <Text style={styles.snapLabel}>Remaining in production bucket</Text>
            <Text style={[styles.snapVal, varianceStyle(remainingProduction)]}>
              {formatMoneyAmount(remainingProduction ?? 0, currency)}
            </Text>
          </View>
        ) : null}
        {totalBudgetNum != null ? (
          <View style={styles.snapRow}>
            <Text style={styles.snapLabel}>Headroom (total budget)</Text>
            <Text style={[styles.snapVal, styles.snapValLg, varianceStyle(forecastRemaining)]}>
              {formatMoneyAmount(forecastRemaining ?? 0, currency)}
            </Text>
          </View>
        ) : (
          <Text style={styles.muted}>Set a total budget above to forecast headroom with planned expenses.</Text>
        )}
      </View>

      <View
        style={[
          styles.card,
          wrapUpTone === 'over' && styles.wrapCardOver,
          wrapUpTone === 'under' && styles.wrapCardUnder,
        ]}
      >
        <Text style={styles.cardTitle}>Wrap-up</Text>
        <Text style={styles.muted}>After the shoot — uses actual spend on other expenses.</Text>
        <View style={styles.snapRow}>
          <Text style={styles.snapLabel}>Crew (booked)</Text>
          <Text style={styles.snapVal}>{formatMoneyAmount(crew.total, currency)}</Text>
        </View>
        <View style={styles.snapRow}>
          <Text style={styles.snapLabel}>Other expenses (actual)</Text>
          <Text style={styles.snapVal}>{formatMoneyAmount(otherSpent, currency)}</Text>
        </View>
        {totalBudgetNum != null ? (
          <>
            <View style={styles.snapRow}>
              <Text style={styles.snapLabel}>Committed total</Text>
              <Text style={styles.snapVal}>{formatMoneyAmount(crew.total + otherSpent, currency)}</Text>
            </View>
            <View style={styles.snapRow}>
              <Text style={[styles.snapLabel, styles.snapLabelStrong]}>
                {wrapUpTone === 'over' ? 'Over budget' : wrapUpTone === 'under' ? 'Under budget' : 'On budget'}
              </Text>
              <Text style={[styles.snapVal, styles.snapValXl, varianceStyle(wrapUpVariance)]}>
                {wrapUpVariance != null && wrapUpVariance < 0
                  ? '−'
                  : wrapUpVariance != null && wrapUpVariance > 0
                    ? '+'
                    : ''}
                {formatMoneyAmount(wrapUpVariance != null ? Math.abs(wrapUpVariance) : 0, currency)}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.muted}>Set a total budget to see the final wrap-up balance.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Other expenses</Text>
        <Text style={styles.muted}>Manual lines (catering, travel, gear rentals, etc.).</Text>
        <View style={styles.presetRow}>
          {PRESETS.map((p) => (
            <TouchableOpacity key={p} style={styles.presetChip} onPress={() => addLine(p)}>
              <Text style={styles.presetChipText}>+ {p}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {lines.map((l) => (
          <View key={l.id} style={styles.lineBlock}>
            <TextInput
              style={styles.input}
              value={l.label}
              onChangeText={(t) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, label: t } : x)))}
              placeholder="Label"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />
            <View style={styles.lineInputs}>
              <View style={{ flex: 1 }}>
                <Text style={styles.hint}>Planned (forecast)</Text>
                <TextInput
                  style={styles.input}
                  value={l.plannedStr}
                  onChangeText={(t) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, plannedStr: t } : x)))}
                  keyboardType="decimal-pad"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hint}>Actual (wrap-up)</Text>
                <TextInput
                  style={styles.input}
                  value={l.spentStr}
                  onChangeText={(t) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, spentStr: t } : x)))}
                  keyboardType="decimal-pad"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />
              </View>
            </View>
            <TouchableOpacity onPress={() => removeLine(l.id)}>
              <Text style={styles.remove}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => addLine()}>
          <Text style={styles.secondaryBtnText}>+ Add line</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryBtn, savingLines && styles.dim]} onPress={() => void saveLines()} disabled={savingLines}>
          <Text style={styles.primaryBtnText}>{savingLines ? 'Saving…' : 'Save expense lines'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 40, paddingHorizontal: 4 },
  center: { flex: 1, paddingVertical: 40, alignItems: 'center' },
  lead: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 14, lineHeight: 19 },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 },
  input: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  secondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryBtnText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 13 },
  dim: { opacity: 0.6 },
  warn: { color: '#ffb020', fontSize: 12, marginBottom: 8 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.38)', marginBottom: 8 },
  summaryBig: { fontSize: 22, fontWeight: '800', color: '#FFDC00', marginBottom: 6 },
  crewRow: {
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  crewName: { color: '#fff', fontWeight: '600', fontSize: 14 },
  crewDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  crewMeta: { flex: 1, color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 17 },
  crewAmt: { color: '#fff', fontWeight: '700', fontSize: 14, flexShrink: 0 },
  snapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  snapLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 13, flex: 1, paddingRight: 8 },
  snapVal: { color: '#fff', fontWeight: '700', fontSize: 15 },
  neg: { color: '#ff6b6b' },
  pos: { color: '#34d399' },
  snapValLg: { fontSize: 17 },
  snapValXl: { fontSize: 20 },
  snapLabelStrong: { color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  wrapCardOver: { borderColor: 'rgba(255,107,107,0.35)', backgroundColor: 'rgba(255,107,107,0.06)' },
  wrapCardUnder: { borderColor: 'rgba(52,211,153,0.35)', backgroundColor: 'rgba(52,211,153,0.06)' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  presetChip: {
    backgroundColor: '#0a0a0a',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  presetChipText: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '600' },
  lineBlock: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  lineInputs: { flexDirection: 'row', gap: 10 },
  remove: { color: '#ff6b6b', fontWeight: '700', fontSize: 13, marginTop: 4 },
})

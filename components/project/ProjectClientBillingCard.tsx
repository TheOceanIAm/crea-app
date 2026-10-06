import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronDown } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import {
  UPFRONT_KINDS,
  clientBillingState,
  parseBillingNumber,
  upfrontDue,
  upfrontKindLabel,
  type CustomUpfrontMode,
  type UpfrontKind,
} from '@/lib/clientBilling'
import { formatMoneyAmount } from '@/lib/projectInternalBudget'

type BillingRow = {
  currency: string | null
  client_budget: number | string | null
  upfront_kind: UpfrontKind | null
  custom_mode: CustomUpfrontMode | null
  custom_percent: number | string | null
  custom_amount: number | string | null
  received_amount: number | string | null
  received_at: string | null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ProjectClientBillingCard({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('EUR')
  const [budgetStr, setBudgetStr] = useState('')
  const [kind, setKind] = useState<UpfrontKind>('percent_50')
  const [customMode, setCustomMode] = useState<CustomUpfrontMode>('percent')
  const [customPercentStr, setCustomPercentStr] = useState('')
  const [customAmountStr, setCustomAmountStr] = useState('')
  const [receivedStr, setReceivedStr] = useState('')
  const [receivedDate, setReceivedDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase.from('project_client_billing').select('*').eq('project_id', projectId).maybeSingle()
    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }
    const row = data as BillingRow | null
    setCurrency((row?.currency ?? 'EUR').trim() || 'EUR')
    setBudgetStr(row?.client_budget != null ? String(row.client_budget) : '')
    setKind(row?.upfront_kind ?? 'percent_50')
    setCustomMode(row?.custom_mode === 'amount' ? 'amount' : 'percent')
    setCustomPercentStr(row?.custom_percent != null ? String(row.custom_percent) : '')
    setCustomAmountStr(row?.custom_amount != null ? String(row.custom_amount) : '')
    setReceivedStr(row?.received_amount != null ? String(row.received_amount) : '')
    setReceivedDate(row?.received_at ? String(row.received_at).slice(0, 10) : '')
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const input = useMemo(
    () => ({
      clientBudget: parseBillingNumber(budgetStr),
      upfrontKind: kind,
      customMode: kind === 'custom' ? customMode : null,
      customPercent: parseBillingNumber(customPercentStr),
      customAmount: parseBillingNumber(customAmountStr),
      receivedAmount: parseBillingNumber(receivedStr),
    }),
    [budgetStr, kind, customMode, customPercentStr, customAmountStr, receivedStr]
  )
  const due = upfrontDue(input)
  const state = clientBillingState(input)
  const summary = state === 'cleared' ? 'Cleared to start' : state === 'waiting' ? 'Waiting on upfront' : 'No client budget yet'

  const save = async () => {
    setSaving(true)
    setError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const received = parseBillingNumber(receivedStr)
    const receivedAt =
      received != null && received > 0 ? new Date(`${(receivedDate || todayIso()).slice(0, 10)}T12:00:00`).toISOString() : null
    const { error: saveError } = await supabase.from('project_client_billing').upsert(
      {
        project_id: projectId,
        currency: currency.trim() || 'EUR',
        client_budget: parseBillingNumber(budgetStr),
        upfront_kind: kind,
        custom_mode: kind === 'custom' ? customMode : null,
        custom_percent: kind === 'custom' && customMode === 'percent' ? parseBillingNumber(customPercentStr) : null,
        custom_amount: kind === 'custom' && customMode === 'amount' ? parseBillingNumber(customAmountStr) : null,
        received_amount: received,
        received_at: receivedAt,
        marked_by: receivedAt ? user?.id ?? null : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' }
    )
    setSaving(false)
    if (saveError) setError(saveError.message)
    else onSaved?.()
  }

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <View style={[styles.card, state === 'cleared' && styles.cleared, state === 'waiting' && styles.waiting]}>
      <TouchableOpacity style={styles.header} onPress={() => setOpen((v) => !v)} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Client</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        <ChevronDown
          size={18}
          color="rgba(255,255,255,0.45)"
          strokeWidth={ICON_STROKE}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>
      {open ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.muted}>
            What the client pays the company. Mark the upfront when it arrives. The project only shows whether this payment is in.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>Currency</Text>
          <TextInput style={styles.input} value={currency} onChangeText={setCurrency} autoCapitalize="characters" />
          <Text style={styles.hint}>Client budget</Text>
          <TextInput style={styles.input} value={budgetStr} onChangeText={setBudgetStr} keyboardType="decimal-pad" placeholder="e.g. 40000" placeholderTextColor="rgba(255,255,255,0.3)" />
          <Text style={styles.hint}>Upfront before production</Text>
          <View style={styles.pills}>
            {UPFRONT_KINDS.map((option) => (
              <TouchableOpacity key={option} style={[styles.pill, kind === option && styles.pillOn]} onPress={() => setKind(option)}>
                <Text style={[styles.pillText, kind === option && styles.pillTextOn]}>{upfrontKindLabel(option)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {kind === 'custom' ? (
            <View style={styles.pills}>
              {(['percent', 'amount'] as const).map((mode) => (
                <TouchableOpacity key={mode} style={[styles.pill, customMode === mode && styles.pillOn]} onPress={() => setCustomMode(mode)}>
                  <Text style={[styles.pillText, customMode === mode && styles.pillTextOn]}>{mode === 'percent' ? 'Percent' : 'Amount'}</Text>
                </TouchableOpacity>
              ))}
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={customMode === 'percent' ? customPercentStr : customAmountStr}
                onChangeText={customMode === 'percent' ? setCustomPercentStr : setCustomAmountStr}
                keyboardType="decimal-pad"
                placeholder={customMode === 'percent' ? '40' : '8000'}
                placeholderTextColor="rgba(255,255,255,0.3)"
              />
            </View>
          ) : null}
          <Text style={styles.muted}>Upfront due {due != null ? formatMoneyAmount(due, currency) : '—'}</Text>
          <Text style={styles.hint}>Received</Text>
          <TextInput style={styles.input} value={receivedStr} onChangeText={setReceivedStr} keyboardType="decimal-pad" placeholder="Amount that arrived" placeholderTextColor="rgba(255,255,255,0.3)" />
          <Text style={styles.hint}>Received on (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={receivedDate} onChangeText={setReceivedDate} autoCapitalize="none" placeholder={todayIso()} placeholderTextColor="rgba(255,255,255,0.3)" />
          <TouchableOpacity style={[styles.save, saving && { opacity: 0.6 }]} disabled={saving} onPress={() => void save()}>
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save client billing'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}

export function ProjectClientPaymentStatus({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [label, setLabel] = useState<string | null>(null)
  const [tone, setTone] = useState<'cleared' | 'waiting' | 'unset'>('unset')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('project_client_billing')
        .select('client_budget, upfront_kind, custom_mode, custom_percent, custom_amount, received_amount')
        .eq('project_id', projectId)
        .maybeSingle()
      if (cancelled) return
      const row = data as BillingRow | null
      const state = clientBillingState({
        clientBudget: parseBillingNumber(row?.client_budget),
        upfrontKind: row?.upfront_kind ?? 'percent_50',
        customMode: row?.custom_mode ?? null,
        customPercent: parseBillingNumber(row?.custom_percent),
        customAmount: parseBillingNumber(row?.custom_amount),
        receivedAmount: parseBillingNumber(row?.received_amount),
      })
      setTone(state)
      setLabel(state === 'cleared' ? 'Client paid' : state === 'waiting' ? 'Waiting on payment' : 'No client payment yet')
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (!label) return null

  return (
    <TouchableOpacity style={styles.status} onPress={() => router.push(`/financing?project=${projectId}`)}>
      <View style={[styles.dot, tone === 'cleared' && styles.dotCleared, tone === 'waiting' && styles.dotWaiting]} />
      <Text style={styles.statusText}>{label}</Text>
      <Text style={styles.statusLink}>Financing</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 14,
  },
  cleared: { borderColor: 'rgba(52,211,153,0.35)', backgroundColor: 'rgba(52,211,153,0.06)' },
  waiting: { borderColor: 'rgba(255,220,0,0.28)', backgroundColor: 'rgba(255,220,0,0.05)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' },
  summary: { marginTop: 4, fontSize: 18, fontWeight: '800', color: '#FFDC00' },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 17, marginBottom: 8 },
  error: { color: '#ff8b8b', fontSize: 12, marginBottom: 8 },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 },
  input: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  pill: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6 },
  pillOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  pillText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  pillTextOn: { color: '#0a0a0a' },
  save: { backgroundColor: '#FFDC00', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  saveText: { color: '#0a0a0a', fontWeight: '800' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotCleared: { backgroundColor: '#34d399' },
  dotWaiting: { backgroundColor: '#FFDC00' },
  statusText: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 14 },
  statusLink: { color: '#FFDC00', fontWeight: '800', fontSize: 12 },
})

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { supabase } from '@/lib/supabase'
import { clientBillingState, parseBillingNumber, type CustomUpfrontMode, type UpfrontKind } from '@/lib/clientBilling'

type BillingRow = {
  client_budget: number | string | null
  upfront_kind: UpfrontKind | null
  custom_mode: CustomUpfrontMode | null
  custom_percent: number | string | null
  custom_amount: number | string | null
  received_amount: number | string | null
}

/** Read-only client payment state. Billing itself stays on the web. */
export function ProjectClientPaymentStatus({ projectId }: { projectId: string }) {
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
    <View style={styles.status}>
      <View style={[styles.dot, tone === 'cleared' && styles.dotCleared, tone === 'waiting' && styles.dotWaiting]} />
      <Text style={styles.statusText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
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
})

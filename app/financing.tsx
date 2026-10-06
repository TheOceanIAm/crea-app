import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ProjectClientBillingCard } from '@/components/project/ProjectClientBillingCard'
import { ChevronLeft } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import { getAuthUser } from '@/lib/getAuthUser'
import { resolveActingCompanyId } from '@/lib/companyAccount'
import {
  clientBillingState,
  parseBillingNumber,
  upfrontDue,
  quoteTotal,
  type CustomUpfrontMode,
  type UpfrontKind,
} from '@/lib/clientBilling'
import { formatMoneyAmount } from '@/lib/projectInternalBudget'

type Tab = 'projects' | 'quotes'
type ProjectRow = { id: string; title: string | null }
type QuoteRow = { id: string; title: string | null; client_name: string | null; status: string | null; currency: string | null; project_id: string | null }
type LineDraft = { key: string; label: string; amountStr: string }

function blankLine(): LineDraft {
  return { key: `${Date.now()}-${Math.random()}`, label: '', amountStr: '' }
}

export default function FinancingScreen() {
  const router = useRouter()
  const { project: projectParam } = useLocalSearchParams<{ project?: string }>()
  const requestedProject = Array.isArray(projectParam) ? projectParam[0] : projectParam
  const [billingProjectId, setBillingProjectId] = useState<string | null>(requestedProject ?? null)
  const [tab, setTab] = useState<Tab>('projects')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Array<{ id: string; title: string; currency: string; state: string; budget: number | null; due: number | null; received: number | null }>>([])
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [editing, setEditing] = useState(false)
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [status, setStatus] = useState<'draft' | 'accepted'>('draft')
  const [clientName, setClientName] = useState('')
  const [title, setTitle] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [projectId, setProjectId] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const user = await getAuthUser()
    if (!user) {
      setError('Sign in as a company.')
      setLoading(false)
      return
    }
    let acting = await resolveActingCompanyId(user.id)
    if (!acting) {
      const { data } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('profile_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      acting = (data as { company_id?: string } | null)?.company_id ?? null
    }
    if (!acting) {
      setError('This screen is for company accounts.')
      setLoading(false)
      return
    }
    setCompanyId(acting)
    const [projectRes, billingRes, quoteRes] = await Promise.all([
      supabase.from('projects').select('id, title').eq('company_id', acting).order('title'),
      supabase.from('project_client_billing').select('project_id, currency, client_budget, upfront_kind, custom_mode, custom_percent, custom_amount, received_amount'),
      supabase.from('company_quotes').select('id, title, client_name, status, currency, project_id').eq('company_id', acting).order('updated_at', { ascending: false }),
    ])
    const billing = new Map<string, {
      currency: string | null
      client_budget: number | string | null
      upfront_kind: UpfrontKind | null
      custom_mode: CustomUpfrontMode | null
      custom_percent: number | string | null
      custom_amount: number | string | null
      received_amount: number | string | null
    }>()
    for (const row of (billingRes.data ?? []) as Array<{ project_id: string } & Record<string, unknown>>) {
      billing.set(row.project_id, row as never)
    }
    setProjects(
      ((projectRes.data ?? []) as ProjectRow[]).map((project) => {
        const row = billing.get(project.id)
        const input = {
          clientBudget: parseBillingNumber(row?.client_budget),
          upfrontKind: row?.upfront_kind ?? 'percent_50',
          customMode: row?.custom_mode ?? null,
          customPercent: parseBillingNumber(row?.custom_percent),
          customAmount: parseBillingNumber(row?.custom_amount),
          receivedAmount: parseBillingNumber(row?.received_amount),
        }
        return {
          id: project.id,
          title: (project.title ?? '').trim() || 'Project',
          currency: (row?.currency ?? 'EUR').trim() || 'EUR',
          budget: input.clientBudget,
          due: upfrontDue(input),
          received: input.receivedAmount,
          state: clientBillingState(input),
        }
      })
    )
    if (quoteRes.error) setError(quoteRes.error.message)
    else setQuotes((quoteRes.data ?? []) as QuoteRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const persist = async (nextStatus: 'draft' | 'accepted') => {
    if (!companyId) return
    setSaving(true)
    setError(null)
    const user = await getAuthUser()
    const payload = {
      company_id: companyId,
      project_id: projectId || null,
      client_name: clientName.trim(),
      title: title.trim() || 'Quote',
      currency: currency.trim() || 'EUR',
      status: nextStatus,
      accepted_at: nextStatus === 'accepted' ? new Date().toISOString() : null,
      created_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    }
    let id = quoteId
    if (!id) {
      const { data, error: insertError } = await supabase.from('company_quotes').insert(payload).select('id').single()
      if (insertError || !data) {
        setSaving(false)
        setError(insertError?.message || 'Could not save quote')
        return
      }
      id = (data as { id: string }).id
      setQuoteId(id)
    } else {
      const { error: updateError } = await supabase.from('company_quotes').update(payload).eq('id', id)
      if (updateError) {
        setSaving(false)
        setError(updateError.message)
        return
      }
    }
    const clean = lines
      .map((line, index) => ({
        quote_id: id,
        label: line.label.trim(),
        amount: parseBillingNumber(line.amountStr) ?? 0,
        sort_order: index,
      }))
      .filter((line) => line.label || line.amount > 0)
    await supabase.from('company_quote_lines').delete().eq('quote_id', id)
    if (clean.length) {
      const { error: lineError } = await supabase.from('company_quote_lines').insert(clean)
      if (lineError) {
        setSaving(false)
        setError(lineError.message)
        return
      }
    }
    if (nextStatus === 'accepted' && projectId) {
      const total = quoteTotal(clean.map((line) => ({ amount: line.amount })))
      const { error: billingError } = await supabase.from('project_client_billing').upsert(
        { project_id: projectId, currency: currency.trim() || 'EUR', client_budget: total, updated_at: new Date().toISOString() },
        { onConflict: 'project_id' }
      )
      if (billingError) {
        setSaving(false)
        setError(billingError.message)
        return
      }
    }
    setStatus(nextStatus)
    setSaving(false)
    setEditing(false)
    await load()
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Financing</Text>
      </View>
      <View style={styles.tabs}>
        {(['projects', 'quotes'] as const).map((id) => (
          <TouchableOpacity key={id} style={[styles.tab, tab === id && styles.tabOn]} onPress={() => { setTab(id); setEditing(false) }}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{id === 'projects' ? 'Projects' : 'Quotes'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color="#FFDC00" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {tab === 'projects' && billingProjectId ? (
            <View>
              <TouchableOpacity onPress={() => setBillingProjectId(null)}>
                <Text style={styles.link}>← All projects</Text>
              </TouchableOpacity>
              <ProjectClientBillingCard projectId={billingProjectId} onSaved={() => void load()} />
            </View>
          ) : null}
          {tab === 'projects' && !billingProjectId
            ? projects.map((project) => (
                <TouchableOpacity key={project.id} style={styles.row} onPress={() => setBillingProjectId(project.id)}>
                  <Text style={styles.rowTitle}>{project.title}</Text>
                  <Text style={styles.rowMeta}>
                    {project.budget != null ? formatMoneyAmount(project.budget, project.currency) : 'No client budget'}
                    {' · '}
                    Upfront {project.due != null ? formatMoneyAmount(project.due, project.currency) : '—'}
                    {' · '}
                    Received {project.received != null ? formatMoneyAmount(project.received, project.currency) : '—'}
                    {' · '}
                    {project.state === 'cleared' ? 'Cleared' : project.state === 'waiting' ? 'Waiting' : 'Not set'}
                  </Text>
                </TouchableOpacity>
              ))
            : null}
          {tab === 'quotes' && !editing ? (
            <>
              <TouchableOpacity
                style={styles.primary}
                onPress={() => {
                  setEditing(true)
                  setQuoteId(null)
                  setStatus('draft')
                  setClientName('')
                  setTitle('')
                  setCurrency('EUR')
                  setProjectId('')
                  setLines([blankLine()])
                }}
              >
                <Text style={styles.primaryText}>New quote</Text>
              </TouchableOpacity>
              {quotes.map((quote) => (
                <TouchableOpacity
                  key={quote.id}
                  style={styles.row}
                  onPress={async () => {
                    const { data } = await supabase.from('company_quote_lines').select('label, amount, sort_order').eq('quote_id', quote.id).order('sort_order')
                    setEditing(true)
                    setQuoteId(quote.id)
                    setStatus(quote.status === 'accepted' ? 'accepted' : 'draft')
                    setClientName(quote.client_name ?? '')
                    setTitle(quote.title ?? '')
                    setCurrency(quote.currency ?? 'EUR')
                    setProjectId(quote.project_id ?? '')
                    const loaded = ((data ?? []) as Array<{ label: string | null; amount: number | string | null }>).map((line) => ({
                      key: `${line.label}-${line.amount}`,
                      label: line.label ?? '',
                      amountStr: line.amount != null ? String(line.amount) : '',
                    }))
                    setLines(loaded.length ? loaded : [blankLine()])
                  }}
                >
                  <Text style={styles.rowTitle}>{quote.title || 'Quote'}</Text>
                  <Text style={styles.rowMeta}>
                    {quote.client_name || 'No client'} · {quote.status === 'accepted' ? 'Accepted' : 'Draft'}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : null}
          {tab === 'quotes' && editing ? (
            <View>
              <Text style={styles.hint}>Client</Text>
              <TextInput style={styles.input} value={clientName} onChangeText={setClientName} editable={status !== 'accepted'} />
              <Text style={styles.hint}>Title</Text>
              <TextInput style={styles.input} value={title} onChangeText={setTitle} editable={status !== 'accepted'} />
              <Text style={styles.hint}>Project</Text>
              <View style={styles.pills}>
                <TouchableOpacity style={[styles.pill, !projectId && styles.pillOn]} disabled={status === 'accepted'} onPress={() => setProjectId('')}>
                  <Text style={[styles.pillText, !projectId && styles.pillTextOn]}>Blank</Text>
                </TouchableOpacity>
                {projects.map((project) => (
                  <TouchableOpacity
                    key={project.id}
                    style={[styles.pill, projectId === project.id && styles.pillOn]}
                    disabled={status === 'accepted'}
                    onPress={() => setProjectId(project.id)}
                  >
                    <Text style={[styles.pillText, projectId === project.id && styles.pillTextOn]}>{project.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {lines.map((line) => (
                <View key={line.key} style={styles.lineRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={line.label} editable={status !== 'accepted'} placeholder="Line" placeholderTextColor="rgba(255,255,255,0.3)" onChangeText={(value) => setLines((prev) => prev.map((item) => item.key === line.key ? { ...item, label: value } : item))} />
                  <TextInput style={[styles.input, { width: 100 }]} value={line.amountStr} editable={status !== 'accepted'} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="rgba(255,255,255,0.3)" onChangeText={(value) => setLines((prev) => prev.map((item) => item.key === line.key ? { ...item, amountStr: value } : item))} />
                </View>
              ))}
              {status !== 'accepted' ? (
                <TouchableOpacity onPress={() => setLines((prev) => [...prev, blankLine()])}>
                  <Text style={styles.link}>+ Add line</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.rowMeta}>
                Total {formatMoneyAmount(quoteTotal(lines.map((line) => ({ amount: parseBillingNumber(line.amountStr) }))), currency || 'EUR')}
              </Text>
              {status !== 'accepted' ? (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.secondary} disabled={saving} onPress={() => void persist('draft')}>
                    <Text style={styles.secondaryText}>{saving ? 'Saving…' : 'Save draft'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primary} disabled={saving || !projectId} onPress={() => void persist('accepted')}>
                    <Text style={styles.primaryText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.rowMeta}>Accepted into the project client budget. Download the PDF on the web.</Text>
              )}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  top: { paddingHorizontal: 16, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: '#FFDC00', fontWeight: '700' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 8 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  tab: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 14, paddingVertical: 6 },
  tabOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  tabText: { color: 'rgba(255,255,255,0.7)', fontWeight: '700', fontSize: 13 },
  tabTextOn: { color: '#0a0a0a' },
  body: { padding: 16, paddingBottom: 40 },
  error: { color: '#ff8b8b', marginBottom: 10 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  rowTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  rowMeta: { color: 'rgba(255,255,255,0.45)', marginTop: 4, marginBottom: 8 },
  hint: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginBottom: 4 },
  input: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  lineRow: { flexDirection: 'row', gap: 8 },
  link: { color: '#FFDC00', fontWeight: '700', marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  primary: { backgroundColor: '#FFDC00', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#0a0a0a', fontWeight: '800' },
  secondary: { borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', paddingVertical: 12, paddingHorizontal: 16 },
  secondaryText: { color: '#fff', fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  pill: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6 },
  pillOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  pillText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  pillTextOn: { color: '#0a0a0a' },
})

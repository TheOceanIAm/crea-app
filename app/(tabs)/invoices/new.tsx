import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'

type CompanyOption = { id: string; name: string }

export default function NewInvoiceScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ jobId?: string }>()
  const jobIdParam = useMemo(() => {
    const j = params.jobId
    if (typeof j === 'string' && j.trim()) return j.trim()
    if (Array.isArray(j) && j[0]) return String(j[0]).trim()
    return undefined
  }, [params.jobId])
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [linkedJobId, setLinkedJobId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLinkedJobId(null)
    setSelectedCompany(null)
    setTitle('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAllowed(false)
      setLoading(false)
      return
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = resolveAppRole(profile?.role, user)
    if (!isFreelancerProfile(role)) {
      setAllowed(false)
      setLoading(false)
      return
    }

    setAllowed(true)

    const { data: apps } = await supabase
      .from('job_applications')
      .select('job_id')
      .eq('freelancer_id', user.id)

    const jobIdsFromApps = [...new Set((apps ?? []).map((a) => a.job_id).filter(Boolean))] as string[]

    let companyOptions: CompanyOption[] = []

    if (jobIdsFromApps.length > 0) {
      const { data: jobsFromApps } = await supabase.from('jobs').select('company_id').in('id', jobIdsFromApps)
      const companyIds = [...new Set((jobsFromApps ?? []).map((j) => j.company_id).filter(Boolean))] as string[]
      if (companyIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', companyIds)
        companyOptions = (profiles ?? []).map((p) => ({
          id: p.id,
          name: (p.name || 'Company').trim(),
        }))
      }
    }

    if (jobIdParam) {
      const { data: job } = await supabase
        .from('jobs')
        .select('id, title, company_id, project_status, status, is_solo_workspace')
        .eq('id', jobIdParam)
        .maybeSingle()

      if (job?.id && job.company_id) {
        const ps = String(job.project_status ?? '').toLowerCase()
        const st = String(job.status ?? '').toLowerCase()
        const completed = ps === 'completed' || st === 'closed'
        const soloOk = Boolean(job.is_solo_workspace) && job.company_id === user.id
        const { data: appRow } = await supabase
          .from('job_applications')
          .select('id')
          .eq('job_id', job.id)
          .eq('freelancer_id', user.id)
          .eq('status', 'accepted')
          .maybeSingle()
        const crewOk = !!appRow

        if (completed && (soloOk || crewOk)) {
          setLinkedJobId(job.id)
          setSelectedCompany(job.company_id)
          setTitle((job.title || '').trim() || 'Invoice')
          const { data: clientProf } = await supabase
            .from('profiles')
            .select('id, name')
            .eq('id', job.company_id)
            .maybeSingle()
          const nm = (clientProf?.name || (soloOk ? 'Your workspace' : 'Client')).trim()
          if (!companyOptions.some((c) => c.id === job.company_id)) {
            companyOptions.push({ id: job.company_id, name: nm })
          }
          companyOptions.sort((a, b) => a.name.localeCompare(b.name))
        }
      }
    }

    setCompanies(companyOptions)
    setLoading(false)
  }, [jobIdParam])

  useEffect(() => {
    load()
  }, [load])

  const onSave = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !selectedCompany) {
      Alert.alert('Missing client', 'Select a company you have applied to.')
      return
    }
    const t = title.trim()
    if (!t) {
      Alert.alert('Title', 'Please enter an invoice title.')
      return
    }
    const amt = parseFloat(amount.replace(',', '.'))
    if (Number.isNaN(amt) || amt <= 0) {
      Alert.alert('Amount', 'Enter a valid amount.')
      return
    }

    let dueIso: string | null = null
    if (dueDate.trim()) {
      const d = new Date(dueDate.trim())
      if (Number.isNaN(d.getTime())) {
        Alert.alert('Due date', 'Use a valid date (YYYY-MM-DD).')
        return
      }
      dueIso = d.toISOString().slice(0, 10)
    }

    setSaving(true)
    let versionFields: { supersedes_invoice_id?: string; version_group_id?: string } = {}
    if (linkedJobId) {
      const { data: latestRows } = await supabase
        .from('invoices')
        .select('id, status, version_group_id, created_at')
        .eq('job_id', linkedJobId)
        .eq('freelancer_id', user.id)
        .eq('company_id', selectedCompany)
        .eq('is_latest', true)
        .order('created_at', { ascending: false })
        .limit(1)
      const latest = latestRows?.[0]
      if (latest) {
        const latestStatus = String(latest.status ?? '').toLowerCase()
        if (latestStatus === 'paid') {
          setSaving(false)
          Alert.alert('Invoice', 'This invoice is already paid. Creating another revision is blocked.')
          return
        }
        versionFields = {
          supersedes_invoice_id: String(latest.id),
          version_group_id:
            typeof latest.version_group_id === 'string' && latest.version_group_id.trim()
              ? latest.version_group_id
              : String(latest.id),
        }
      }
    }

    const { data: inserted, error } = await supabase
      .from('invoices')
      .insert({
        company_id: selectedCompany,
        freelancer_id: user.id,
        job_id: linkedJobId,
        invoice_project_title: t,
        amount: amt,
        currency: currency.trim().toUpperCase() || 'EUR',
        due_date: dueIso,
        description: description.trim() || null,
        invoice_number: invoiceNumber.trim() || null,
        status: 'pending',
        ...versionFields,
      })
      .select('id')
      .single()

    setSaving(false)
    if (error) {
      Alert.alert('Could not create invoice', error.message)
      return
    }
    void notifyExpoEvent({ kind: 'invoice', invoiceId: inserted.id, event: 'received' })
    router.replace(`/(tabs)/invoices/${inserted.id}`)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Invoices</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.blockTitle}>Freelancers only</Text>
          <Text style={styles.blockSub}>
            Companies receive invoices here. Switch to a freelancer account to create one.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backLabel}>Invoices</Text>
      </TouchableOpacity>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>New invoice</Text>
        <Text style={styles.sub}>
          {linkedJobId
            ? 'Project linked — client is pre-selected when the job was marked completed.'
            : 'Companies listed here have roles you have applied to (same client pool as your applications).'}
        </Text>

        {companies.length === 0 ? (
          <Text style={styles.warn}>
            No clients yet. Apply to a job first, or open Finance when a completed project is ready to invoice.
          </Text>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>Client (company)</Text>
            {companies.map((c) => {
              const sel = selectedCompany === c.id
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, sel && styles.chipSelected]}
                  onPress={() => setSelectedCompany(c.id)}
                >
                  <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{c.name}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        )}

        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Director fee — March shoot"
          placeholderTextColor="rgba(255,255,255,0.28)"
        />

        <Text style={styles.label}>Amount</Text>
        <View style={styles.row2}>
          <TextInput
            style={[styles.input, styles.inputFlex]}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor="rgba(255,255,255,0.28)"
            keyboardType="decimal-pad"
          />
          <TextInput
            style={[styles.input, styles.curInput]}
            value={currency}
            onChangeText={setCurrency}
            placeholder="EUR"
            placeholderTextColor="rgba(255,255,255,0.28)"
            autoCapitalize="characters"
          />
        </View>

        <Text style={styles.label}>Due date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={dueDate}
          onChangeText={setDueDate}
          placeholder="2026-04-30"
          placeholderTextColor="rgba(255,255,255,0.28)"
        />

        <Text style={styles.label}>Invoice no. (optional)</Text>
        <TextInput
          style={styles.input}
          value={invoiceNumber}
          onChangeText={setInvoiceNumber}
          placeholder="INV-2026-001"
          placeholderTextColor="rgba(255,255,255,0.28)"
        />

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          style={[styles.input, styles.bio]}
          value={description}
          onChangeText={setDescription}
          multiline
          textAlignVertical="top"
          placeholder="Line items, VAT note, PO number…"
          placeholderTextColor="rgba(255,255,255,0.28)"
        />

        <TouchableOpacity
          style={[styles.primaryBtn, (saving || !selectedCompany || companies.length === 0) && styles.dim]}
          onPress={onSave}
          disabled={saving || !selectedCompany || companies.length === 0}
        >
          {saving ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.primaryBtnText}>Create invoice</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 12, alignSelf: 'flex-start' },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff', marginBottom: 8 },
  sub: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 20, lineHeight: 18 },
  warn: { fontSize: 14, color: 'rgba(255,220,0,0.75)', lineHeight: 20, marginBottom: 16 },
  card: { marginBottom: 20 },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  chip: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 8,
    backgroundColor: '#111',
  },
  chipSelected: { borderColor: 'rgba(255,220,0,0.5)', backgroundColor: 'rgba(255,220,0,0.08)' },
  chipText: { color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  chipTextSelected: { color: '#FFDC00' },
  input: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  row2: { flexDirection: 'row', gap: 10, marginBottom: 0 },
  inputFlex: { flex: 1 },
  curInput: { width: 88 },
  bio: { minHeight: 100 },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  dim: { opacity: 0.5 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
})

import { useCallback, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { parseIsoDateInput } from '@/lib/isoDateInput'
import { formatJobCategoryRoles } from '@/lib/jobCategoryRoles'

const CATEGORIES = ['Film / Video', 'Photo', 'Post / Edit', 'Motion', 'Design', 'Other'] as const
const BUDGET_TYPES = [
  { id: 'negotiable', label: 'Negotiable' },
  { id: 'day_rate', label: 'Day rate' },
  { id: 'fixed', label: 'Fixed budget' },
] as const
const LOCATIONS = [
  { id: 'remote', label: 'Remote' },
  { id: 'on_site', label: 'On-site' },
  { id: 'hybrid', label: 'Hybrid' },
] as const

export default function CompanyPostJobScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([CATEGORIES[0]])
  const [budgetType, setBudgetType] = useState<(typeof BUDGET_TYPES)[number]['id']>('negotiable')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('EUR')
  const [locationType, setLocationType] = useState<(typeof LOCATIONS)[number]['id']>('hybrid')
  const [description, setDescription] = useState('')
  const [prodStart, setProdStart] = useState('')
  const [prodEnd, setProdEnd] = useState('')

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) {
            setAllowed(false)
            setLoading(false)
            router.replace('/login')
          }
          return
        }
        const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        const role = resolveAppRole(p?.role, user)
        if (!cancelled) {
          setAllowed(isCompanyProfile(role))
          setLoading(false)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [router])
  )

  const onPublish = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !allowed) return
    const t = title.trim()
    if (!t) {
      Alert.alert('Project title', 'Please enter a project title.')
      return
    }
    if (selectedCategories.length === 0) {
      Alert.alert('Roles', 'Pick at least one category.')
      return
    }
    let amount: number | null = null
    if (budgetType !== 'negotiable') {
      const raw = budgetAmount.replace(',', '.').trim()
      const n = parseFloat(raw)
      if (Number.isNaN(n) || n <= 0) {
        Alert.alert('Budget', 'Enter a positive number for the budget or day rate.')
        return
      }
      amount = n
    }

    const curRaw = budgetCurrency.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    const budget_currency = curRaw.length === 3 ? curRaw : 'EUR'

    const ps = prodStart.trim()
    const pe = prodEnd.trim()
    if ((ps && !pe) || (!ps && pe)) {
      Alert.alert('Production window', 'Enter both start and end (YYYY-MM-DD), or leave both empty.')
      return
    }
    const prodA = ps ? parseIsoDateInput(ps) : null
    const prodB = pe ? parseIsoDateInput(pe) : null
    if (ps && !prodA) {
      Alert.alert('Production window', 'Start date must be YYYY-MM-DD.')
      return
    }
    if (pe && !prodB) {
      Alert.alert('Production window', 'End date must be YYYY-MM-DD.')
      return
    }
    if (prodA && prodB && prodB < prodA) {
      Alert.alert('Production window', 'End date must be on or after start.')
      return
    }

    setSaving(true)
    const { data: inserted, error } = await supabase
      .from('jobs')
      .insert({
        title: t,
        category: formatJobCategoryRoles(selectedCategories),
        budget_type: budgetType,
        budget_amount: amount,
        budget_currency,
        location_type: locationType,
        description: description.trim() || null,
        company_id: user.id,
        status: 'active',
        is_solo_workspace: false,
      })
      .select('id')
      .maybeSingle()
    if (!error && inserted?.id && prodA && prodB) {
      const { error: pErr } = await supabase
        .from('projects')
        .update({
          scheduling_start_date: prodA,
          scheduling_end_date: prodB,
        })
        .eq('id', inserted.id)
      if (pErr) {
        setSaving(false)
        Alert.alert(
          'Published without schedule',
          `${pErr.message}\n\nYour listing is live; open the project workspace Overview to set production dates.`
        )
        router.replace('/(tabs)/jobs')
        return
      }
    }
    setSaving(false)
    if (error) {
      Alert.alert(
        'Could not publish',
        `${error.message}\n\nIf this mentions RLS or permission, run supabase/sql/company_jobs_write.sql in the Supabase SQL editor.`
      )
      return
    }
    Alert.alert('Published', 'Your project is live in the feed.', [
      { text: 'OK', onPress: () => router.replace('/(tabs)/jobs') },
    ])
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
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.blockTitle}>Companies only</Text>
          <Text style={styles.blockSub}>
            The public job board is for company accounts. Freelancers create private projects (Dashboard → Private
            projects) and invite others there — those listings never appear in Jobs.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Tools</Text>
      </TouchableOpacity>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Post a project</Text>
        <Text style={styles.sub}>Freelancers can apply from the Jobs tab. You manage applicants on the project page.</Text>

        <Text style={styles.label}>Project title</Text>
        <Text style={styles.hintInline}>
          Shown on the listing; freelancers see it prefilled in the invoice flow and can adjust it.
        </Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Spring campaign — hero film"
          placeholderTextColor="rgba(255,255,255,0.28)"
        />

        <Text style={styles.label}>Roles</Text>
        <Text style={styles.hintInline}>Pick one or more — they are stored together on the listing.</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => {
            const sel = selectedCategories.includes(c)
            return (
              <TouchableOpacity
                key={c}
                style={[styles.chip, sel && styles.chipSelected]}
                onPress={() =>
                  setSelectedCategories((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                  )
                }
              >
                <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{c}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={styles.label}>Budget</Text>
        <View style={styles.chipRow}>
          {BUDGET_TYPES.map((b) => {
            const sel = budgetType === b.id
            return (
              <TouchableOpacity
                key={b.id}
                style={[styles.chip, sel && styles.chipSelected]}
                onPress={() => setBudgetType(b.id)}
              >
                <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{b.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        {budgetType !== 'negotiable' ? (
          <>
            <Text style={styles.label}>Currency (ISO 4217)</Text>
            <TextInput
              style={styles.input}
              value={budgetCurrency}
              onChangeText={(x) => setBudgetCurrency(x.toUpperCase().replace(/[^A-Za-z]/g, '').slice(0, 3))}
              placeholder="EUR"
              placeholderTextColor="rgba(255,255,255,0.28)"
              autoCapitalize="characters"
              maxLength={3}
            />
            <Text style={styles.label}>{budgetType === 'day_rate' ? 'Day rate' : 'Fixed budget'}</Text>
            <TextInput
              style={styles.input}
              value={budgetAmount}
              onChangeText={setBudgetAmount}
              placeholder="e.g. 1200"
              placeholderTextColor="rgba(255,255,255,0.28)"
              keyboardType="decimal-pad"
            />
          </>
        ) : null}

        <Text style={styles.label}>Location</Text>
        <View style={styles.chipRow}>
          {LOCATIONS.map((l) => {
            const sel = locationType === l.id
            return (
              <TouchableOpacity
                key={l.id}
                style={[styles.chip, sel && styles.chipSelected]}
                onPress={() => setLocationType(l.id)}
              >
                <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{l.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={styles.label}>Production window (optional)</Text>
        <Text style={styles.hintInline}>
          Inclusive dates for the whole job — blocks the lead freelancer&apos;s public calendar when active. Per-role
          lengths: Crew tab in the workspace.
        </Text>
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Text style={styles.dateFieldLbl}>Start</Text>
            <TextInput
              style={[styles.input, styles.inputNoMb]}
              value={prodStart}
              onChangeText={setProdStart}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="rgba(255,255,255,0.28)"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.dateField}>
            <Text style={styles.dateFieldLbl}>End</Text>
            <TextInput
              style={[styles.input, styles.inputNoMb]}
              value={prodEnd}
              onChangeText={setProdEnd}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="rgba(255,255,255,0.28)"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.bio]}
          value={description}
          onChangeText={setDescription}
          placeholder="Deliverables, dates, kit, usage…"
          placeholderTextColor="rgba(255,255,255,0.28)"
          multiline
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.primaryBtn, saving && styles.dim]}
          onPress={onPublish}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.primaryBtnText}>Publish project</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '900', color: '#fff', marginBottom: 8 },
  sub: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 20, lineHeight: 18 },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
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
  bio: { minHeight: 120 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111',
  },
  chipSelected: { borderColor: 'rgba(255,220,0,0.45)', backgroundColor: 'rgba(255,220,0,0.08)' },
  chipText: { color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#FFDC00' },
  hintInline: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.32)',
    lineHeight: 17,
    marginBottom: 10,
    marginTop: -6,
  },
  dateRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  dateField: { flex: 1, minWidth: 0 },
  dateFieldLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  inputNoMb: { marginBottom: 0 },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  dim: { opacity: 0.55 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
})

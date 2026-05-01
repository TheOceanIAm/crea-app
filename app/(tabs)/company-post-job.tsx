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
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [budgetType, setBudgetType] = useState<(typeof BUDGET_TYPES)[number]['id']>('negotiable')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('EUR')
  const [locationType, setLocationType] = useState<(typeof LOCATIONS)[number]['id']>('hybrid')
  const [description, setDescription] = useState('')

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
      Alert.alert('Title', 'Please enter a project title.')
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

    setSaving(true)
    const { error } = await supabase.from('jobs').insert({
      title: t,
      category,
      budget_type: budgetType,
      budget_amount: amount,
      budget_currency,
      location_type: locationType,
      description: description.trim() || null,
      company_id: user.id,
      status: 'active',
      is_solo_workspace: false,
    })
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
          <Text style={styles.blockSub}>Only company accounts can post projects.</Text>
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

        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Director of Photography — 3 day commercial"
          placeholderTextColor="rgba(255,255,255,0.28)"
        />

        <Text style={styles.label}>Category</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => {
            const sel = category === c
            return (
              <TouchableOpacity
                key={c}
                style={[styles.chip, sel && styles.chipSelected]}
                onPress={() => setCategory(c)}
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
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

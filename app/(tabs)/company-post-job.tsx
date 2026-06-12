import { useCallback, useMemo, useState } from 'react'
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
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView'
import { useFocusEffect, useRouter } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { parseIsoDateInput } from '@/lib/isoDateInput'
import { formatJobCategoryRoles } from '@/lib/jobCategoryRoles'
import {
  FEATURED_JOB_LISTING_ROLES,
  filterJobListingRoleCategories,
} from '@/lib/jobListingRoleCategories'
import {
  companyFreeJobListingLimitMessage,
  companyJobListingMonthStartUtc,
  companyJobListingPostCap,
} from '@/lib/company-plan'
import { resolveCompanySubscriptionPlanFromSources } from '@/lib/companyPlanFromSession'
import { isWithinPlatformTrialPeriod } from '@/lib/platformTrial'

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
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [roleFilter, setRoleFilter] = useState('')
  const [rolesExpanded, setRolesExpanded] = useState(false)
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
        const user = await getAuthUser()
        if (!user) {
          if (!cancelled) {
            setAllowed(false)
            setLoading(false)
            router.replace('/login')
          }
          return
        }
        const { data: p } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
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

  const filteredRoles = useMemo(
    () => filterJobListingRoleCategories(roleFilter),
    [roleFilter]
  )

  const toggleRole = useCallback((role: string) => {
    setSelectedCategories((prev) =>
      prev.includes(role) ? prev.filter((x) => x !== role) : [...prev, role]
    )
  }, [])

  const onPublish = async () => {
    const user = await getAuthUser()
    if (!user || !allowed) return
    const t = title.trim()
    if (!t) {
      Alert.alert('Project title', 'Please enter a project title.')
      return
    }
    if (selectedCategories.length === 0) {
      Alert.alert('Roles', 'Pick at least one role.')
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier, trial_ends_at, beta_invite')
      .eq('id', user.id)
      .maybeSingle()
    const { data: cp } = await supabase
      .from('company_profiles')
      .select('subscription_plan')
      .eq('id', user.id)
      .maybeSingle()
    const plan = resolveCompanySubscriptionPlanFromSources(
      user,
      profile?.subscription_tier,
      cp?.subscription_plan
    )
    const inPlatformTrial = isWithinPlatformTrialPeriod(profile?.trial_ends_at, user.created_at)
    const cap = companyJobListingPostCap(plan, inPlatformTrial)
    if (Number.isFinite(cap)) {
      const monthStart = companyJobListingMonthStartUtc()
      const { count, error: countErr } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', user.id)
        .gte('created_at', monthStart)
      if (countErr) {
        Alert.alert('Could not verify limit', countErr.message)
        return
      }
      if ((count ?? 0) >= cap) {
        Alert.alert(
          'Monthly listing limit reached',
          companyFreeJobListingLimitMessage(),
          [{ text: 'View plans', onPress: () => router.push('/paywall') }, { text: 'OK', style: 'cancel' }]
        )
        return
      }
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

      <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Post a project</Text>
        <Text style={styles.sub}>Freelancers can apply from the Jobs tab. Review applicants on Pro.</Text>

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
        <Text style={styles.hintInline}>
          Pick every discipline you need — shown as one listing; feed filters match any role.
        </Text>
        {selectedCategories.length > 0 ? (
          <View style={[styles.chipRow, styles.selectedRoleRow]}>
            {selectedCategories.map((c) => (
              <TouchableOpacity
                key={`sel-${c}`}
                style={[styles.chip, styles.chipSelected, styles.selectedRoleChip]}
                onPress={() => toggleRole(c)}
              >
                <Text style={[styles.chipText, styles.chipTextSelected]}>
                  {c}
                  <Text style={styles.chipRemove}> ×</Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {rolesExpanded ? (
          <>
            <TextInput
              style={[styles.input, styles.roleSearchInput]}
              value={roleFilter}
              onChangeText={setRoleFilter}
              placeholder="Search roles…"
              placeholderTextColor="rgba(255,255,255,0.28)"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.chipRow}>
              {filteredRoles.length === 0 ? (
                <Text style={styles.roleEmpty}>No matching roles</Text>
              ) : (
                filteredRoles.map((c) => {
                  const sel = selectedCategories.includes(c)
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, sel && styles.chipSelected]}
                      onPress={() => toggleRole(c)}
                    >
                      <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{c}</Text>
                    </TouchableOpacity>
                  )
                })
              )}
            </View>
            <TouchableOpacity
              style={styles.roleLessBtn}
              onPress={() => {
                setRolesExpanded(false)
                setRoleFilter('')
              }}
              hitSlop={8}
            >
              <Text style={styles.roleLessBtnText}>Show fewer roles</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.chipRow}>
            {FEATURED_JOB_LISTING_ROLES.map((c) => {
              const sel = selectedCategories.includes(c)
              return (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, sel && styles.chipSelected]}
                  onPress={() => toggleRole(c)}
                >
                  <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{c}</Text>
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity
              style={[styles.chip, styles.chipMore]}
              onPress={() => setRolesExpanded(true)}
              accessibilityLabel="Show more roles"
            >
              <Plus size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>
        )}

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
      </KeyboardAwareScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20 },
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
  selectedRoleRow: { marginBottom: 8 },
  selectedRoleChip: { paddingRight: 10 },
  chipRemove: { color: 'rgba(255,220,0,0.55)', fontWeight: '700' },
  roleSearchInput: { marginBottom: 10 },
  chipMore: {
    minWidth: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'rgba(255,220,0,0.35)',
    backgroundColor: 'rgba(255,220,0,0.06)',
  },
  roleLessBtn: { alignSelf: 'flex-start', marginBottom: 16, marginTop: -4 },
  roleLessBtnText: {
    color: 'rgba(255,220,0,0.85)',
    fontSize: 13,
    fontWeight: '600',
  },
  roleEmpty: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    paddingVertical: 8,
    width: '100%',
  },
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
  trialBanner: {
    marginBottom: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
  },
  trialBannerTitle: { fontSize: 14, fontWeight: '800', color: '#FFDC00', marginBottom: 6 },
  trialBannerText: { fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 19, marginBottom: 12 },
  trialBannerBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFDC00',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  trialBannerBtnText: { fontSize: 13, fontWeight: '800', color: '#0a0a0a' },
})

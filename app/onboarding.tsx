import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Briefcase, Building2, ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'

type RoleChoice = 'freelancer' | 'company'

export default function OnboardingScreen() {
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<0 | 1>(0)
  const [roleChoice, setRoleChoice] = useState<RoleChoice | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [headline, setHeadline] = useState('')
  const [saving, setSaving] = useState(false)

  const verifySession = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/login')
      return
    }
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('onboarding_completed') || msg.includes('column')) {
        Alert.alert(
          'Database update needed',
          'Run supabase/sql/add_profile_onboarding.sql in the Supabase SQL Editor, then reopen the app.'
        )
        router.replace('/(tabs)/dashboard')
        return
      }
    }

    if (profile?.onboarding_completed === true) {
      router.replace('/(tabs)/dashboard')
      return
    }
    setChecking(false)
  }, [])

  useEffect(() => {
    verifySession()
  }, [verifySession])

  const goNext = () => {
    if (step === 0 && roleChoice) {
      setStep(1)
      return
    }
    if (step === 1) {
      void completeOnboarding()
    }
  }

  const completeOnboarding = async () => {
    const name = displayName.trim()
    if (!roleChoice) {
      Alert.alert('Account type', 'Choose how you want to use Crea.')
      return
    }
    if (name.length < 2) {
      Alert.alert('Name', 'Please enter at least 2 characters.')
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/login')
      return
    }

    setSaving(true)
    const { error } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        name,
        role: roleChoice,
        headline: headline.trim() || null,
        onboarding_completed: true,
      },
      { onConflict: 'id' }
    )
    setSaving(false)

    if (error) {
      Alert.alert('Could not save', error.message)
      return
    }

    router.replace('/(tabs)/dashboard')
  }

  if (checking) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.kicker}>WELCOME TO CREA</Text>
          <Text style={styles.title}>
            {step === 0 ? 'How will you use Crea?' : 'Tell us about you'}
          </Text>
          <Text style={styles.sub}>
            {step === 0
              ? 'You can change details later in settings.'
              : roleChoice === 'company'
                ? 'This is how you appear to freelancers.'
                : 'This is how you appear on your public profile.'}
          </Text>

          {step === 0 ? (
            <View style={styles.roleGrid}>
              <TouchableOpacity
                style={[styles.roleCard, roleChoice === 'freelancer' && styles.roleCardSelected]}
                onPress={() => setRoleChoice('freelancer')}
                activeOpacity={0.85}
              >
                <View style={styles.roleIconWrap}>
                  <Briefcase size={28} color="#FFDC00" strokeWidth={ICON_STROKE} />
                </View>
                <Text style={styles.roleTitle}>I’m a freelancer</Text>
                <Text style={styles.roleDesc}>Find jobs, send invoices, share your portfolio.</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.roleCard, roleChoice === 'company' && styles.roleCardSelected]}
                onPress={() => setRoleChoice('company')}
                activeOpacity={0.85}
              >
                <View style={styles.roleIconWrap}>
                  <Building2 size={28} color="#FFDC00" strokeWidth={ICON_STROKE} />
                </View>
                <Text style={styles.roleTitle}>I hire talent</Text>
                <Text style={styles.roleDesc}>Post roles, review applicants, pay invoices.</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity style={styles.backRow} onPress={() => setStep(0)} hitSlop={12}>
                <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>
                {roleChoice === 'company' ? 'Company or brand name' : 'Your name'}
              </Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder={roleChoice === 'company' ? 'e.g. North Frame Studio' : 'e.g. Alex Müller'}
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="words"
              />

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>
                {roleChoice === 'company' ? 'Headline (optional)' : 'Role / title (optional)'}
              </Text>
              <TextInput
                style={styles.input}
                value={headline}
                onChangeText={setHeadline}
                placeholder={
                  roleChoice === 'company'
                    ? 'e.g. Commercial production · Berlin'
                    : 'e.g. Director of Photography'
                }
                placeholderTextColor="rgba(255,255,255,0.3)"
              />
            </>
          )}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (step === 0 && !roleChoice) || saving ? styles.primaryBtnDisabled : null,
            ]}
            onPress={goNext}
            disabled={(step === 0 && !roleChoice) || saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.primaryBtnText}>{step === 0 ? 'Continue' : 'Finish'}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.stepHint}>{step === 0 ? 'Step 1 of 2' : 'Step 2 of 2'}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  centered: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 32 },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 10,
    marginTop: 8,
  },
  title: { fontSize: 26, fontWeight: '900', color: '#ffffff', marginBottom: 10, letterSpacing: 0.2 },
  sub: { fontSize: 14, color: 'rgba(255,255,255,0.38)', lineHeight: 20, marginBottom: 28 },
  roleGrid: { gap: 14, marginBottom: 28 },
  roleCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  roleCardSelected: {
    borderColor: 'rgba(255,220,0,0.45)',
    backgroundColor: 'rgba(255,220,0,0.06)',
  },
  roleIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  roleTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 6 },
  roleDesc: { fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 18 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 20, alignSelf: 'flex-start' },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  fieldLabelSpaced: { marginTop: 18 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 16,
  },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 100,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },
  stepHint: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 1,
  },
})

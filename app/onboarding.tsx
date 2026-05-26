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
  Switch,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Briefcase, Building2, Camera, ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { profileNeedsOnboarding } from '@/lib/onboardingGate'
import { pickAndUploadAvatarOnly } from '@/lib/uploadProfileAvatar'
import { openPrivacy, openTerms } from '@/lib/creaLegal'
import { postTrialPlan } from '@/lib/trialPlanApi'
import { IOS_SUBSCRIPTION_PURCHASE_ON_WEB_ONLY, getLoggedOutEntryRoute } from '@/lib/iosAppStoreCompliance'
import {
  freelancerPlanDescription,
  freelancerPlanLabel,
  companyStripePlanDescription,
  companyStripePlanLabel,
  type NormalizedFreelancerPlan,
} from '@/lib/billingDisplay'
import type { CompanySubscriptionPlanDb } from '@/lib/companyPlanFromSession'

type RoleChoice = 'freelancer' | 'company'

type TrialFreelancerPlanKey = NormalizedFreelancerPlan
type TrialCompanyPlanKey = CompanySubscriptionPlanDb

const FREELANCER_TRIAL_OPTIONS: TrialFreelancerPlanKey[] = ['free', 'pro']
const COMPANY_TRIAL_OPTIONS: TrialCompanyPlanKey[] = ['free', 'pro']

export default function OnboardingScreen() {
  const [checking, setChecking] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)
  const [roleChoice, setRoleChoice] = useState<RoleChoice | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [headline, setHeadline] = useState('')
  const [avatarPublicUrl, setAvatarPublicUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [trialFreelancerPlan, setTrialFreelancerPlan] = useState<TrialFreelancerPlanKey>('free')
  const [trialCompanyPlan, setTrialCompanyPlan] = useState<TrialCompanyPlanKey>('free')

  const verifySession = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace(getLoggedOutEntryRoute())
      return
    }
    setUserId(user.id)

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
        router.replace('/(tabs)/feed')
        return
      }
    }

    if (!profileNeedsOnboarding(profile)) {
      router.replace('/(tabs)/feed')
      return
    }
    setChecking(false)
  }, [])

  useEffect(() => {
    verifySession()
  }, [verifySession])

  const onPickAvatar = async () => {
    if (!userId) return
    setUploadingAvatar(true)
    const res = await pickAndUploadAvatarOnly(userId)
    setUploadingAvatar(false)
    if (res.ok === false) {
      if (!res.cancelled) {
        Alert.alert('Photo', res.error)
      }
      return
    }
    setAvatarPublicUrl(res.publicUrl)
  }

  const goNext = () => {
    if (step === 0 && roleChoice) {
      setStep(IOS_SUBSCRIPTION_PURCHASE_ON_WEB_ONLY ? 2 : 1)
      return
    }
    if (step === 1) {
      setStep(2)
      return
    }
    if (step === 2) {
      const name = displayName.trim()
      if (name.length < 2) {
        Alert.alert('Name', 'Please enter at least 2 characters.')
        return
      }
      setStep(3)
      return
    }
    if (step === 3) {
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
    if (!termsAccepted) {
      Alert.alert('Terms', 'Please accept the Terms of Service and Privacy Policy to continue.')
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace(getLoggedOutEntryRoute())
      return
    }

    const acceptedAt = new Date().toISOString()

    setSaving(true)

    const trialRes = await postTrialPlan(
      roleChoice === 'freelancer'
        ? { freelancer_plan: trialFreelancerPlan }
        : { company_plan: trialCompanyPlan }
    )
    if (!trialRes.ok && trialRes.error && trialRes.error !== 'missing_web_url') {
      console.warn('[onboarding] trial plan:', trialRes.error)
    }

    const { error } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        name,
        role: roleChoice,
        headline: headline.trim() || null,
        avatar_url: avatarPublicUrl,
        onboarding_completed: true,
        terms_accepted_at: acceptedAt,
      },
      { onConflict: 'id' }
    )
    setSaving(false)

    if (error) {
      const em = error.message.toLowerCase()
      if (em.includes('terms_accepted_at') || em.includes('column')) {
        Alert.alert(
          'Database update needed',
          'Run supabase/sql/add_profile_terms_accepted.sql in the Supabase SQL Editor, then tap Finish again.'
        )
      } else {
        Alert.alert('Could not save', error.message)
      }
      return
    }

    const { error: metaErr } = await supabase.auth.updateUser({
      data: {
        name,
        full_name: name,
      },
    })
    if (metaErr) {
      console.warn('[onboarding] auth.updateUser metadata:', metaErr.message)
    }

    router.replace('/(tabs)/feed')
  }

  const goBack = () => {
    if (IOS_SUBSCRIPTION_PURCHASE_ON_WEB_ONLY) {
      if (step === 2) setStep(0)
      else if (step === 3) setStep(2)
      return
    }
    if (step === 1) setStep(0)
    else if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
  }

  const showAvatarImage = avatarPublicUrl && /^https?:\/\//i.test(avatarPublicUrl.trim())

  if (checking) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  const title =
    step === 0
      ? 'How will you use Crea?'
      : step === 1
        ? 'Trial plan'
        : step === 2
          ? 'Tell us about you'
          : 'Photo & agreements'

  const sub =
    step === 0
      ? 'You can change details later in settings.'
      : step === 1
        ? 'During your 30-day platform trial you can preview Free vs Pro. Switch anytime under Profile → Plan (same as creaservices.de).'
        : step === 2
          ? roleChoice === 'company'
            ? 'This is how you appear to freelancers.'
            : 'This is how you appear on your public profile.'
          : 'Profile photo is optional. You must accept our policies to finish.'

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
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>{sub}</Text>

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
                <Text style={styles.roleTitle}>I'm a freelancer</Text>
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
          ) : null}

          {step === 1 && roleChoice && !IOS_SUBSCRIPTION_PURCHASE_ON_WEB_ONLY ? (
            <>
              <TouchableOpacity style={styles.backRow} onPress={goBack} hitSlop={12}>
                <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>

              <View style={styles.roleGrid}>
                {(roleChoice === 'freelancer' ? FREELANCER_TRIAL_OPTIONS : COMPANY_TRIAL_OPTIONS).map((key) => {
                  const selected =
                    roleChoice === 'freelancer'
                      ? trialFreelancerPlan === key
                      : trialCompanyPlan === key
                  const titleLabel =
                    roleChoice === 'freelancer'
                      ? freelancerPlanLabel(key as TrialFreelancerPlanKey)
                      : companyStripePlanLabel(key as TrialCompanyPlanKey)
                  const desc =
                    roleChoice === 'freelancer'
                      ? freelancerPlanDescription(key as TrialFreelancerPlanKey)
                      : companyStripePlanDescription(key as TrialCompanyPlanKey)
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.roleCard, selected && styles.roleCardSelected]}
                      onPress={() =>
                        roleChoice === 'freelancer'
                          ? setTrialFreelancerPlan(key as TrialFreelancerPlanKey)
                          : setTrialCompanyPlan(key as TrialCompanyPlanKey)
                      }
                      activeOpacity={0.85}
                    >
                      <Text style={styles.roleTitle}>{titleLabel}</Text>
                      <Text style={styles.roleDesc}>{desc}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
              {roleChoice === 'company' ? (
                <Text style={styles.trialFootnote}>
                  During the 30-day platform trial, both options give full Pro features. After trial, companies need Pro
                  to continue.
                </Text>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <TouchableOpacity style={styles.backRow} onPress={goBack} hitSlop={12}>
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
                placeholder={roleChoice === 'company' ? 'e.g. North Frame Studio' : 'e.g. Jamie Chen'}
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
          ) : null}

          {step === 3 ? (
            <>
              <TouchableOpacity style={styles.backRow} onPress={goBack} hitSlop={12}>
                <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Profile photo (optional)</Text>
              <TouchableOpacity
                style={styles.avatarRow}
                onPress={onPickAvatar}
                disabled={uploadingAvatar}
                activeOpacity={0.85}
              >
                <View style={styles.avatarCircle}>
                  {showAvatarImage ? (
                    <Image source={{ uri: avatarPublicUrl!.trim() }} style={styles.avatarImage} />
                  ) : (
                    <Camera size={28} color="rgba(255,220,0,0.5)" strokeWidth={ICON_STROKE} />
                  )}
                </View>
                <View style={styles.avatarMeta}>
                  <Text style={styles.avatarCta}>
                    {uploadingAvatar ? 'Uploading…' : showAvatarImage ? 'Change photo' : 'Add photo'}
                  </Text>
                  <Text style={styles.avatarHint}>Square crop · shown on your profile</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.termsCard}>
                <View style={styles.notifyBlock}>
                  <View style={styles.notifyBlockText}>
                    <Text style={styles.notifyBlockTitle}>Terms &amp; Privacy</Text>
                    <Text style={styles.notifyBlockSub}>
                      I agree to the{' '}
                      <Text style={styles.linkInline} onPress={openTerms}>
                        Terms of Service
                      </Text>{' '}
                      and{' '}
                      <Text style={styles.linkInline} onPress={openPrivacy}>
                        Privacy Policy
                      </Text>
                      .
                    </Text>
                  </View>
                  <Switch
                    value={termsAccepted}
                    onValueChange={setTermsAccepted}
                    trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                    thumbColor={termsAccepted ? '#FFDC00' : '#888'}
                  />
                </View>
              </View>
            </>
          ) : null}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              ((step === 0 && !roleChoice) ||
                (step === 2 && displayName.trim().length < 2) ||
                (step === 3 && (!termsAccepted || saving)) ||
                saving) &&
                styles.primaryBtnDisabled,
            ]}
            onPress={goNext}
            disabled={
              (step === 0 && !roleChoice) ||
              (step === 2 && displayName.trim().length < 2) ||
              (step === 3 && (!termsAccepted || saving)) ||
              saving
            }
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {step === 3 ? 'Finish' : 'Continue'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.stepHint}>
            {IOS_SUBSCRIPTION_PURCHASE_ON_WEB_ONLY
              ? step === 0
                ? 'Step 1 of 3'
                : step === 2
                  ? 'Step 2 of 3'
                  : 'Step 3 of 3'
              : step === 0
                ? 'Step 1 of 4'
                : step === 1
                  ? 'Step 2 of 4'
                  : step === 2
                    ? 'Step 3 of 4'
                    : 'Step 4 of 4'}
          </Text>

          <TouchableOpacity
            style={styles.signOutRow}
            onPress={async () => {
              await supabase.auth.signOut({ scope: 'local' })
              router.replace(getLoggedOutEntryRoute())
            }}
            hitSlop={12}
          >
            <Text style={styles.signOutText}>Use a different account</Text>
          </TouchableOpacity>
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
  trialFootnote: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.28)',
    lineHeight: 16,
    marginTop: -12,
    marginBottom: 8,
  },
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
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 72, height: 72, borderRadius: 36 },
  avatarMeta: { flex: 1 },
  avatarCta: { fontSize: 16, fontWeight: '700', color: '#FFDC00', marginBottom: 4 },
  avatarHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 16 },
  termsCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 8,
  },
  notifyBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 12,
  },
  notifyBlockText: { flex: 1 },
  notifyBlockTitle: { fontSize: 15, fontWeight: '600', color: '#ffffff', marginBottom: 6 },
  notifyBlockSub: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 19 },
  linkInline: { color: '#FFDC00', fontWeight: '700', textDecorationLine: 'underline' },
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
  signOutRow: { alignSelf: 'center', marginTop: 20, paddingVertical: 8 },
  signOutText: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontWeight: '600' },
})

/**
 * Interactive UX prototype — simplified CREA platform flow (NOVA-inspired).
 * Dev-only entry from Login. Does not write to Supabase.
 */
import { useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Briefcase, Building2, ChevronLeft, Layers, Lock, X } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'

type Step = 'landing' | 'intent' | 'profile' | 'feed' | 'job' | 'paywall'
type Intent = 'find-work' | 'hire' | 'both'

const STEPS: Step[] = ['landing', 'intent', 'profile', 'feed', 'job', 'paywall']

const INTENT_OPTIONS: {
  key: Intent
  kicker: string
  title: string
  desc: string
  icon: typeof Briefcase
}[] = [
  {
    key: 'find-work',
    kicker: 'Ich bin Freelancer',
    title: 'Ich suche Arbeit',
    desc: 'Jobs durchstöbern, bewerben mit Pro, Rechnungen & Portfolio.',
    icon: Briefcase,
  },
  {
    key: 'hire',
    kicker: 'Ich stelle ein',
    title: 'Ich suche Talent',
    desc: 'Jobs posten, Bewerber prüfen, Crew einladen.',
    icon: Building2,
  },
  {
    key: 'both',
    kicker: 'Ich mache beides',
    title: 'Arbeiten & Einstellen',
    desc: 'Freelancer-Profil plus eigene Jobs — wie viele Creatives.',
    icon: Layers,
  },
]

const MOCK_JOBS = [
  {
    id: '1',
    title: '1st AC needed for a Music Video in Los Angeles, CA on 5/26',
    pay: '$600 – $1k',
    ago: '3 hours ago',
  },
  {
    id: '2',
    title: 'Editor for brand film — remote, 2-week turnaround',
    pay: 'EUR 450/day',
    ago: 'Yesterday',
  },
]

export default function PlatformFlowPreviewScreen() {
  const [step, setStep] = useState<Step>('landing')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [name, setName] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<'yearly' | 'monthly'>('yearly')

  const stepIndex = STEPS.indexOf(step)
  const greeting = useMemo(() => {
    const n = name.trim()
    return n.length >= 2 ? `Welcome, ${n.split(' ')[0]}` : 'Welcome'
  }, [name])

  const goBack = () => {
    if (stepIndex <= 0) return
    setStep(STEPS[stepIndex - 1])
  }

  const goNext = () => {
    if (step === 'landing') {
      setStep('intent')
      return
    }
    if (step === 'intent' && intent) {
      setStep('profile')
      return
    }
    if (step === 'profile' && name.trim().length >= 2) {
      setStep('feed')
      return
    }
    if (step === 'feed') {
      setStep('job')
      return
    }
    if (step === 'job') {
      setStep('paywall')
    }
  }

  const header = (title: string, sub?: string) => (
    <>
      <Text style={styles.kicker}>CREA · FLOW-PROTOTYP</Text>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
          <X size={22} color="#fff" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
        <Text style={styles.stepPill}>
          {stepIndex + 1}/{STEPS.length} · {step}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 'landing' ? (
            <View style={styles.landingWrap}>
              <Text style={styles.logo}>CREA</Text>
              <Text style={styles.landingSub}>The platform for creative talent</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={goNext} activeOpacity={0.9}>
                <Text style={styles.primaryBtnText}>Sign up</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.textBtn} onPress={goNext} activeOpacity={0.85}>
                <Text style={styles.textBtnLabel}>Log in</Text>
              </TouchableOpacity>
              <Text style={styles.landingHint}>
                Neu: Kein Paywall-Start. Erst Jobs sehen, dann Pro beim Bewerben.
              </Text>
            </View>
          ) : null}

          {step === 'intent' ? (
            <>
              {header(greeting, 'Choose how you will use CREA. Plan tiers come later.')}
              <View style={styles.cardGrid}>
                {INTENT_OPTIONS.map((opt) => {
                  const Icon = opt.icon
                  const selected = intent === opt.key
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.intentCard, selected && styles.intentCardSelected]}
                      onPress={() => setIntent(opt.key)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.intentKicker}>{opt.kicker}</Text>
                      <View style={styles.intentRow}>
                        <Icon size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                        <Text style={styles.intentTitle}>{opt.title}</Text>
                      </View>
                      <Text style={styles.intentDesc}>{opt.desc}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </>
          ) : null}

          {step === 'profile' ? (
            <>
              {header('Tell us about you', 'Photo, headline and skills can wait.')}
              <Text style={styles.fieldLabel}>Your name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Jamie Chen"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
              {intent ? (
                <View style={styles.mappingBox}>
                  <Text style={styles.mappingLabel}>Auto-Mapping (Prototyp)</Text>
                  <Text style={styles.mappingValue}>
                    {intent === 'find-work'
                      ? 'role: freelancer · default plan: Starter'
                      : intent === 'hire'
                        ? 'role: company · default plan: Studio'
                        : 'role: freelancer + hiring enabled · default: Starter'}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          {step === 'feed' ? (
            <>
              {header('Find work', 'Browse for free. Apply and full details need Pro.')}
              <TouchableOpacity style={styles.proBanner} onPress={() => setStep('paywall')} activeOpacity={0.9}>
                <Lock size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <View style={styles.proBannerText}>
                  <Text style={styles.proBannerTitle}>Unlock Pro</Text>
                  <Text style={styles.proBannerSub}>Apply to unlimited jobs · Job alerts</Text>
                </View>
              </TouchableOpacity>
              {MOCK_JOBS.map((job) => (
                <TouchableOpacity
                  key={job.id}
                  style={styles.jobCard}
                  onPress={() => setStep('job')}
                  activeOpacity={0.88}
                >
                  <Text style={styles.jobTitle}>{job.title}</Text>
                  <Text style={styles.jobMeta}>
                    {job.pay} · {job.ago}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.postJobFab} activeOpacity={0.9}>
                <Text style={styles.postJobFabText}>+ Post a job</Text>
                <View style={styles.freePill}>
                  <Text style={styles.freePillText}>FREE</Text>
                </View>
              </TouchableOpacity>
            </>
          ) : null}

          {step === 'job' ? (
            <>
              <TouchableOpacity style={styles.backRow} onPress={goBack} hitSlop={12}>
                <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.backText}>Jobs</Text>
              </TouchableOpacity>
              <Text style={styles.jobDetailTitle}>
                1st AC needed for a Music Video in Los Angeles, CA on 5/26
              </Text>
              <Text style={styles.jobMeta}>Posted 3 hours ago · $600 – $1k</Text>
              <Text style={styles.sectionLabel}>Description</Text>
              <TouchableOpacity style={styles.lockedBox} onPress={() => setStep('paywall')} activeOpacity={0.9}>
                <Lock size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.lockedLabel}>Unlock with Pro</Text>
              </TouchableOpacity>
              <View style={styles.applyBar}>
                <Text style={styles.applyPay}>$600 – $1k</Text>
                <TouchableOpacity style={styles.applyBtn} onPress={() => setStep('paywall')} activeOpacity={0.9}>
                  <Text style={styles.applyBtnText}>Apply</Text>
                  <Lock size={14} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          {step === 'paywall' ? (
            <>
              <TouchableOpacity style={styles.backRow} onPress={goBack} hitSlop={12}>
                <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
              <Text style={styles.paywallLogo}>CREA</Text>
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>Pro</Text>
              </View>
              <Text style={styles.paywallHeadline}>Land the job that changes everything.</Text>
              {['Apply to unlimited jobs', 'Get instant job alerts', 'Boost your profile visibility'].map((f) => (
                <Text key={f} style={styles.featureLine}>
                  {f}
                </Text>
              ))}
              <TouchableOpacity
                style={[styles.planCard, selectedPlan === 'yearly' && styles.planCardSelected]}
                onPress={() => setSelectedPlan('yearly')}
                activeOpacity={0.9}
              >
                <View>
                  <Text style={styles.planTitle}>Yearly</Text>
                  <View style={styles.savePill}>
                    <Text style={styles.savePillText}>SAVE €47,89 /YR</Text>
                  </View>
                </View>
                <View style={styles.planPriceCol}>
                  <Text style={styles.planPrice}>59,99 € /yr</Text>
                  <Text style={styles.planSubPrice}>5,00 €/mo</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.planCard, selectedPlan === 'monthly' && styles.planCardSelected]}
                onPress={() => setSelectedPlan('monthly')}
                activeOpacity={0.9}
              >
                <Text style={styles.planTitle}>Monthly</Text>
                <Text style={styles.planPrice}>8,99 € /mo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.getProBtn} activeOpacity={0.9}>
                <Text style={styles.getProBtnText}>Get Pro</Text>
              </TouchableOpacity>
              <View style={styles.legalRow}>
                <Text style={styles.legalLink}>Privacy policy</Text>
                <Text style={styles.legalDot}>·</Text>
                <Text style={styles.legalLink}>Terms of service</Text>
                <Text style={styles.legalDot}>·</Text>
                <Text style={styles.legalLink}>Restore</Text>
              </View>
              <TouchableOpacity activeOpacity={0.85}>
                <Text style={styles.guestSub}>Subscribe without an account</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>

        {step !== 'landing' && step !== 'job' && step !== 'paywall' ? (
          <View style={styles.footer}>
            {stepIndex > 0 ? (
              <TouchableOpacity style={styles.secondaryBtn} onPress={goBack} activeOpacity={0.85}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.footerSpacer} />
            )}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                styles.footerPrimary,
                ((step === 'intent' && !intent) || (step === 'profile' && name.trim().length < 2)) &&
                  styles.btnDisabled,
              ]}
              onPress={goNext}
              disabled={(step === 'intent' && !intent) || (step === 'profile' && name.trim().length < 2)}
              activeOpacity={0.9}
            >
              <Text style={styles.primaryBtnText}>
                {step === 'profile' ? 'Continue to jobs' : step === 'feed' ? 'Open job detail' : 'Continue'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingBottom: 120 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  iconBtn: { padding: 6 },
  stepPill: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  kicker: {
    color: '#FFDC00',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 10,
    marginTop: 8,
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', lineHeight: 34, marginBottom: 8 },
  sub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 20, marginBottom: 22 },
  landingWrap: { flex: 1, justifyContent: 'center', minHeight: 520, paddingVertical: 40 },
  logo: {
    color: '#FFDC00',
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: 6,
    marginBottom: 8,
  },
  landingSub: { color: 'rgba(255,255,255,0.35)', fontSize: 13, letterSpacing: 0.5, marginBottom: 48 },
  landingHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 28,
    paddingHorizontal: 12,
  },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '800' },
  textBtn: { alignItems: 'center', marginTop: 18, paddingVertical: 10 },
  textBtnLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardGrid: { gap: 14, marginBottom: 20 },
  intentCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  intentCardSelected: { borderColor: '#FFDC00', borderWidth: 2 },
  intentKicker: { color: '#FFDC00', fontSize: 12, fontWeight: '700', marginBottom: 10 },
  intentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  intentTitle: { color: '#fff', fontSize: 20, fontWeight: '800', flex: 1 },
  intentDesc: { color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 18 },
  fieldLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 8, fontWeight: '600' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 15,
  },
  mappingBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  mappingLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  mappingValue: { color: '#FFDC00', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  proBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  proBannerText: { flex: 1 },
  proBannerTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  proBannerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 4 },
  jobCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  jobTitle: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 21 },
  jobMeta: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 },
  postJobFab: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 12,
  },
  postJobFabText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  freePill: {
    backgroundColor: 'rgba(138,43,226,0.15)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  freePillText: { color: '#c9a0ff', fontSize: 10, fontWeight: '800' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16, marginTop: 4 },
  backText: { color: '#FFDC00', fontSize: 15, fontWeight: '700' },
  jobDetailTitle: { color: '#fff', fontSize: 22, fontWeight: '800', lineHeight: 28, marginBottom: 8 },
  sectionLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 10,
  },
  lockedBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderStyle: 'dashed',
  },
  lockedLabel: { color: '#FFDC00', fontSize: 14, fontWeight: '800' },
  applyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    gap: 12,
  },
  applyPay: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800' },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  applyBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 15 },
  paywallLogo: {
    color: '#FFDC00',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 4,
    marginTop: 8,
  },
  proBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(200,120,255,0.5)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 8,
    marginBottom: 16,
  },
  proBadgeText: { color: '#d8b4ff', fontSize: 11, fontWeight: '800' },
  paywallHeadline: {
    color: '#d8b4ff',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    marginBottom: 18,
  },
  featureLine: { color: '#fff', fontSize: 15, marginBottom: 10 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  planCardSelected: { borderColor: '#FFDC00', borderWidth: 2 },
  planTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  savePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(138,43,226,0.25)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  savePillText: { color: '#d8b4ff', fontSize: 10, fontWeight: '800' },
  planPriceCol: { alignItems: 'flex-end' },
  planPrice: { color: '#fff', fontSize: 18, fontWeight: '800' },
  planSubPrice: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
  getProBtn: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  getProBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
  },
  legalLink: { color: 'rgba(255,255,255,0.35)', fontSize: 12, textDecorationLine: 'underline' },
  legalDot: { color: 'rgba(255,255,255,0.25)', fontSize: 12 },
  guestSub: {
    color: '#FFDC00',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 24,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0a0a0a',
  },
  footerSpacer: { width: 88 },
  footerPrimary: { flex: 1 },
  secondaryBtn: {
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.45 },
})

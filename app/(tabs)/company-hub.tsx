import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  Briefcase,
  ChevronLeft,
  ClipboardList,
  MessageCircle,
  PlusCircle,
  Receipt,
  Settings2,
  Users,
  Wallet,
  FileText,
} from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { openCreaWebPath } from '@/lib/creaWeb'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'

type ToolRow = {
  label: string
  sub: string
  icon: LucideIcon
  href?: Href
  webPath?: string
  disabled?: boolean
}

const NATIVE_TOOLS: ToolRow[] = [
  {
    label: 'Post a project',
    sub: 'Create a new listing for freelancers to apply.',
    icon: PlusCircle,
    href: '/(tabs)/company-post-job',
  },
  {
    label: 'Projects',
    sub: 'Your listings, search, post — same view as the Projects tab.',
    icon: Briefcase,
    href: '/(tabs)/workspace-projects',
  },
  {
    label: 'Applications',
    sub: 'Pending and recent applicants across your roles.',
    icon: ClipboardList,
    href: '/(tabs)/company-applications',
  },
  {
    label: 'Talent pool',
    sub: 'Browse freelancers on Crea and open public profiles.',
    icon: Users,
    href: '/(tabs)/talent-pool',
  },
  {
    label: 'Invoices',
    sub: 'Review and pay invoices from freelancers you work with.',
    icon: Receipt,
    href: '/(tabs)/invoices',
  },
  {
    label: 'Messages',
    sub: 'Chat with freelancers you work with.',
    icon: MessageCircle,
    href: '/(tabs)/messages',
  },
  {
    label: 'Company settings',
    sub: 'Brand, profile, notifications, account.',
    icon: Settings2,
    href: '/(tabs)/profile',
  },
]

const WEB_TOOLS: ToolRow[] = [
  {
    label: 'Contracts',
    sub: 'Generate and export production agreements on the web.',
    icon: FileText,
    webPath: '/resources',
  },
  {
    label: 'Crea Pay',
    sub: 'Pay crew invoices and track milestone releases.',
    icon: Wallet,
    webPath: '/company-dashboard/payments',
  },
]

export default function CompanyHubScreen() {
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [tools, setTools] = useState<ToolRow[]>(NATIVE_TOOLS)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) {
            setAllowed(false)
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
          setTools([...NATIVE_TOOLS, ...WEB_TOOLS])
        }
      })()
      return () => {
        cancelled = true
      }
    }, [router])
  )

  if (allowed === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading…</Text>
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
          <Text style={styles.blockSub}>Switch to a company account to use hiring tools for the public job board.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Dashboard</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>COMPANY TOOLS</Text>
        <Text style={styles.title}>Hiring workspace</Text>
        <Text style={styles.sub}>
          Post projects, review applications, track incoming invoices, and keep your company profile up to date.
        </Text>

        {tools.map((t) => {
          const Icon = t.icon
          return (
            <TouchableOpacity
              key={t.label}
              style={[styles.card, t.disabled && styles.cardDisabled]}
              activeOpacity={0.75}
              disabled={t.disabled}
              onPress={() => {
                if (t.disabled) {
                  Alert.alert(
                    'Business plan required',
                    'This tool requires a Business or Enterprise plan on creaservices.de.'
                  )
                  return
                }
                if (t.href) {
                  router.push(t.href)
                  return
                }
                if (t.webPath) {
                  void openCreaWebPath(t.webPath).then((ok) => {
                    if (!ok) {
                      Alert.alert(
                        'Open on web',
                        'Set EXPO_PUBLIC_CREA_WEB_URL or open creaservices.de in your browser.'
                      )
                    }
                  })
                }
              }}
            >
              <View style={styles.iconWrap}>
                <Icon size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t.label}</Text>
                <Text style={styles.cardSub}>{t.sub}</Text>
              </View>
            </TouchableOpacity>
          )
        })}
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
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: { fontSize: 26, fontWeight: '900', color: '#ffffff', marginBottom: 8 },
  sub: { fontSize: 14, color: 'rgba(255,255,255,0.38)', lineHeight: 20, marginBottom: 24 },
  cardDisabled: { opacity: 0.45 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: 'rgba(255,255,255,0.92)', marginBottom: 4 },
  cardSub: { fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 18 },
  muted: { color: 'rgba(255,255,255,0.35)', fontSize: 15 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
})

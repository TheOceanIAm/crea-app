import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Image, Linking, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { supabase } from '@/lib/supabase'

type JobPayload = {
  id: string
  title: string
  category: string
  budget_type: string
  budget_amount: number | null
  location_type: string
  description: string | null
  status: string
  company_id: string | null
  company_name: string | null
  company_avatar_url: string | null
}

function budgetLabel(j: JobPayload) {
  if (j.budget_type === 'negotiable') return 'Negotiable'
  if (j.budget_type === 'day_rate') return j.budget_amount ? `€${j.budget_amount}/day` : 'Rate TBD'
  if (j.budget_type === 'fixed')
    return j.budget_amount ? `€${j.budget_amount.toLocaleString('en-US')} fixed` : 'Budget TBD'
  return '—'
}

function companyInitial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

export default function PublicJobShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<JobPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id || typeof id !== 'string') {
        setLoading(false)
        setJob(null)
        return
      }
      const { data, error: rpcError } = await supabase.rpc('job_share_public', { job_id: id })
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        setJob(null)
      } else if (data && typeof data === 'object') {
        setJob(data as JobPayload)
        setError(null)
      } else {
        setJob(null)
        setError(null)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const openApp = () => {
    if (!id || typeof id !== 'string') return
    const deep = `crea://jobs/${id}`
    Linking.openURL(deep).catch(() => {})
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <Text style={styles.brand}>Crea</Text>
          <Text style={styles.title}>Couldn’t load this job</Text>
          <Text style={styles.body}>
            Run <Text style={styles.mono}>supabase/sql/public_share_rpcs.sql</Text> in the Supabase SQL Editor,
            then reload.
          </Text>
          <Text style={styles.muted}>{error}</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (!job) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <Text style={styles.brand}>Crea</Text>
          <Text style={styles.title}>Job not available</Text>
          <Text style={styles.body}>This listing may be closed or the link is invalid.</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  const companyName = (job.company_name || 'Company').trim() || 'Company'
  const logo = job.company_avatar_url?.trim()
  const showLogo = logo && /^https?:\/\//i.test(logo)

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
        <Text style={styles.brand}>Crea</Text>
        <Text style={styles.kicker}>Job listing</Text>

        <View style={styles.companyRow}>
          {showLogo ? (
            <Image source={{ uri: logo }} style={styles.companyLogo} />
          ) : (
            <View style={styles.companyLogoPlaceholder}>
              <Text style={styles.companyLogoLetter}>{companyInitial(companyName)}</Text>
            </View>
          )}
          <View style={styles.companyTextCol}>
            <Text style={styles.companyPosted}>Posted by</Text>
            <Text style={styles.companyName} numberOfLines={2}>
              {companyName}
            </Text>
          </View>
        </View>

        <Text style={styles.jobTitle}>{job.title}</Text>
        <Text style={styles.budget}>{budgetLabel(job)}</Text>
        <Text style={styles.meta}>
          {job.category} · {job.location_type}
        </Text>
        {job.description ? <Text style={styles.description}>{job.description}</Text> : null}

        <TouchableOpacity style={styles.cta} onPress={openApp} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Open in Crea</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Get the app to apply and manage jobs.</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  scrollPad: { paddingHorizontal: 24, paddingBottom: 40, maxWidth: 560, alignSelf: 'center', width: '100%' },
  brand: { fontSize: 22, fontWeight: '900', color: '#FFDC00', letterSpacing: 1, marginBottom: 20 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 2,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  title: { fontSize: 22, fontWeight: '800', color: '#ffffff', marginBottom: 12 },
  body: { fontSize: 15, color: 'rgba(255,255,255,0.7)', lineHeight: 22, marginBottom: 12 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  mono: { fontFamily: 'monospace', fontSize: 13, color: '#FFDC00' },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  companyLogo: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#1a1a1a' },
  companyLogoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyLogoLetter: { fontSize: 18, fontWeight: '800', color: '#FFDC00' },
  companyTextCol: { flex: 1 },
  companyPosted: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  companyName: { fontSize: 17, fontWeight: '800', color: 'rgba(255,255,255,0.9)' },
  jobTitle: { fontSize: 26, fontWeight: '900', color: '#ffffff', lineHeight: 32 },
  budget: { fontSize: 20, fontWeight: '800', color: '#FFDC00', marginTop: 12 },
  meta: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 8 },
  description: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 22,
    marginTop: 20,
  },
  cta: {
    marginTop: 28,
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  hint: { marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
})

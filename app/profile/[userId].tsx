import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
  Linking,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { CeoPublicProfileView } from '@/components/CeoPublicProfileView'
import { supabase } from '@/lib/supabase'
import { isCeoProfile } from '@/lib/profileRole'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'
import { parsePublicProfileWidgets } from '@/lib/publicProfileWidgets'

type ProfilePayload = {
  id: string
  name: string
  role: string
  headline: string
  location: string
  bio: string
  avatar_url: string | null
  skills: unknown
  equipment: unknown
  portfolio_website: string | null
  portfolio_instagram: string | null
  portfolio_linkedin: string | null
  portfolio_vimeo: string | null
  portfolio_behance: string | null
  portfolio_projects: unknown
  public_profile_widgets?: unknown
}

function normalizeExternalUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`
  return `https://${t.replace(/^\/+/, '')}`
}

export default function PublicProfileShareScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfilePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!userId || typeof userId !== 'string') {
        setLoading(false)
        setProfile(null)
        return
      }
      const { data, error: rpcError } = await supabase.rpc('profile_share_public', {
        profile_id: userId,
      })
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        setProfile(null)
      } else if (data && typeof data === 'object') {
        setProfile(data as ProfilePayload)
        setError(null)
      } else {
        setProfile(null)
        setError(null)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  const projects = useMemo(
    () => (profile ? parsePortfolioProjects(profile.portfolio_projects) : []),
    [profile]
  )

  const skills = useMemo(() => (Array.isArray(profile?.skills) ? profile!.skills as string[] : []), [profile])
  const websiteUrl = profile?.portfolio_website ? normalizeExternalUrl(profile.portfolio_website) : null

  const openApp = () => {
    if (!userId || typeof userId !== 'string') return
    Linking.openURL(`crea://profile/${userId}`).catch(() => {})
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
          <Text style={styles.title}>Couldn’t load this profile</Text>
          <Text style={styles.body}>
            Run <Text style={styles.mono}>supabase/sql/public_share_rpcs.sql</Text> in the Supabase SQL Editor,
            then reload.
          </Text>
          <Text style={styles.muted}>{error}</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <Text style={styles.brand}>Crea</Text>
          <Text style={styles.title}>Profile not found</Text>
          <Text style={styles.body}>This user may not exist or the link is invalid.</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  const name = profile.name.trim() || 'Crea member'
  const avatarUri = profile.avatar_url?.trim() ?? ''
  const ceo = isCeoProfile(profile.role)
  const widgets = parsePublicProfileWidgets(profile.public_profile_widgets)

  if (ceo) {
    return (
      <SafeAreaView style={styles.ceoSafe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.ceoScrollPad} showsVerticalScrollIndicator={false}>
          <Text style={styles.ceoBrand}>Crea</Text>
          <Text style={styles.ceoKicker}>Public CEO profile</Text>
          <CeoPublicProfileView
            name={name}
            headline={profile.headline}
            location={profile.location}
            bio={profile.bio}
            avatarUrl={avatarUri}
            widgets={widgets}
          />
          <TouchableOpacity style={styles.cta} onPress={openApp} activeOpacity={0.85}>
            <Text style={styles.ctaText}>Open in Crea</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>The Crea team may reach out to you from the app.</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  const showImage = /^https?:\/\//i.test(avatarUri)
  const letter = name.charAt(0).toUpperCase() || '?'
  const roleLabel = profile.role === 'company' ? 'Company' : 'Freelancer'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
        <Text style={styles.brand}>Crea</Text>
        <Text style={styles.kicker}>Public profile</Text>

        <View style={styles.heroCard}>
          {showImage ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarLetter}>{letter}</Text>
            </View>
          )}
          <Text style={styles.name}>{name}</Text>
          {profile.headline.trim() ? <Text style={styles.headline}>{profile.headline.trim()}</Text> : null}
          {profile.location.trim() ? <Text style={styles.location}>{profile.location.trim()}</Text> : null}
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>{roleLabel}</Text>
          </View>
        </View>

        {profile.bio.trim() ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>About</Text>
            <Text style={styles.bio}>{profile.bio.trim()}</Text>
          </View>
        ) : null}

        {skills.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Skills</Text>
            <View style={styles.chipRow}>
              {skills.map((s) => (
                <View key={s} style={styles.chip}>
                  <Text style={styles.chipText}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {websiteUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(websiteUrl).catch(() => {})}>
            <Text style={styles.link}>Website →</Text>
          </TouchableOpacity>
        ) : null}

        {projects.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Portfolio</Text>
            {projects.map((proj: PortfolioProject, i: number) => (
              <View key={`${proj.title}-${i}`} style={styles.projectCard}>
                <Text style={styles.projectTitle}>{proj.title}</Text>
                {proj.client.trim() ? <Text style={styles.projectClient}>{proj.client.trim()}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        <TouchableOpacity style={styles.cta} onPress={openApp} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Open in Crea</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Connect and hire on the Crea app.</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  ceoSafe: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  scrollPad: { paddingHorizontal: 24, paddingBottom: 40, maxWidth: 560, alignSelf: 'center', width: '100%' },
  ceoScrollPad: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  ceoBrand: { fontSize: 22, fontWeight: '900', color: '#FFDC00', letterSpacing: 1, marginBottom: 10 },
  ceoKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 2,
    marginBottom: 24,
    textTransform: 'uppercase',
  },
  brand: { fontSize: 22, fontWeight: '900', color: '#FFDC00', letterSpacing: 1, marginBottom: 16 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 2,
    marginBottom: 20,
    textTransform: 'uppercase',
  },
  title: { fontSize: 22, fontWeight: '800', color: '#ffffff', marginBottom: 12 },
  body: { fontSize: 15, color: 'rgba(255,255,255,0.7)', lineHeight: 22, marginBottom: 12 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  mono: { fontFamily: 'monospace', fontSize: 13, color: '#FFDC00' },
  heroCard: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  avatar: { width: 96, height: 96, borderRadius: 48, marginBottom: 14, backgroundColor: '#222' },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFDC00',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarLetter: { fontSize: 40, fontWeight: '900', color: '#0a0a0a' },
  name: { fontSize: 24, fontWeight: '900', color: '#ffffff', textAlign: 'center' },
  headline: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },
  location: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8, textAlign: 'center' },
  rolePill: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  rolePillText: { fontSize: 10, fontWeight: '800', color: '#FFDC00', letterSpacing: 1 },
  block: { marginBottom: 22 },
  blockTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  bio: { fontSize: 15, color: 'rgba(255,255,255,0.82)', lineHeight: 24 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111',
  },
  chipText: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  link: { fontSize: 15, fontWeight: '600', color: '#FFDC00', marginBottom: 16 },
  projectCard: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  projectTitle: { fontSize: 16, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  projectClient: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  cta: {
    marginTop: 8,
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  hint: { marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
})

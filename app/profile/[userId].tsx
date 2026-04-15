import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Share2 } from 'lucide-react-native'
import { CeoPublicProfileView } from '@/components/CeoPublicProfileView'
import { FreelancerPublicProfileContent } from '@/components/profile/FreelancerPublicProfileContent'
import { supabase } from '@/lib/supabase'
import { loadPublicProfile } from '@/lib/loadPublicProfile'
import { firstRouteParam } from '@/lib/routeParams'
import { ICON_STROKE } from '@/lib/iconTheme'
import type { FreelancerPublicProfilePayload } from '@/lib/freelancerPublicProfileTypes'
import { isCeoProfile, isFreelancerProfile } from '@/lib/profileRole'
import { parsePublicProfileWidgets } from '@/lib/publicProfileWidgets'

function strTrim(v: string | null | undefined): string {
  if (v == null) return ''
  return typeof v === 'string' ? v.trim() : ''
}

export default function PublicProfileShareScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ userId: string | string[] }>()
  const userId = useMemo(() => firstRouteParam(params.userId), [params.userId])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<FreelancerPublicProfilePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setAuthUserId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!userId) {
        setLoading(false)
        setProfile(null)
        return
      }
      setLoading(true)
      const { profile: next, error: loadErr } = await loadPublicProfile(userId)
      if (cancelled) return
      if (loadErr) {
        setError(loadErr)
        setProfile(null)
      } else if (next) {
        setProfile(next)
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

  const name = strTrim(profile.name) || 'Crea member'
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
        </ScrollView>
      </SafeAreaView>
    )
  }

  const roleKind = isFreelancerProfile(profile.role) ? 'freelancer' : 'company'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageScrollContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={Platform.OS !== 'web'}
      >
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareIconBtn}
            onPress={() => setShareOpen(true)}
            hitSlop={12}
            accessibilityLabel="Share profile"
          >
            <Share2 size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>

        <FreelancerPublicProfileContent
          profile={profile}
          userId={userId}
          authUserId={authUserId}
          roleKind={roleKind}
          shareModalOpen={shareOpen}
          onShareModalOpenChange={setShareOpen}
          scrollMode="none"
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  pageScroll: { flex: 1 },
  pageScrollContent: { flexGrow: 1, paddingBottom: 24 },
  ceoSafe: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 16, fontWeight: '600', color: '#FFDC00' },
  shareIconBtn: { padding: 4 },
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
  title: { fontSize: 22, fontWeight: '800', color: '#ffffff', marginBottom: 12 },
  body: { fontSize: 15, color: 'rgba(255,255,255,0.7)', lineHeight: 22, marginBottom: 12 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  mono: { fontFamily: 'monospace', fontSize: 13, color: '#FFDC00' },
})

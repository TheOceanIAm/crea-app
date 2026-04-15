import { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { router } from 'expo-router'
import { ChevronLeft, Eye, Share2 } from 'lucide-react-native'
import { CeoPublicProfileView } from '@/components/CeoPublicProfileView'
import { FreelancerPublicProfileContent } from '@/components/profile/FreelancerPublicProfileContent'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { supabase } from '@/lib/supabase'
import { loadPublicProfile } from '@/lib/loadPublicProfile'
import type { FreelancerPublicProfilePayload } from '@/lib/freelancerPublicProfileTypes'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isCeoProfile, isFreelancerProfile } from '@/lib/profileRole'
import { parsePublicProfileWidgets } from '@/lib/publicProfileWidgets'
import { profileShareUrl } from '@/lib/shareLinks'

const TAB_BAR_HEIGHT = 80

export default function ProfilePreviewScreen() {
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState<FreelancerPublicProfilePayload | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setAuthUserId(null)
      setLoading(false)
      router.replace('/login')
      return
    }
    setAuthUserId(user.id)

    const { profile, error } = await loadPublicProfile(user.id)

    if (error || !profile) {
      setPayload(null)
      setLoading(false)
      return
    }

    setPayload(profile)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const profilePublicUrl = useMemo(() => (authUserId ? profileShareUrl(authUserId) : null), [authUserId])
  const profileCardMessage = useMemo(
    () => `${(payload?.name || '').trim() || 'My Crea profile'} — view my profile on Crea`,
    [payload?.name]
  )

  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 24

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!payload || !authUserId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Profile not loaded</Text>
          <Text style={styles.emptySub}>
            Check settings or run <Text style={styles.mono}>public_share_rpcs.sql</Text> in Supabase.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  const ceo = isCeoProfile(payload.role)
  const freelancer = isFreelancerProfile(payload.role)
  const name = (payload.name ?? '').trim() || 'Crea'
  const avatarUri = (payload.avatar_url ?? '').trim()

  const topBar = (
    <View style={styles.topBar}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <View style={styles.topBarRight}>
        <TouchableOpacity
          style={styles.shareIconBtn}
          onPress={() => setShareOpen(true)}
          hitSlop={12}
          accessibilityLabel="Share profile"
        >
          <Share2 size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
        <View style={styles.previewBadge}>
          <Eye size={14} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.previewBadgeText}>Preview</Text>
        </View>
      </View>
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {ceo ? (
        <>
          {topBar}
          <ShareSheetModal
            visible={shareOpen}
            onClose={() => setShareOpen(false)}
            sheetTitle="Share profile"
            shareMessage={profileCardMessage}
            shareUrl={profilePublicUrl}
            mailSubject={`Crea profile: ${name}`}
          />
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.ceoScrollContent, { paddingBottom: bottomPad }]}
            showsVerticalScrollIndicator={Platform.OS !== 'web'}
            nestedScrollEnabled
          >
            <View style={styles.banner}>
              <Text style={styles.bannerTitle}>Public CEO profile</Text>
              <Text style={styles.bannerSub}>
                This is how your public CEO page looks to visitors. Direct messages to you stay one-way: you can message
                users from the app; they cannot start a chat with you.
              </Text>
            </View>
            <CeoPublicProfileView
              name={name}
              headline={payload.headline}
              location={payload.location}
              bio={payload.bio}
              avatarUrl={avatarUri}
              widgets={parsePublicProfileWidgets(payload.public_profile_widgets)}
            />
          </ScrollView>
        </>
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={Platform.OS !== 'web'}
        >
          {topBar}
          <FreelancerPublicProfileContent
            profile={payload}
            userId={authUserId}
            authUserId={authUserId}
            roleKind={freelancer ? 'freelancer' : 'company'}
            previewMode
            contentBottomPad={0}
            shareModalOpen={shareOpen}
            onShareModalOpenChange={setShareOpen}
            scrollMode="none"
          />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 8 },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  previewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    backgroundColor: 'rgba(255,220,0,0.08)',
  },
  previewBadgeText: { color: '#FFDC00', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shareIconBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  banner: { marginBottom: 20, paddingHorizontal: 20 },
  bannerTitle: { fontSize: 11, fontWeight: '800', color: '#FFDC00', letterSpacing: 2, marginBottom: 6 },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.38)', lineHeight: 19 },
  ceoScrollContent: { paddingHorizontal: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  emptySub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#FFDC00' },
})

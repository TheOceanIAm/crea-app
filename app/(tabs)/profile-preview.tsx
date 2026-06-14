import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useFocusEffect } from '@react-navigation/native'
import { router } from 'expo-router'
import { ChevronLeft, Share2 } from 'lucide-react-native'
import { CeoPublicProfileView } from '@/components/CeoPublicProfileView'
import { FreelancerPublicProfileContent } from '@/components/profile/FreelancerPublicProfileContent'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { loadPublicProfile } from '@/lib/loadPublicProfile'
import { postSyncFreelancerProfileToWeb } from '@/lib/syncFreelancerProfileApi'
import { mirrorProfilesToFreelancerProfiles } from '@/lib/syncFreelancerProfileToWeb'
import type { FreelancerPublicProfilePayload } from '@/lib/freelancerPublicProfileTypes'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isCeoProfile, isFreelancerProfile } from '@/lib/profileRole'
import { parsePublicProfileWidgets } from '@/lib/publicProfileWidgets'
import type { PublicProfileWidgets } from '@/lib/publicProfileWidgets'
import { loadLiveCeoWidgets } from '@/lib/ceoLiveWidgets'
import { profileShareUrl } from '@/lib/shareLinks'

import { useFloatingTabBarBottomInset } from '@/lib/floatingTabBarLayout'
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout'

export default function ProfilePreviewScreen() {
  const tabBarInset = useFloatingTabBarBottomInset()
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState<FreelancerPublicProfilePayload | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [liveWidgets, setLiveWidgets] = useState<PublicProfileWidgets | null>(null)

  const load = useCallback(async () => {
    const user = await getAuthUser()
    if (!user) {
      setAuthUserId(null)
      setLoading(false)
      router.replace('/login')
      return
    }
    setAuthUserId(user.id)

    const sync = await postSyncFreelancerProfileToWeb()
    if (!sync.ok) {
      await mirrorProfilesToFreelancerProfiles(user.id)
    }

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

  const widgetsBase = useMemo(
    () => parsePublicProfileWidgets(payload?.public_profile_widgets),
    [payload?.public_profile_widgets]
  )
  const widgets = liveWidgets ?? widgetsBase

  useEffect(() => {
    let cancelled = false
    if (!payload || !isCeoProfile(payload.role)) {
      setLiveWidgets(null)
      return
    }
    void (async () => {
      const next = await loadLiveCeoWidgets(widgetsBase)
      if (!cancelled) setLiveWidgets(next)
    })()
    return () => {
      cancelled = true
    }
  }, [payload, widgetsBase])

  const profilePublicUrl = useMemo(() => (authUserId ? profileShareUrl(authUserId) : null), [authUserId])
  const profileCardMessage = useMemo(
    () => `${(payload?.name || '').trim() || 'My Crea profile'} — view my profile on Crea`,
    [payload?.name]
  )

  const bottomPad = tabBarInset + 24
  const { contentMaxWidth, horizontalPadding, isTablet } = useResponsiveLayout('wide')
  const topBarStyle = [
    styles.topBar,
    contentMaxWidth != null ? { maxWidth: contentMaxWidth, alignSelf: 'center' as const, width: '100%' as const } : null,
    isTablet ? { paddingHorizontal: horizontalPadding, paddingBottom: 32 } : null,
  ]

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
    <View style={topBarStyle}>
      <TouchableOpacity style={styles.topBarSide} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#fff" strokeWidth={ICON_STROKE} />
      </TouchableOpacity>
      <Text style={styles.topBarTitle} numberOfLines={1}>
        {name}
      </Text>
      <View style={[styles.topBarSide, styles.topBarSideRight]}>
        <TouchableOpacity
          style={styles.shareIconBtn}
          onPress={() => setShareOpen(true)}
          hitSlop={12}
          accessibilityLabel="Share profile"
        >
          <Share2 size={22} color="#fff" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
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
              widgets={widgets}
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
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  topBarSide: { width: 40, alignItems: 'flex-start', justifyContent: 'center' },
  topBarSideRight: { alignItems: 'flex-end' },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 8,
  },
  shareIconBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  banner: { marginBottom: 20, paddingHorizontal: 20 },
  bannerTitle: { fontSize: 11, fontWeight: '800', color: '#FFDC00', letterSpacing: 2, marginBottom: 6 },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.38)', lineHeight: 19 },
  ceoScrollContent: { paddingHorizontal: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  emptySub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#FFDC00' },
})

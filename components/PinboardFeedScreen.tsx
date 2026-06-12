import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { ChevronDown, X } from 'lucide-react-native'
import { getAuthUser } from '@/lib/getAuthUser'
import { supabase } from '@/lib/supabase'
import { getCache, setCache, deleteCache } from '@/lib/appCache'
import { isCompanyProfile, isFreelancerProfile } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { CreaFeedPostSkeleton, CreaInlineLoader } from '@/components/CreaLoading'
import { PlatformTrialBanners } from '@/components/PlatformTrialBanners'
import { TabScreenHeader } from '@/components/TabScreenHeader'
import { useFloatingTabBarBottomInset } from '@/lib/floatingTabBarLayout'
import {
  canFreelancerCreatePrivateProjects,
  freelancerCanPostJobs,
} from '@/lib/freelancerPlan'
import { useDashboardOverview } from '@/hooks/useDashboardOverview'
import {
  canComposePinboardUpdates,
  canModeratePinboardPost,
  createPinboardPost,
  deletePinboardPost,
  formatPinboardAttachOptionLabel,
  formatPinboardTimeAgo,
  loadPinboardAttachOptions,
  loadPinboardFeedPage,
  parsePinboardAttachKey,
  pinboardPostHasLink,
  pinboardPostLinkKindLabel,
  pinboardPostLinkLabel,
  PINBOARD_NO_ATTACH,
  PINBOARD_UPDATES_COPY,
  pinboardCacheKey,
  readCachedPinboardFeed,
  validatePinboardUpdateInput,
  type PinboardAttachOption,
  type PinboardFeedCache,
  type PinboardPost,
} from '@/lib/pinboardFeed'
import {
  consumeWarmedPinboard,
  peekWarmedOverview,
  peekWarmedPinboard,
  peekWarmedPinboardFetchedAt,
  peekWarmedPinboardUserId,
} from '@/lib/warmAppCaches'
import { prefetchSecondaryTabsIdle } from '@/lib/prefetchSecondaryTabs'
import type { Href } from 'expo-router'

const FEED_STALE_MS = 30_000

function readInitialFeed(): { posts: PinboardPost[]; loading: boolean; fetchedAt: number } {
  const warmedUid = peekWarmedPinboardUserId()
  if (warmedUid) {
    return {
      posts: peekWarmedPinboard() ?? [],
      loading: false,
      fetchedAt: peekWarmedPinboardFetchedAt(),
    }
  }

  const overview = peekWarmedOverview()
  if (overview) {
    const cached = readCachedPinboardFeed(overview.userId)
    if (cached) {
      return { posts: cached, loading: false, fetchedAt: Date.now() }
    }
  }

  return { posts: [], loading: true, fetchedAt: 0 }
}

export function PinboardFeedScreen() {
  const router = useRouter()
  const tabBarInset = useFloatingTabBarBottomInset()
  const bootFeed = useRef(readInitialFeed()).current
  const { overview, refresh: refreshOverview } = useDashboardOverview()
  const userId = overview?.userId ?? null
  const role = overview?.role ?? null
  const avatarUrl = overview?.avatarUrl ?? null
  const displayName = overview?.name?.trim() || 'You'
  const [posts, setPosts] = useState<PinboardPost[]>(bootFeed.posts)
  const [loading, setLoading] = useState(bootFeed.loading)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const [composerOpen, setComposerOpen] = useState(false)
  const [composeBody, setComposeBody] = useState('')
  const [composeAttachKey, setComposeAttachKey] = useState(PINBOARD_NO_ATTACH)
  const [composeSubmitting, setComposeSubmitting] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [attachOptions, setAttachOptions] = useState<PinboardAttachOption[]>([])
  const [attachLoading, setAttachLoading] = useState(false)
  const [attachPickerOpen, setAttachPickerOpen] = useState(false)

  const initialDone = useRef(!bootFeed.loading)
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef(bootFeed.fetchedAt)

  useEffect(() => {
    if (!userId) return
    prefetchSecondaryTabsIdle(userId, role)
  }, [userId, role])

  useEffect(() => {
    if (!userId || initialDone.current) return

    const warmed = consumeWarmedPinboard(userId)
    if (warmed !== null) {
      setPosts(warmed)
      setLoading(false)
      initialDone.current = true
      return
    }

    const cached = getCache<PinboardFeedCache>(pinboardCacheKey(userId))
    if (cached) {
      setPosts(cached.posts)
      setLoading(false)
    }
  }, [userId])

  const refreshFeed = useCallback(async (opts?: { silent?: boolean }) => {
    if (refreshInFlight.current) return refreshInFlight.current
    refreshInFlight.current = (async () => {
      try {
        if (!opts?.silent) setLoadError(null)
        const user = await getAuthUser()
        if (!user) {
          router.replace('/login')
          return
        }
        const cacheKey = pinboardCacheKey(user.id)
        const cached = getCache<PinboardFeedCache>(cacheKey)

        if (!initialDone.current && cached) {
          setPosts(cached.posts)
          setLoading(false)
          initialDone.current = true
        }

        const { posts: next, error } = await loadPinboardFeedPage()
        if (error) {
          if (!cached) {
            setLoadError(error)
            if (!initialDone.current) setPosts([])
          }
        } else {
          setLoadError(null)
          setPosts(next)
          setHasMore(next.length >= 25)
          setCache(cacheKey, { posts: next }, 25_000)
          lastFetchedAt.current = Date.now()
        }
      } finally {
        if (!initialDone.current) {
          initialDone.current = true
          setLoading(false)
        }
      }
    })()
    try {
      await refreshInFlight.current
    } finally {
      refreshInFlight.current = null
    }
  }, [router])

  useFocusEffect(
    useCallback(() => {
      if (!initialDone.current) {
        void refreshFeed()
        return
      }
      if (lastFetchedAt.current > 0 && Date.now() - lastFetchedAt.current < FEED_STALE_MS) {
        return
      }
      void refreshFeed({ silent: true })
    }, [refreshFeed])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    if (userId) deleteCache(pinboardCacheKey(userId))
    await Promise.all([refreshFeed({ silent: true }), refreshOverview({ bustCache: true })])
    setRefreshing(false)
  }, [refreshFeed, refreshOverview, userId])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts.length === 0) return
    const last = posts[posts.length - 1]
    setLoadingMore(true)
    const { posts: more, error } = await loadPinboardFeedPage({
      beforeCreatedAt: last.created_at,
    })
    setLoadingMore(false)
    if (error || more.length === 0) {
      setHasMore(false)
      return
    }
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id))
      const merged = [...prev]
      for (const p of more) {
        if (!seen.has(p.id)) merged.push(p)
      }
      if (userId) setCache(pinboardCacheKey(userId), { posts: merged }, 25_000)
      return merged
    })
    setHasMore(more.length >= 25)
  }, [hasMore, loadingMore, posts, userId])

  const freelancerPlan = overview?.freelancerPlan ?? 'free'
  const canCompose = canComposePinboardUpdates({ role, freelancerPlan })
  const canPostJobs =
    isCompanyProfile(role ?? undefined) ||
    (isFreelancerProfile(role ?? undefined) && freelancerCanPostJobs(freelancerPlan))

  useEffect(() => {
    if (!userId || !canCompose) {
      setAttachOptions([])
      return
    }
    let cancelled = false
    void (async () => {
      setAttachLoading(true)
      const options = await loadPinboardAttachOptions(userId)
      if (!cancelled) {
        setAttachOptions(options)
        setAttachLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, canCompose])

  const openComposer = useCallback(async () => {
    if (!userId || !canCompose) return
    setComposeError(null)
    setComposeBody('')
    setAttachPickerOpen(false)
    setComposerOpen(true)
    setAttachLoading(true)
    const options = await loadPinboardAttachOptions(userId)
    setAttachOptions(options)
    setComposeAttachKey(options[0]?.key ?? PINBOARD_NO_ATTACH)
    setAttachLoading(false)
  }, [canCompose, userId])

  const submitPost = useCallback(async () => {
    if (!userId) return
    setComposeError(null)
    const parsed = parsePinboardAttachKey(composeAttachKey)
    const jobId = parsed?.kind === 'job' ? parsed.id : null
    const projectId = parsed?.kind === 'project' ? parsed.id : null
    const validation = validatePinboardUpdateInput({
      body: composeBody,
      jobId,
      projectId,
    })
    if (!validation.ok) {
      setComposeError(validation.error)
      return
    }
    setComposeSubmitting(true)
    const result = await createPinboardPost({
      userId,
      body: composeBody,
      jobId,
      projectId,
    })
    setComposeSubmitting(false)
    if (!result.ok) {
      setComposeError(result.error)
      return
    }
    setComposerOpen(false)
    deleteCache(pinboardCacheKey(userId))
    await refreshFeed({ silent: true })
  }, [composeAttachKey, composeBody, refreshFeed, userId])

  const onDeletePost = useCallback(
    (post: PinboardPost) => {
      Alert.alert('Remove post?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await deletePinboardPost(post.id)
              if (!result.ok) {
                Alert.alert('Could not remove', result.error)
                return
              }
              if (userId) deleteCache(pinboardCacheKey(userId))
              setPosts((prev) => prev.filter((p) => p.id !== post.id))
            })()
          },
        },
      ])
    },
    [userId]
  )

  const avatarLetter = displayName.charAt(0).toUpperCase() || '?'

  const openPostLink = useCallback(
    (p: PinboardPost) => {
      if (p.project_id) {
        router.push(`/project/${p.project_id}` as Href)
        return
      }
      if (p.job_id) {
        if (p.job_is_solo_workspace) {
          router.push(`/project/${p.job_id}` as Href)
        } else {
          router.push(`/(tabs)/jobs/${p.job_id}` as const)
        }
      }
    },
    [router]
  )

  const renderPost = useCallback(
    ({ item: p }: { item: PinboardPost }) => {
      const linkLabel = pinboardPostLinkLabel(p)
      const hasLink = pinboardPostHasLink(p)
      const kindLabel = pinboardPostLinkKindLabel(p)
      const canMod = canModeratePinboardPost(p, userId)
      return (
        <View style={styles.postCard}>
          <View style={styles.postRow}>
            <View style={styles.postAvatar}>
              {p.author_avatar_url ? (
                <Image source={{ uri: p.author_avatar_url }} style={styles.postAvatarImg} />
              ) : (
                <Text style={styles.postAvatarLetter}>{p.author_name.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.postBodyCol}>
              <View style={styles.postMetaRow}>
                <Text style={styles.postAuthor} numberOfLines={1}>
                  {p.author_name}
                </Text>
                <Text style={styles.postTime}>{formatPinboardTimeAgo(p.created_at)}</Text>
              </View>
              {kindLabel ? (
                <Text style={styles.postKind}>{kindLabel}</Text>
              ) : null}
              {hasLink ? (
                <TouchableOpacity onPress={() => openPostLink(p)} activeOpacity={0.7}>
                  <Text style={styles.postJobLink} numberOfLines={1}>
                    {linkLabel} →
                  </Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.postText}>{p.body}</Text>
              {canMod ? (
                <TouchableOpacity onPress={() => onDeletePost(p)} hitSlop={8}>
                  <Text style={styles.postRemove}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      )
    },
    [onDeletePost, openPostLink, userId]
  )

  const hasAttachOptions = attachOptions.length > 0
  const canSubmit =
    composeAttachKey !== PINBOARD_NO_ATTACH &&
    composeBody.trim().length > 0 &&
    !composeSubmitting

  const listHeader = (
    <>
      {overview ? (
        <PlatformTrialBanners
          role={overview.role}
          trialEndsAt={overview.trialEndsAt}
          accountCreatedAt={overview.accountCreatedAt}
          hasStripeCustomer={overview.hasStripeCustomer}
        />
      ) : null}
      <Text style={styles.sectionSubtitle}>{PINBOARD_UPDATES_COPY.sectionSubtitle}</Text>
      {!canCompose ? (
        <View style={styles.blockedCard}>
          <Text style={styles.blockedText}>{PINBOARD_UPDATES_COPY.starterBlocked}</Text>
        </View>
      ) : !hasAttachOptions && !attachLoading && userId ? (
        <View style={styles.blockedCard}>
          <Text style={styles.noLinkTitle}>{PINBOARD_UPDATES_COPY.noLinkOptionsTitle}</Text>
          <Text style={styles.blockedText}>{PINBOARD_UPDATES_COPY.noLinkOptionsBody}</Text>
          <View style={styles.ctaRow}>
            {isCompanyProfile(role ?? undefined) ? (
              <TouchableOpacity
                style={styles.ctaPrimary}
                onPress={() => router.push('/(tabs)/company-post-job' as Href)}
              >
                <Text style={styles.ctaPrimaryText}>{PINBOARD_UPDATES_COPY.createListingLabel}</Text>
              </TouchableOpacity>
            ) : canFreelancerCreatePrivateProjects(freelancerPlan) ? (
              <TouchableOpacity
                style={styles.ctaPrimary}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/workspace-projects',
                    params: { create: '1' },
                  } as Href)
                }
              >
                <Text style={styles.ctaPrimaryText}>{PINBOARD_UPDATES_COPY.createProjectLabel}</Text>
              </TouchableOpacity>
            ) : canPostJobs ? (
              <TouchableOpacity
                style={styles.ctaSecondary}
                onPress={() => router.push('/(tabs)/jobs' as Href)}
              >
                <Text style={styles.ctaSecondaryText}>Browse job pool</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.composerCard}>
          <TouchableOpacity
            style={styles.composerAvatar}
            onPress={() => router.push('/(tabs)/profile')}
            accessibilityRole="button"
            accessibilityLabel="Your profile"
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.composerAvatarImg} />
            ) : (
              <Text style={styles.composerAvatarLetter}>{avatarLetter}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.composerField}
            onPress={() => void openComposer()}
            activeOpacity={0.75}
            disabled={!userId || attachLoading}
          >
            <Text style={styles.composerPlaceholder}>{PINBOARD_UPDATES_COPY.composerPlaceholder}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={styles.sectionLabel}>{PINBOARD_UPDATES_COPY.recentLabel}</Text>
    </>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TabScreenHeader
        title="Feed"
        showMessages
        left={
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.topAvatar}
            accessibilityRole="button"
            accessibilityLabel="Profile"
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.topAvatarImg} />
            ) : (
              <Text style={styles.topAvatarLetter}>{avatarLetter}</Text>
            )}
          </TouchableOpacity>
        }
      />

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={renderPost}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabBarInset + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#FFDC00" />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loading && posts.length === 0 ? (
            <CreaFeedPostSkeleton rows={3} />
          ) : loadError ? (
            <Text style={styles.emptyError}>{loadError}</Text>
          ) : (
            <Text style={styles.emptyText}>{PINBOARD_UPDATES_COPY.emptyFeed}</Text>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ marginVertical: 16, alignItems: 'center' }}>
              <CreaInlineLoader size="sm" />
            </View>
          ) : null
        }
      />

      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{PINBOARD_UPDATES_COPY.composerModalTitle}</Text>
              <TouchableOpacity
                onPress={() => !composeSubmitting && setComposerOpen(false)}
                hitSlop={12}
                accessibilityLabel="Close"
              >
                <X size={24} color="rgba(255,255,255,0.5)" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            </View>
            <Text style={styles.attachFieldLabel}>{PINBOARD_UPDATES_COPY.attachLabel}</Text>
            {attachLoading ? (
              <View style={{ marginVertical: 8, alignItems: 'flex-start' }}>
                <CreaInlineLoader size="sm" />
              </View>
            ) : (
              <View style={styles.jobAttach}>
                <TouchableOpacity
                  style={styles.jobAttachBtn}
                  onPress={() => setAttachPickerOpen((o) => !o)}
                  disabled={composeSubmitting || attachOptions.length === 0}
                >
                  <Text style={styles.jobAttachLabel} numberOfLines={2}>
                    {composeAttachKey === PINBOARD_NO_ATTACH
                      ? PINBOARD_UPDATES_COPY.attachSelectPlaceholder
                      : (() => {
                          const opt = attachOptions.find((o) => o.key === composeAttachKey)
                          return opt
                            ? formatPinboardAttachOptionLabel(opt.kind, opt.title)
                            : PINBOARD_UPDATES_COPY.attachSelectPlaceholder
                        })()}
                  </Text>
                  <ChevronDown size={18} color="rgba(255,255,255,0.4)" strokeWidth={ICON_STROKE} />
                </TouchableOpacity>
                {attachPickerOpen ? (
                  <View style={styles.jobAttachList}>
                    {attachOptions.map((opt) => (
                      <TouchableOpacity
                        key={opt.key}
                        style={styles.jobAttachItem}
                        onPress={() => {
                          setComposeAttachKey(opt.key)
                          setAttachPickerOpen(false)
                        }}
                      >
                        <Text style={styles.jobAttachItemText} numberOfLines={2}>
                          {formatPinboardAttachOptionLabel(opt.kind, opt.title)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
            <Text style={[styles.attachFieldLabel, { marginTop: 14 }]}>
              Short note
            </Text>
            <TextInput
              value={composeBody}
              onChangeText={setComposeBody}
              placeholder={PINBOARD_UPDATES_COPY.messagePlaceholder}
              placeholderTextColor="rgba(255,255,255,0.28)"
              multiline
              maxLength={6000}
              style={styles.modalInput}
              editable={!composeSubmitting}
            />
            <View style={styles.modalFooter}>
              <Text style={styles.charCount}>{composeBody.trim().length}/6000</Text>
              <TouchableOpacity
                style={[styles.postBtn, !canSubmit && styles.postBtnDisabled]}
                disabled={!canSubmit}
                onPress={() => void submitPost()}
              >
                <Text style={styles.postBtnText}>
                  {composeSubmitting ? 'Posting…' : PINBOARD_UPDATES_COPY.postButton}
                </Text>
              </TouchableOpacity>
            </View>
            {composeError ? <Text style={styles.composeError}>{composeError}</Text> : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  topAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  topAvatarImg: { width: 36, height: 36 },
  topAvatarLetter: { color: '#FFDC00', fontWeight: '800', fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  composerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
  },
  composerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  composerAvatarImg: { width: 44, height: 44 },
  composerAvatarLetter: { color: '#FFDC00', fontWeight: '800', fontSize: 16 },
  composerField: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#0a0a0a',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  composerPlaceholder: { color: 'rgba(255,255,255,0.35)', fontSize: 15 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.28)',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  postCard: {
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#111',
    padding: 14,
  },
  postRow: { flexDirection: 'row', gap: 12 },
  postAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  postAvatarImg: { width: 44, height: 44 },
  postAvatarLetter: { color: '#FFDC00', fontWeight: '800' },
  postBodyCol: { flex: 1, minWidth: 0 },
  postMetaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  postAuthor: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff' },
  postTime: { fontSize: 11, color: 'rgba(255,255,255,0.28)' },
  postKind: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
  },
  postJobLink: { marginTop: 2, fontSize: 12, color: 'rgba(255,220,0,0.75)' },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 14,
  },
  blockedCard: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111',
  },
  noLinkTitle: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  blockedText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.38)',
  },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  ctaPrimary: {
    backgroundColor: '#FFDC00',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  ctaPrimaryText: { fontSize: 12, fontWeight: '800', color: '#0a0a0a' },
  ctaSecondary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  ctaSecondaryText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  attachFieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 8,
  },
  postText: { marginTop: 8, fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.82)' },
  postRemove: {
    marginTop: 10,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
  },
  emptyText: { textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 14, paddingVertical: 32 },
  emptyError: { textAlign: 'center', color: '#f87171', fontSize: 14, paddingVertical: 32 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  modalInput: {
    minHeight: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0a0a0a',
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    color: '#fff',
    textAlignVertical: 'top',
  },
  jobAttach: { marginTop: 12 },
  jobAttachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  jobAttachLabel: { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  jobAttachList: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0a0a0a',
    overflow: 'hidden',
  },
  jobAttachItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  jobAttachItemText: { fontSize: 13, color: '#fff' },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  charCount: { fontSize: 11, color: 'rgba(255,255,255,0.22)' },
  postBtn: {
    backgroundColor: '#FFDC00',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
  },
  postBtnDisabled: { opacity: 0.45 },
  postBtnText: { fontSize: 13, fontWeight: '800', color: '#0a0a0a' },
  composeError: { marginTop: 8, fontSize: 12, color: '#f87171' },
})

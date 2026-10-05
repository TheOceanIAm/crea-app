import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Platform,
  ScrollView,
  Keyboard,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { useInfiniteQuery, useMutation, type InfiniteData } from '@tanstack/react-query'
import { ChevronDown, X } from 'lucide-react-native'
import { getAuthUser } from '@/lib/getAuthUser'
import { queryClient } from '@/lib/queryClient'
import { setCache, deleteCache } from '@/lib/appCache'
import { isCeoUserId } from '@/lib/ceo'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'
import { CreaFeedPostSkeleton, CreaInlineLoader } from '@/components/CreaLoading'
import { ResponsiveScreen } from '@/components/ResponsiveScreen'
import { PlatformTrialBanners } from '@/components/PlatformTrialBanners'
import { TabScreenHeader } from '@/components/TabScreenHeader'
import { JobListingCard } from '@/components/JobListingCard'
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
  hydratePinboardFeedFromDisk,
  loadPinboardAttachOptions,
  loadPinboardFeedPage,
  loadPublishedExternalJobsForPinboard,
  parsePinboardAttachKey,
  pinboardPostHasLink,
  pinboardPostLinkKindLabel,
  pinboardPostLinkLabel,
  suggestedExternalJobUpdateNote,
  PINBOARD_NO_ATTACH,
  PINBOARD_PAGE_SIZE,
  PINBOARD_UPDATES_COPY,
  pinboardCacheKey,
  readCachedPinboardFeed,
  validatePinboardUpdateInput,
  type PinboardAttachOption,
  type PinboardPost,
} from '@/lib/pinboardFeed'
import {
  consumeWarmedPinboard,
  peekWarmedPinboard,
  peekWarmedPinboardUserId,
} from '@/lib/warmAppCaches'
import { prefetchSecondaryTabsIdle } from '@/lib/prefetchSecondaryTabs'
import type { Href } from 'expo-router'

const FEED_STALE_MS = 30_000

const feedKey = (userId: string | null) => ['pinboardFeed', userId ?? 'anon'] as const

/** Seed the first page synchronously from the warm handoff / mem cache for instant paint. */
function readInitialFeedPages(userId: string): InfiniteData<PinboardPost[]> | undefined {
  if (peekWarmedPinboardUserId() === userId) {
    const warmed = peekWarmedPinboard()
    if (warmed) return { pages: [warmed], pageParams: [undefined] }
  }
  const cached = readCachedPinboardFeed(userId)
  if (cached) return { pages: [cached], pageParams: [undefined] }
  return undefined
}

export function PinboardFeedScreen() {
  const router = useRouter()
  const tabBarInset = useFloatingTabBarBottomInset()
  const { height: windowHeight } = useWindowDimensions()
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const { overview, refresh: refreshOverview } = useDashboardOverview()
  const userId = overview?.userId ?? null
  const role = overview?.role ?? null
  const avatarUrl = overview?.avatarUrl ?? null
  const displayName = overview?.name?.trim() || 'You'

  const [refreshing, setRefreshing] = useState(false)

  const [composerOpen, setComposerOpen] = useState(false)
  const [composeBody, setComposeBody] = useState('')
  const [composeAttachKey, setComposeAttachKey] = useState(PINBOARD_NO_ATTACH)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [attachOptions, setAttachOptions] = useState<PinboardAttachOption[]>([])
  const [attachLoading, setAttachLoading] = useState(false)
  const [attachPickerOpen, setAttachPickerOpen] = useState(false)
  const [externalSearch, setExternalSearch] = useState('')
  const lastSuggestionRef = useRef('')

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  const keyboardOpen = keyboardHeight > 0
  const sheetBottomGap = keyboardOpen ? keyboardHeight : tabBarInset
  const composerMaxHeight = Math.max(280, windowHeight - sheetBottomGap - 8)
  const jobListMaxHeight = Math.max(
    72,
    Math.min(keyboardOpen ? 140 : 220, composerMaxHeight - (keyboardOpen ? 380 : 460)),
  )

  const feedQuery = useInfiniteQuery({
    queryKey: feedKey(userId),
    enabled: Boolean(userId),
    staleTime: FEED_STALE_MS,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { posts, error } = await loadPinboardFeedPage({ beforeCreatedAt: pageParam })
      if (error) throw new Error(error)
      return posts
    },
    getNextPageParam: (lastPage) =>
      lastPage.length >= PINBOARD_PAGE_SIZE ? lastPage[lastPage.length - 1]?.created_at : undefined,
    initialData: (): InfiniteData<PinboardPost[]> | undefined =>
      userId ? readInitialFeedPages(userId) : undefined,
    initialDataUpdatedAt: userId && readInitialFeedPages(userId) ? Date.now() : undefined,
  })

  // Flatten pages into a deduped list for the FlatList.
  const posts = useMemo(() => {
    const pages = feedQuery.data?.pages ?? []
    const seen = new Set<string>()
    const out: PinboardPost[] = []
    for (const page of pages) {
      for (const p of page) {
        if (!seen.has(p.id)) {
          seen.add(p.id)
          out.push(p)
        }
      }
    }
    return out
  }, [feedQuery.data])

  const loading = !userId || (feedQuery.isLoading && posts.length === 0)
  const loadingMore = feedQuery.isFetchingNextPage
  const loadError = feedQuery.error ? (feedQuery.error as Error).message : null

  // Redirect to login if there is no authenticated user (matches previous behaviour).
  useEffect(() => {
    let cancelled = false
    void getAuthUser().then((u) => {
      if (!cancelled && !u) router.replace('/login')
    })
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    if (!userId) return
    prefetchSecondaryTabsIdle(userId, role)
  }, [userId, role])

  // Free the one-shot warm handoff; fall back to disk cache for instant paint.
  useEffect(() => {
    if (!userId) return
    consumeWarmedPinboard(userId)
    if (queryClient.getQueryData(feedKey(userId))) return
    let cancelled = false
    void hydratePinboardFeedFromDisk(userId).then((disk) => {
      if (!cancelled && disk && !queryClient.getQueryData(feedKey(userId))) {
        queryClient.setQueryData<InfiniteData<PinboardPost[]>>(feedKey(userId), {
          pages: [disk],
          pageParams: [undefined],
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Keep the in-memory cache warm (used by the prefetch pipeline + cold boot).
  useEffect(() => {
    if (!userId) return
    const first = feedQuery.data?.pages[0]
    if (first) setCache(pinboardCacheKey(userId), { posts: first }, 25_000)
  }, [userId, feedQuery.data])

  // Revalidate on tab focus only if the feed has gone stale (>30s).
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void queryClient.refetchQueries({ queryKey: feedKey(userId), stale: true })
      }
    }, [userId]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    if (userId) deleteCache(pinboardCacheKey(userId))
    await Promise.all([
      queryClient.refetchQueries({ queryKey: feedKey(userId) }),
      refreshOverview({ bustCache: true }),
    ])
    setRefreshing(false)
  }, [refreshOverview, userId])

  const loadMore = useCallback(() => {
    if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
      void feedQuery.fetchNextPage()
    }
  }, [feedQuery])

  const freelancerPlan = overview?.freelancerPlan ?? 'free'
  const canCompose = canComposePinboardUpdates({ role, freelancerPlan })
  const allowUnlinked = isCeoProfile(role) || isCeoUserId(userId)
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
      const options = allowUnlinked
        ? await loadPublishedExternalJobsForPinboard()
        : await loadPinboardAttachOptions(userId)
      if (!cancelled) {
        setAttachOptions(options)
        setAttachLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, canCompose, allowUnlinked])

  const openComposer = useCallback(async () => {
    if (!userId || !canCompose) return
    setComposeError(null)
    setComposeBody('')
    lastSuggestionRef.current = ''
    setExternalSearch('')
    setAttachPickerOpen(allowUnlinked)
    setComposerOpen(true)
    setAttachLoading(true)
    const options = allowUnlinked
      ? await loadPublishedExternalJobsForPinboard()
      : await loadPinboardAttachOptions(userId)
    setAttachOptions(options)
    setComposeAttachKey(
      allowUnlinked ? PINBOARD_NO_ATTACH : (options[0]?.key ?? PINBOARD_NO_ATTACH)
    )
    setAttachLoading(false)
  }, [allowUnlinked, canCompose, userId])

  const createMutation = useMutation({
    mutationFn: async (vars: {
      body: string
      jobId: string | null
      projectId: string | null
      externalJobId: string | null
      jobTitle: string | null
      projectTitle: string | null
      externalJobTitle: string | null
      externalJobCompany: string | null
    }) => {
      const result = await createPinboardPost({
        userId: userId as string,
        body: vars.body,
        jobId: vars.jobId,
        projectId: vars.projectId,
        externalJobId: vars.externalJobId,
        allowUnlinked,
      })
      if (!result.ok) throw new Error(result.error)
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: feedKey(userId) })
      const prev = queryClient.getQueryData<InfiniteData<PinboardPost[]>>(feedKey(userId))
      const optimistic: PinboardPost = {
        id: `temp-${Date.now()}`,
        body: vars.body.trim(),
        created_at: new Date().toISOString(),
        job_id: vars.jobId,
        project_id: vars.projectId,
        external_job_id: vars.externalJobId,
        external_job_title: vars.externalJobTitle,
        external_job_company: vars.externalJobCompany,
        job_title: vars.jobTitle,
        job_company_id: null,
        job_company_name: displayName,
        job_company_logo_url: avatarUrl,
        job_location: null,
        job_location_type: null,
        job_start_date: null,
        job_budget_type: null,
        job_budget_amount: null,
        job_budget_currency: null,
        job_is_solo_workspace: false,
        project_title: vars.projectTitle,
        project_company_id: null,
        author_id: userId as string,
        author_name: displayName,
        author_avatar_url: avatarUrl,
      }
      queryClient.setQueryData<InfiniteData<PinboardPost[]>>(feedKey(userId), (old) => {
        if (!old || old.pages.length === 0) {
          return { pages: [[optimistic]], pageParams: [undefined] }
        }
        return { ...old, pages: old.pages.map((pg, i) => (i === 0 ? [optimistic, ...pg] : pg)) }
      })
      // Close the composer immediately — the post is already visible in the feed.
      setComposerOpen(false)
      setComposeBody('')
      lastSuggestionRef.current = ''
      return { prev, body: vars.body }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(feedKey(userId), ctx.prev)
      if (ctx?.body) setComposeBody(ctx.body)
      setComposeError(err instanceof Error ? err.message : 'Could not post update.')
      setComposerOpen(true)
    },
    onSettled: () => {
      if (userId) deleteCache(pinboardCacheKey(userId))
      void queryClient.invalidateQueries({ queryKey: feedKey(userId) })
    },
  })

  const composeSubmitting = createMutation.isPending

  const submitPost = useCallback(() => {
    if (!userId) return
    setComposeError(null)
    const parsed = parsePinboardAttachKey(composeAttachKey)
    const jobId = parsed?.kind === 'job' ? parsed.id : null
    const projectId = parsed?.kind === 'project' ? parsed.id : null
    const externalJobId = parsed?.kind === 'external' ? parsed.id : null
    const validation = validatePinboardUpdateInput({
      body: composeBody,
      jobId,
      projectId,
      externalJobId,
      allowUnlinked,
    })
    if (!validation.ok) {
      setComposeError(validation.error)
      return
    }
    const opt = attachOptions.find((o) => o.key === composeAttachKey)
    createMutation.mutate({
      body: composeBody,
      jobId,
      projectId,
      externalJobId,
      jobTitle: opt?.kind === 'job' ? opt.title : null,
      projectTitle: opt?.kind === 'project' ? opt.title : null,
      externalJobTitle: opt?.kind === 'external' ? opt.title : null,
      externalJobCompany: opt?.kind === 'external' ? opt.company ?? null : null,
    })
  }, [allowUnlinked, attachOptions, composeAttachKey, composeBody, createMutation, userId])

  const deleteMutation = useMutation({
    mutationFn: async (post: PinboardPost) => {
      const result = await deletePinboardPost(post.id)
      if (!result.ok) throw new Error(result.error)
    },
    onMutate: async (post) => {
      await queryClient.cancelQueries({ queryKey: feedKey(userId) })
      const prev = queryClient.getQueryData<InfiniteData<PinboardPost[]>>(feedKey(userId))
      queryClient.setQueryData<InfiniteData<PinboardPost[]>>(feedKey(userId), (old) => {
        if (!old) return old
        return { ...old, pages: old.pages.map((pg) => pg.filter((p) => p.id !== post.id)) }
      })
      return { prev }
    },
    onError: (_err, _post, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(feedKey(userId), ctx.prev)
      Alert.alert('Could not remove', 'Please try again.')
    },
    onSettled: () => {
      if (userId) deleteCache(pinboardCacheKey(userId))
      void queryClient.invalidateQueries({ queryKey: feedKey(userId) })
    },
  })

  const onDeletePost = useCallback(
    (post: PinboardPost) => {
      Alert.alert('Remove post?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(post),
        },
      ])
    },
    [deleteMutation],
  )

  const avatarLetter = displayName.charAt(0).toUpperCase() || '?'

  const openPostLink = useCallback(
    (p: PinboardPost) => {
      if (p.external_job_id && p.external_job_title) {
        router.push({
          pathname: '/(tabs)/jobs',
          params: { externalJobId: p.external_job_id },
        } as Href)
        return
      }
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
      if (p.job_id && p.job_title) {
        return (
          <View style={styles.jobCardWrap}>
            <JobListingCard
              companyName={p.job_company_name || p.author_name}
              companyLogoUrl={p.job_company_logo_url || p.author_avatar_url}
              title={p.job_title}
              location={p.job_location}
              locationType={p.job_location_type}
              startDate={p.job_start_date}
              budgetType={p.job_budget_type}
              budgetAmount={p.job_budget_amount}
              budgetCurrency={p.job_budget_currency}
              onPress={() => openPostLink(p)}
            />
            {canMod ? (
              <TouchableOpacity onPress={() => onDeletePost(p)} hitSlop={8}>
                <Text style={styles.postRemove}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )
      }
      const openCard = hasLink ? () => openPostLink(p) : undefined
      return (
        <TouchableOpacity
          style={styles.postCard}
          activeOpacity={hasLink ? 0.86 : 1}
          disabled={!hasLink}
          onPress={openCard}
        >
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
              {hasLink && linkLabel ? (
                <Text style={styles.postJobLink} numberOfLines={1}>
                  {linkLabel} →
                </Text>
              ) : null}
              <Text style={styles.postText}>{p.body}</Text>
              {canMod ? (
                <TouchableOpacity onPress={() => onDeletePost(p)} hitSlop={8}>
                  <Text style={styles.postRemove}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      )
    },
    [onDeletePost, openPostLink, userId]
  )

  const hasAttachOptions = attachOptions.length > 0
  const filteredAttachOptions = useMemo(() => {
    if (!allowUnlinked) return attachOptions
    const q = externalSearch.trim().toLowerCase()
    if (!q) return attachOptions
    return attachOptions.filter((opt) => {
      const haystack = `${opt.title} ${opt.company ?? ''} ${opt.meta ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [allowUnlinked, attachOptions, externalSearch])
  const canSubmit =
    (allowUnlinked || composeAttachKey !== PINBOARD_NO_ATTACH) &&
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
      <Text style={styles.sectionSubtitle}>
        {allowUnlinked
          ? PINBOARD_UPDATES_COPY.sectionSubtitleCeo
          : PINBOARD_UPDATES_COPY.sectionSubtitle}
      </Text>
      {!canCompose ? (
        <View style={styles.blockedCard}>
          <Text style={styles.blockedText}>{PINBOARD_UPDATES_COPY.starterBlocked}</Text>
        </View>
      ) : !allowUnlinked && !hasAttachOptions && !attachLoading && userId ? (
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
            <Text style={styles.composerPlaceholder}>
              {allowUnlinked
                ? PINBOARD_UPDATES_COPY.composerPlaceholderCeo
                : PINBOARD_UPDATES_COPY.composerPlaceholder}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={styles.sectionLabel}>{PINBOARD_UPDATES_COPY.recentLabel}</Text>
    </>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ResponsiveScreen>
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
            <Text style={styles.emptyText}>
              {allowUnlinked ? PINBOARD_UPDATES_COPY.emptyFeedCeo : PINBOARD_UPDATES_COPY.emptyFeed}
            </Text>
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
          <View
            style={[
              styles.modalSheet,
              { marginBottom: sheetBottomGap, maxHeight: composerMaxHeight, paddingBottom: 12 },
            ]}
          >
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
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              style={{ maxHeight: composerMaxHeight - 64 }}
            >
            <Text style={styles.attachFieldLabel}>
              {allowUnlinked
                ? PINBOARD_UPDATES_COPY.attachOptionalLabel
                : PINBOARD_UPDATES_COPY.attachLabel}
            </Text>
            {allowUnlinked ? (
              <Text style={styles.attachHint}>{PINBOARD_UPDATES_COPY.attachExternalHint}</Text>
            ) : null}
            {attachLoading ? (
              <View style={{ marginVertical: 8, alignItems: 'flex-start' }}>
                <CreaInlineLoader size="sm" />
              </View>
            ) : allowUnlinked ? (
              <View style={styles.jobAttachList}>
                <TextInput
                  value={externalSearch}
                  onChangeText={setExternalSearch}
                  placeholder={PINBOARD_UPDATES_COPY.externalSearchPlaceholder}
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  style={styles.externalSearch}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                <ScrollView
                  style={[styles.jobAttachScroll, { maxHeight: jobListMaxHeight }]}
                  keyboardShouldPersistTaps="handled"
                >
                  {filteredAttachOptions.map((opt) => {
                    const selected = composeAttachKey === opt.key
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.jobAttachItem, selected && styles.jobAttachItemSelected]}
                        onPress={() => {
                          setComposeAttachKey(opt.key)
                          const suggestion = suggestedExternalJobUpdateNote({
                            title: opt.title,
                            company: opt.company,
                          })
                          setComposeBody((current) => {
                            if (!current.trim() || current === lastSuggestionRef.current) {
                              lastSuggestionRef.current = suggestion
                              return suggestion
                            }
                            return current
                          })
                        }}
                      >
                        <Text style={[styles.jobAttachItemText, selected && styles.jobAttachItemTextSelected]} numberOfLines={2}>
                          {opt.title}
                        </Text>
                        {opt.company || opt.meta ? (
                          <Text style={styles.jobAttachItemMeta} numberOfLines={1}>
                            {[opt.company, opt.meta].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    )
                  })}
                  {attachOptions.length === 0 ? (
                    <Text style={styles.attachEmpty}>{PINBOARD_UPDATES_COPY.noExternalJobs}</Text>
                  ) : filteredAttachOptions.length === 0 ? (
                    <Text style={styles.attachEmpty}>{PINBOARD_UPDATES_COPY.noExternalMatches}</Text>
                  ) : null}
                </ScrollView>
                <TouchableOpacity
                  onPress={() => {
                    setComposeAttachKey(PINBOARD_NO_ATTACH)
                    setComposeBody((current) => (current === lastSuggestionRef.current ? '' : current))
                    lastSuggestionRef.current = ''
                  }}
                  style={styles.noLinkBtn}
                >
                  <Text style={styles.noLinkBtnText}>{PINBOARD_UPDATES_COPY.noLinkOption}</Text>
                </TouchableOpacity>
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
                    {allowUnlinked ? (
                      <TextInput
                        value={externalSearch}
                        onChangeText={setExternalSearch}
                        placeholder={PINBOARD_UPDATES_COPY.externalSearchPlaceholder}
                        placeholderTextColor="rgba(255,255,255,0.28)"
                        style={styles.externalSearch}
                        autoCorrect={false}
                        autoCapitalize="none"
                      />
                    ) : null}
                    <ScrollView style={styles.jobAttachScroll} keyboardShouldPersistTaps="handled">
                    {!externalSearch.trim() && allowUnlinked ? (
                      <TouchableOpacity
                        style={styles.jobAttachItem}
                        onPress={() => {
                          setComposeAttachKey(PINBOARD_NO_ATTACH)
                          setAttachPickerOpen(false)
                        }}
                      >
                        <Text style={styles.jobAttachItemText}>{PINBOARD_UPDATES_COPY.noLinkOption}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {allowUnlinked && attachOptions.length === 0 ? (
                      <Text style={styles.attachEmpty}>{PINBOARD_UPDATES_COPY.noExternalJobs}</Text>
                    ) : allowUnlinked && filteredAttachOptions.length === 0 ? (
                      <Text style={styles.attachEmpty}>{PINBOARD_UPDATES_COPY.noExternalMatches}</Text>
                    ) : (
                    filteredAttachOptions.map((opt) => (
                      <TouchableOpacity
                        key={opt.key}
                        style={styles.jobAttachItem}
                        onPress={() => {
                          setComposeAttachKey(opt.key)
                          setAttachPickerOpen(false)
                          if (opt.kind === 'external') {
                            const suggestion = suggestedExternalJobUpdateNote({
                              title: opt.title,
                              company: opt.company,
                            })
                            setComposeBody((current) => {
                              if (!current.trim() || current === lastSuggestionRef.current) {
                                lastSuggestionRef.current = suggestion
                                return suggestion
                              }
                              return current
                            })
                          }
                        }}
                      >
                        <Text style={styles.jobAttachItemText} numberOfLines={2}>
                          {opt.kind === 'external' ? opt.title : formatPinboardAttachOptionLabel(opt.kind, opt.title)}
                        </Text>
                        {opt.kind === 'external' && (opt.company || opt.meta) ? (
                          <Text style={styles.jobAttachItemMeta} numberOfLines={1}>
                            {[opt.company, opt.meta].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    ))
                    )}
                    </ScrollView>
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
              placeholder={
                allowUnlinked
                  ? PINBOARD_UPDATES_COPY.messagePlaceholderCeo
                  : PINBOARD_UPDATES_COPY.messagePlaceholder
              }
              placeholderTextColor="rgba(255,255,255,0.28)"
              multiline
              maxLength={6000}
              style={[styles.modalInput, keyboardOpen && styles.modalInputKeyboard]}
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
            </ScrollView>
          </View>
        </View>
      </Modal>
      </ResponsiveScreen>
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
  jobCardWrap: { marginBottom: 10, gap: 6 },
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
  attachHint: {
    marginTop: -4,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.35)',
  },
  attachEmpty: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
  },
  externalSearch: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#fff',
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
    paddingBottom: 16,
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
  modalInputKeyboard: {
    minHeight: 72,
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
  jobAttachScroll: { maxHeight: 240 },
  jobAttachItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  jobAttachItemText: { fontSize: 13, color: '#fff' },
  jobAttachItemSelected: { backgroundColor: 'rgba(255,220,0,0.1)' },
  jobAttachItemTextSelected: { color: '#FFDC00', fontWeight: '700' },
  jobAttachItemMeta: { marginTop: 2, fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  noLinkBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  noLinkBtnText: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
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

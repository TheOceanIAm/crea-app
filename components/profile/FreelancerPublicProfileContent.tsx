import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  Linking,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  Camera,
  ChevronRight,
  Globe,
  Link2,
  MapPin,
  MessageCircle,
  Palette,
  Share2,
  Video,
} from 'lucide-react-native'
import { AvailabilityMonthPreview } from '@/components/profile/AvailabilityMonthPreview'
import { BookFreelancerModal } from '@/components/profile/BookFreelancerModal'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { parseAvailabilityCalendar } from '@/lib/availabilityCalendar'
import { ICON_STROKE } from '@/lib/iconTheme'
import type { FreelancerPublicProfilePayload } from '@/lib/freelancerPublicProfileTypes'
import { money } from '@/lib/invoiceFormatting'
import {
  behanceUrl,
  instagramUrl,
  linkedinUrl,
  normalizeExternalUrl,
  vimeoUrl,
} from '@/lib/profilePublicLinks'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'
import { profileShareUrl } from '@/lib/shareLinks'
import { supabase } from '@/lib/supabase'
import { findOrCreateDirectConversation } from '@/lib/directConversation'
import { normalizePublicProfileRpc } from '@/lib/normalizePublicProfileRpc'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'

function strTrim(v: string | null | undefined): string {
  if (v == null) return ''
  return typeof v === 'string' ? v.trim() : ''
}

function SocialButton({
  icon: Icon,
  url,
  accessibilityLabel,
}: {
  icon: LucideIcon
  url: string | null
  accessibilityLabel: string
}) {
  if (!url) return null
  return (
    <TouchableOpacity
      style={styles.socialBtn}
      onPress={() => Linking.openURL(url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
    </TouchableOpacity>
  )
}

function projectSubtitle(p: PortfolioProject): string {
  const r = strTrim(p.role)
  if (r) return r
  return strTrim(p.client)
}

type Props = {
  profile: FreelancerPublicProfilePayload
  userId: string
  authUserId: string | null
  /** Freelancer vs company public layout (rates, availability, stats apply to freelancers). */
  roleKind: 'freelancer' | 'company'
  /** Extra bottom padding (e.g. tab bar in profile preview). */
  contentBottomPad?: number
  /** When true, show a note that this matches the public link (preview screen). */
  previewMode?: boolean
  /** Optional: control share sheet from parent (e.g. header Share button on `/profile/:id`). */
  shareModalOpen?: boolean
  onShareModalOpenChange?: (open: boolean) => void
  /**
   * `inner` = this component owns a vertical ScrollView (default).
   * `none` = render body only; parent screen must wrap in ScrollView (fixes missing sections on some devices).
   */
  scrollMode?: 'inner' | 'none'
}

export function FreelancerPublicProfileContent({
  profile,
  userId,
  authUserId,
  roleKind,
  contentBottomPad = 40,
  previewMode = false,
  shareModalOpen: shareModalOpenProp,
  onShareModalOpenChange,
  scrollMode = 'inner',
}: Props) {
  const isFreelancer = roleKind === 'freelancer'
  const profileNorm = useMemo(() => normalizePublicProfileRpc(profile), [profile])
  const router = useRouter()
  const [shareOpenInternal, setShareOpenInternal] = useState(false)
  const shareOpen = shareModalOpenProp !== undefined ? shareModalOpenProp : shareOpenInternal
  const setShareOpen = onShareModalOpenChange ?? setShareOpenInternal
  const [portfolioFilter, setPortfolioFilter] = useState<string>('All')
  const [viewerIsCompany, setViewerIsCompany] = useState(false)
  const [viewerIsCeo, setViewerIsCeo] = useState(false)
  const [bookingSelection, setBookingSelection] = useState<Set<string> | null>(null)
  const [companyJobs, setCompanyJobs] = useState<
    {
      id: string
      title: string
      category: string
      budget_type: string
      budget_amount: number | null
      budget_currency: string | null
      location_type: string
    }[]
  >([])
  const [companyJobsLoading, setCompanyJobsLoading] = useState(false)

  const projects = useMemo(
    () => parsePortfolioProjects(profileNorm.portfolio_projects),
    [profileNorm.portfolio_projects]
  )

  const skills = useMemo(() => profileNorm.skills as string[], [profileNorm.skills])
  const equipment = useMemo(() => profileNorm.equipment as string[], [profileNorm.equipment])

  const workFilterTags = useMemo(() => {
    const set = new Set<string>()
    for (const p of projects) {
      const c = strTrim(p.client)
      const r = strTrim(p.role)
      if (c) set.add(c)
      if (r) set.add(r)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [projects])

  useEffect(() => {
    if (portfolioFilter !== 'All' && !workFilterTags.includes(portfolioFilter)) {
      setPortfolioFilter('All')
    }
  }, [workFilterTags, portfolioFilter])

  useEffect(() => {
    let cancelled = false
    if (!authUserId) {
      setViewerIsCompany(false)
      setViewerIsCeo(false)
      return
    }
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: p } = await supabase.from('profiles').select('role').eq('id', authUserId).maybeSingle()
      if (cancelled) return
      const role = resolveAppRole(p?.role, user)
      setViewerIsCompany(
        Boolean(user && (isCompanyProfile(role) || isFreelancerProfile(role)) && !isCeoProfile(role))
      )
      setViewerIsCeo(isCeoProfile(role))
    })()
    return () => {
      cancelled = true
    }
  }, [authUserId])

  useEffect(() => {
    if (isFreelancer || !userId) {
      setCompanyJobs([])
      setCompanyJobsLoading(false)
      return
    }
    let cancelled = false
    setCompanyJobsLoading(true)
    void (async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, title, category, budget_type, budget_amount, budget_currency, location_type, status')
        .eq('company_id', userId)
        .eq('status', 'active')
        .eq('is_solo_workspace', false)
        .order('created_at', { ascending: false })
        .limit(40)
      if (cancelled) return
      if (!error && Array.isArray(data)) {
        setCompanyJobs(data)
      } else {
        setCompanyJobs([])
      }
      setCompanyJobsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [isFreelancer, userId])

  const filteredProjects = useMemo(() => {
    if (portfolioFilter === 'All') return projects
    return projects.filter((p) => {
      const c = strTrim(p.client)
      const r = strTrim(p.role)
      return c === portfolioFilter || r === portfolioFilter
    })
  }, [projects, portfolioFilter])

  const calendar = useMemo(
    () => parseAvailabilityCalendar(profileNorm.availability_calendar),
    [profileNorm.availability_calendar]
  )

  const jobBookedIso = useMemo(() => {
    const raw = profileNorm.calendar_busy_dates
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    const next = new Set<string>()
    for (const x of raw) {
      const s = typeof x === 'string' ? x.trim() : String(x).trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) next.add(s)
    }
    return next.size > 0 ? next : undefined
  }, [profileNorm.calendar_busy_dates])

  const socials = useMemo(() => {
    const entries: { icon: LucideIcon; url: string | null; label: string }[] = [
      {
        icon: Globe,
        url: profileNorm.portfolio_website ? normalizeExternalUrl(profileNorm.portfolio_website) : null,
        label: 'Website',
      },
      {
        icon: Camera,
        url: instagramUrl(profileNorm.portfolio_instagram ?? ''),
        label: 'Instagram',
      },
      {
        icon: Link2,
        url: linkedinUrl(profileNorm.portfolio_linkedin ?? ''),
        label: 'LinkedIn',
      },
      {
        icon: Video,
        url: vimeoUrl(profileNorm.portfolio_vimeo ?? ''),
        label: 'Vimeo',
      },
      {
        icon: Palette,
        url: behanceUrl(profileNorm.portfolio_behance ?? ''),
        label: 'Behance',
      },
    ]
    return entries.filter((x): x is { icon: LucideIcon; url: string; label: string } => x.url != null)
  }, [profileNorm])

  const shareUrl = useMemo(() => profileShareUrl(userId), [userId])

  const name = strTrim(profileNorm.name) || 'Crea member'
  const avatarUri = profileNorm.avatar_url?.trim() ?? ''
  const showImage = /^https?:\/\//i.test(avatarUri)
  const letter = name.charAt(0).toUpperCase() || '?'
  const headlineDisplay = strTrim(profileNorm.headline)
  const locationDisplay = strTrim(profileNorm.location)
  const bioDisplay = strTrim(profileNorm.bio)
  const cur = profileNorm.rates_currency ?? 'EUR'
  const dayRate = profileNorm.day_rate_amount ?? null
  const halfDay = profileNorm.half_day_rate_amount ?? null
  const publicPlanTier = String(
    (profileNorm as Record<string, unknown>).plan_tier ??
      (profileNorm as Record<string, unknown>).subscription_tier ??
      'starter'
  )
    .trim()
    .toLowerCase()
  const canShowPublicRates = publicPlanTier !== 'workspace'
  const availabilityStatus = strTrim(profileNorm.availability_status)
  const availabilityDetails = strTrim(profileNorm.availability_details)
  const shareMessage = `${name} — view on Crea`
  const viewingOwn = Boolean(authUserId && authUserId === userId)
  const companyAvailabilityInvite =
    Boolean(authUserId) && viewerIsCompany && isFreelancer && !viewingOwn && !isCeoProfile(profileNorm.role)

  /** Company profiles: only the CEO may start a chat with a company. Freelancer profiles: existing rules (not to CEO). */
  const showSendMessage =
    Boolean(authUserId && !viewingOwn) &&
    !isCeoProfile(profileNorm.role) &&
    (isFreelancer ? true : viewerIsCeo)

  const onMessagePress = async () => {
    if (!authUserId) {
      router.push('/login')
      return
    }
    if (isCeoProfile(profileNorm.role)) {
      Alert.alert('Messages', 'Direct messages to this account are not available.')
      return
    }
    const r = await findOrCreateDirectConversation(userId)
    if (r.ok === false) {
      const msg =
        r.error === 'not_authenticated'
          ? 'Please sign in.'
          : r.error === 'self'
            ? 'You cannot message yourself.'
            : r.error
      Alert.alert('Could not open chat', msg)
      return
    }
    router.push(`/conversation/${r.conversationId}`)
  }

  const scrollContent = (
    <>
        {!previewMode ? (
          <>
            <Text style={styles.brand}>Crea</Text>
            <Text style={styles.kicker}>Public profile</Text>
          </>
        ) : (
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerTitle}>Public profile</Text>
            <Text style={styles.previewBannerSub}>
              This is how your profile looks to companies and other users — same data as your public link on the web and
              in the app.
            </Text>
          </View>
        )}

        <View style={styles.heroCard}>
          {showImage ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarLetter}>{letter}</Text>
            </View>
          )}
          <Text style={styles.name}>{name}</Text>
          {headlineDisplay ? <Text style={styles.headline}>{headlineDisplay}</Text> : null}

          {!isFreelancer ? (
            <View style={styles.companyShareSocialRow}>
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => setShareOpen(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Share profile"
              >
                <Share2 size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
              {socials.map((s, i) => (
                <SocialButton key={i} icon={s.icon} url={s.url} accessibilityLabel={s.label} />
              ))}
            </View>
          ) : null}

          {isFreelancer && locationDisplay ? (
            <View style={styles.locationRow}>
              <MapPin size={16} color="rgba(255,255,255,0.4)" strokeWidth={ICON_STROKE} />
              <Text style={styles.location}>{locationDisplay}</Text>
            </View>
          ) : null}

          {isFreelancer && socials.length > 0 ? (
            <View style={styles.heroSocialRow}>
              {socials.map((s, i) => (
                <SocialButton key={i} icon={s.icon} url={s.url} accessibilityLabel={s.label} />
              ))}
            </View>
          ) : null}

          <View style={styles.pillRow}>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{isFreelancer ? 'Freelancer' : 'Company'}</Text>
            </View>
            {isFreelancer && availabilityStatus ? (
              <View style={[styles.rolePill, styles.availPill]}>
                <Text style={styles.rolePillText}>{availabilityStatus}</Text>
              </View>
            ) : null}
          </View>
          {isFreelancer ? (
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{dayRate != null ? money(dayRate, cur) : '—'}</Text>
                <Text style={styles.statLabel}>DAY RATE</Text>
              </View>
            </View>
          ) : null}
          {isFreelancer && (profileNorm.open_to_remote || profileNorm.open_to_travel) ? (
            <View style={[styles.pillRow, styles.pillRowSpaced]}>
              {profileNorm.open_to_remote ? (
                <View style={[styles.rolePill, styles.tagPill]}>
                  <Text style={styles.tagPillText}>OPEN TO REMOTE</Text>
                </View>
              ) : null}
              {profileNorm.open_to_travel ? (
                <View style={[styles.rolePill, styles.tagPill]}>
                  <Text style={styles.tagPillText}>OPEN TO TRAVEL</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {showSendMessage || isFreelancer ? (
            <View style={styles.quickActions}>
              {showSendMessage ? (
                <TouchableOpacity
                  style={styles.quickActionBtn}
                  onPress={() => void onMessagePress()}
                  activeOpacity={0.85}
                >
                  <MessageCircle size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                  <Text style={styles.quickActionText}>Send message</Text>
                </TouchableOpacity>
              ) : null}
              {isFreelancer ? (
                <TouchableOpacity style={styles.quickActionBtn} onPress={() => setShareOpen(true)} activeOpacity={0.85}>
                  <Share2 size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                  <Text style={styles.quickActionText}>Share profile</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {!isFreelancer ? (
          <>
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Location</Text>
              {locationDisplay ? (
                <View style={styles.companyDetailRow}>
                  <MapPin size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
                  <Text style={styles.bio}>{locationDisplay}</Text>
                </View>
              ) : (
                <Text style={styles.emptyHint}>No location on this profile yet.</Text>
              )}
            </View>
            <View style={styles.block}>
              <Text style={styles.blockTitle}>About the company</Text>
              {bioDisplay ? (
                <Text style={styles.bio}>{bioDisplay}</Text>
              ) : (
                <Text style={styles.emptyHint}>No description yet.</Text>
              )}
            </View>
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Posted jobs</Text>
              {companyJobsLoading ? (
                <Text style={styles.emptyHint}>Loading jobs…</Text>
              ) : companyJobs.length === 0 ? (
                <Text style={styles.emptyHint}>No open jobs right now.</Text>
              ) : (
                companyJobs.map((job) => (
                  <TouchableOpacity
                    key={job.id}
                    style={styles.jobRow}
                    activeOpacity={0.85}
                    onPress={() => router.push(`/(tabs)/jobs/${job.id}`)}
                  >
                    <View style={styles.jobRowBody}>
                      <Text style={styles.jobRowTitle} numberOfLines={2}>
                        {job.title}
                      </Text>
                      <Text style={styles.jobRowMeta} numberOfLines={2}>
                        {[
                          strTrim(job.category),
                          formatBudgetDisplay({
                            budget_type: job.budget_type,
                            budget_amount: job.budget_amount,
                            budget_currency: job.budget_currency,
                          }),
                          strTrim(job.location_type),
                        ]
                          .filter((x) => x.length > 0)
                          .join(' · ')}
                      </Text>
                    </View>
                    <ChevronRight size={20} color="rgba(255,255,255,0.35)" strokeWidth={ICON_STROKE} />
                  </TouchableOpacity>
                ))
              )}
            </View>
          </>
        ) : null}

        {isFreelancer && availabilityDetails ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Availability note</Text>
            <Text style={styles.bio}>{availabilityDetails}</Text>
          </View>
        ) : null}

        {isFreelancer ? (
          bioDisplay ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>About</Text>
              <Text style={styles.bio}>{bioDisplay}</Text>
            </View>
          ) : (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>About</Text>
              <Text style={styles.emptyHint}>No bio on this public profile yet.</Text>
            </View>
          )
        ) : null}

        {isFreelancer ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Skills</Text>
            {skills.length > 0 ? (
              <View style={styles.chipRow}>
                {skills.map((s) => (
                  <View key={s} style={styles.chip}>
                    <Text style={styles.chipText}>{s}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyHint}>No skills listed yet.</Text>
            )}
          </View>
        ) : skills.length > 0 ? (
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

        {isFreelancer && equipment.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Essentials</Text>
            {equipment.map((item) => (
              <View key={item} style={styles.essentialRow}>
                <Text style={styles.essentialMark}>✓</Text>
                <Text style={styles.essentialText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {isFreelancer ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Work</Text>
            {filteredProjects.length > 0 ? (
              <>
                {workFilterTags.length > 0 ? (
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterScroll}
                    style={styles.filterBar}
                  >
                    <TouchableOpacity
                      onPress={() => setPortfolioFilter('All')}
                      style={[styles.filterChip, portfolioFilter === 'All' && styles.filterChipOn]}
                    >
                      <Text style={[styles.filterChipText, portfolioFilter === 'All' && styles.filterChipTextOn]}>
                        All
                      </Text>
                    </TouchableOpacity>
                    {workFilterTags.map((c) => (
                      <TouchableOpacity
                        key={c}
                        onPress={() => setPortfolioFilter(c)}
                        style={[styles.filterChip, portfolioFilter === c && styles.filterChipOn]}
                      >
                        <Text style={[styles.filterChipText, portfolioFilter === c && styles.filterChipTextOn]}>
                          {c.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={styles.workGrid}>
                  {filteredProjects.map((proj: PortfolioProject, i: number) => {
                    const sub = projectSubtitle(proj)
                    const openProject = () => {
                      const u = strTrim(proj.link)
                      if (u) Linking.openURL(u).catch(() => {})
                    }
                    return (
                      <TouchableOpacity
                        key={`${proj.title}-${i}`}
                        style={styles.workTile}
                        activeOpacity={0.85}
                        onPress={openProject}
                        disabled={!strTrim(proj.link)}
                      >
                        {proj.image_url ? (
                          <Image source={{ uri: proj.image_url }} style={styles.workThumb} />
                        ) : (
                          <View style={styles.workThumbPlaceholder}>
                            <Text style={styles.workThumbLetter}>{proj.title.charAt(0).toUpperCase() || '•'}</Text>
                          </View>
                        )}
                        <Text style={styles.workTileTitle} numberOfLines={2}>
                          {proj.title}
                        </Text>
                        {sub ? (
                          <Text style={styles.workTileSub} numberOfLines={1}>
                            {sub}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            ) : (
              <Text style={styles.emptyHint}>No portfolio items yet.</Text>
            )}
          </View>
        ) : filteredProjects.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Work</Text>
            {workFilterTags.length > 0 ? (
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterScroll}
                style={styles.filterBar}
              >
                <TouchableOpacity
                  onPress={() => setPortfolioFilter('All')}
                  style={[styles.filterChip, portfolioFilter === 'All' && styles.filterChipOn]}
                >
                  <Text style={[styles.filterChipText, portfolioFilter === 'All' && styles.filterChipTextOn]}>
                    All
                  </Text>
                </TouchableOpacity>
                {workFilterTags.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setPortfolioFilter(c)}
                    style={[styles.filterChip, portfolioFilter === c && styles.filterChipOn]}
                  >
                    <Text style={[styles.filterChipText, portfolioFilter === c && styles.filterChipTextOn]}>
                      {c.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.workGrid}>
              {filteredProjects.map((proj: PortfolioProject, i: number) => {
                const sub = projectSubtitle(proj)
                const openProject = () => {
                  const u = strTrim(proj.link)
                  if (u) Linking.openURL(u).catch(() => {})
                }
                return (
                  <TouchableOpacity
                    key={`${proj.title}-${i}`}
                    style={styles.workTile}
                    activeOpacity={0.85}
                    onPress={openProject}
                    disabled={!strTrim(proj.link)}
                  >
                    {proj.image_url ? (
                      <Image source={{ uri: proj.image_url }} style={styles.workThumb} />
                    ) : (
                      <View style={styles.workThumbPlaceholder}>
                        <Text style={styles.workThumbLetter}>{proj.title.charAt(0).toUpperCase() || '•'}</Text>
                      </View>
                    )}
                    <Text style={styles.workTileTitle} numberOfLines={2}>
                      {proj.title}
                    </Text>
                    {sub ? (
                      <Text style={styles.workTileSub} numberOfLines={1}>
                        {sub}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        ) : null}

        {isFreelancer ? (
          <AvailabilityMonthPreview
            calendar={calendar}
            anchor={new Date()}
            interactive={companyAvailabilityInvite}
            alwaysShow
            jobBookedIso={jobBookedIso}
            committedBookingIsos={bookingSelection ?? undefined}
            onCommitBookingSelection={
              companyAvailabilityInvite
                ? (isos) => {
                    if (isos.size === 0) return
                    setBookingSelection(new Set(isos))
                  }
                : undefined
            }
          />
        ) : null}

        {isFreelancer ? (
          <TouchableOpacity
            style={styles.browseLink}
            onPress={() => router.push('/(tabs)/talent-pool')}
            activeOpacity={0.85}
          >
            <Text style={styles.browseLinkText}>Browse more freelancers →</Text>
          </TouchableOpacity>
        ) : null}
    </>
  )

  return (
    <View style={scrollMode === 'inner' ? styles.root : styles.embedRoot}>
      <ShareSheetModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        sheetTitle="Share profile"
        shareMessage={shareMessage}
        shareUrl={shareUrl}
        mailSubject={`Crea profile: ${name}`}
      />

      {authUserId && companyAvailabilityInvite && bookingSelection != null && bookingSelection.size > 0 ? (
        <BookFreelancerModal
          visible
          onClose={() => setBookingSelection(null)}
          companyUserId={authUserId}
          freelancerId={userId}
          freelancerName={name}
          freelancerAvatarUrl={showImage ? avatarUri : null}
          freelancerLetter={letter}
          dayRateAmount={dayRate}
          ratesCurrency={cur}
          selectedIsos={bookingSelection}
          onInviteSent={(conversationId) => {
            setBookingSelection(null)
            router.push(`/conversation/${conversationId}`)
          }}
        />
      ) : null}

      {scrollMode === 'inner' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollPad, { paddingBottom: contentBottomPad }]}
          showsVerticalScrollIndicator={Platform.OS !== 'web'}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {scrollContent}
        </ScrollView>
      ) : (
        <View style={[styles.scrollPad, { paddingBottom: contentBottomPad }]}>{scrollContent}</View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  /** Fills space under the parent header so the list scrolls instead of clipping. */
  root: { flex: 1, minHeight: 0 },
  /** Parent screen provides ScrollView — no nested vertical scroll. */
  embedRoot: { width: '100%' },
  scroll: { flex: 1 },
  scrollPad: { paddingHorizontal: 24, maxWidth: 560, alignSelf: 'center', width: '100%' },
  emptyHint: { fontSize: 14, color: 'rgba(255,255,255,0.38)', lineHeight: 20, fontStyle: 'italic' },
  brand: { fontSize: 22, fontWeight: '900', color: '#FFDC00', letterSpacing: 1, marginBottom: 16 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 2,
    marginBottom: 20,
    textTransform: 'uppercase',
  },
  previewBanner: { marginBottom: 18 },
  previewBannerTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 6,
  },
  previewBannerSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 19,
  },
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
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  location: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
  heroSocialRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 12,
  },
  /** Company: Share + link icons in one row directly under the name. */
  companyShareSocialRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
    marginBottom: 4,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  statCell: { alignItems: 'center', minWidth: 72 },
  statValue: { fontSize: 20, fontWeight: '800', color: '#fff' },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    marginTop: 4,
    letterSpacing: 1,
  },
  pillRowSpaced: { marginTop: 10, justifyContent: 'center' },
  tagPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  tagPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  quickActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  quickActionText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  availPill: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderColor: 'rgba(34,197,94,0.35)',
  },
  rolePillText: { fontSize: 10, fontWeight: '800', color: '#FFDC00', letterSpacing: 1 },
  rateMain: { fontSize: 28, fontWeight: '800', color: '#FFDC00' },
  ratePer: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  rateSub: { marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,0.55)' },
  block: { marginBottom: 22 },
  blockTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1.2,
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
  essentialRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  essentialMark: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFDC00',
    marginTop: 1,
    width: 18,
  },
  essentialText: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 20 },
  socialRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  socialBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBar: { marginBottom: 14, marginHorizontal: -4 },
  filterScroll: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: '#111',
  },
  filterChipOn: {
    borderColor: '#FFDC00',
    backgroundColor: 'rgba(255,220,0,0.12)',
  },
  filterChipText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  filterChipTextOn: { color: '#FFDC00' },
  workGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  workTile: {
    width: '48%',
    marginBottom: 8,
  },
  workThumb: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 10,
    backgroundColor: '#222',
    marginBottom: 8,
  },
  workThumbPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 10,
    backgroundColor: '#222',
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  workThumbLetter: { fontSize: 28, fontWeight: '800', color: 'rgba(255,255,255,0.2)' },
  workTileTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  workTileSub: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  browseLink: { marginTop: 20, marginBottom: 8, paddingVertical: 8, alignItems: 'center' },
  browseLinkText: { fontSize: 14, fontWeight: '700', color: '#FFDC00' },
  companyDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  jobRowBody: { flex: 1, minWidth: 0 },
  jobRowTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  jobRowMeta: { fontSize: 13, color: 'rgba(255,255,255,0.45)' },
})

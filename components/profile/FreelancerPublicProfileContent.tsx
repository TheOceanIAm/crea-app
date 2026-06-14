import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  Linking,
  TouchableOpacity,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  Camera,
  ChevronRight,
  Globe,
  Link2,
  Palette,
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
import { canFreelancerCreatePrivateProjects, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'
import { enrichPortfolioProjectsThumbnails } from '@/lib/freelancerPortfolioTable'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'
import { profileShareUrl } from '@/lib/shareLinks'
import { supabase } from '@/lib/supabase'
import { normalizePublicProfileRpc } from '@/lib/normalizePublicProfileRpc'
import { formatProfileLocationEnglish } from '@/lib/formatProfileLocationEnglish'
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
      <Icon size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
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
  const [viewerCanUseAvailabilityInvite, setViewerCanUseAvailabilityInvite] = useState(false)
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
  const [visibleProjectCount, setVisibleProjectCount] = useState(6)

  const parsedProjects = useMemo(
    () => parsePortfolioProjects(profileNorm.portfolio_projects),
    [profileNorm.portfolio_projects]
  )
  const [projects, setProjects] = useState<PortfolioProject[]>(parsedProjects)

  useEffect(() => {
    let cancelled = false
    setProjects(parsedProjects)
    void (async () => {
      const enriched = await enrichPortfolioProjectsThumbnails(parsedProjects)
      if (!cancelled) setProjects(enriched)
    })()
    return () => {
      cancelled = true
    }
  }, [parsedProjects])

  const skills = useMemo(() => profileNorm.skills as string[], [profileNorm.skills])
  const equipment = useMemo(() => profileNorm.equipment as string[], [profileNorm.equipment])

  useEffect(() => {
    let cancelled = false
    if (!authUserId) {
      setViewerCanUseAvailabilityInvite(false)
      return
    }
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: p } = await supabase.from('profiles').select('role').eq('id', authUserId).maybeSingle()
      if (cancelled) return
      const role = resolveAppRole(p?.role, user)
      const plan = resolveFreelancerPlanFromUser(user)
      const freelancerCanCreatePrivate = canFreelancerCreatePrivateProjects(plan)
      setViewerCanUseAvailabilityInvite(
        Boolean(user) &&
          (isCompanyProfile(role) || (isFreelancerProfile(role) && freelancerCanCreatePrivate)) &&
          !isCeoProfile(role)
      )
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

  useEffect(() => {
    setVisibleProjectCount(6)
  }, [projects.length])

  const visibleProjects = useMemo(
    () => projects.slice(0, visibleProjectCount),
    [projects, visibleProjectCount]
  )
  const hasMoreProjects = visibleProjects.length < projects.length

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
  const locationDisplay = formatProfileLocationEnglish(profileNorm.location)
  const bioDisplay = strTrim(profileNorm.bio)
  const cur = profileNorm.rates_currency ?? 'EUR'
  const dayRate = profileNorm.day_rate_amount ?? null
  const halfDay = profileNorm.half_day_rate_amount ?? null
  const publicPlanTier = String(
    (profileNorm as Record<string, unknown>).plan_tier ??
      (profileNorm as Record<string, unknown>).subscription_tier ??
      'free'
  )
    .trim()
    .toLowerCase()
  const canShowPublicRates = publicPlanTier !== 'workspace' && publicPlanTier !== 'free'
  const availabilityStatus = strTrim(profileNorm.availability_status)
  const availabilityDetails = strTrim(profileNorm.availability_details)
  const shareMessage = `${name} — view on Crea`
  const viewingOwn = Boolean(authUserId && authUserId === userId)
  const companyAvailabilityInvite =
    Boolean(authUserId) &&
    viewerCanUseAvailabilityInvite &&
    isFreelancer &&
    !viewingOwn &&
    !isCeoProfile(profileNorm.role)

  const scrollContent = (
    <>
        {previewMode ? (
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerTitle}>Public profile</Text>
            <Text style={styles.previewBannerSub}>
              This is how your profile looks to companies and other users — same data as your public link on the web and
              in the app.
            </Text>
          </View>
        ) : null}

        <View style={styles.igHeader}>
          <View style={styles.igTopRow}>
            {showImage ? (
              <Image source={{ uri: avatarUri }} style={styles.igAvatar} />
            ) : (
              <View style={styles.igAvatarPlaceholder}>
                <Text style={styles.igAvatarLetter}>{letter}</Text>
              </View>
            )}
            {isFreelancer && canShowPublicRates && dayRate != null ? (
              <View style={styles.igRateAside}>
                <Text style={styles.igRateLabel}>Day rate</Text>
                <Text style={styles.igRateValue}>{money(dayRate, cur)}</Text>
                {halfDay != null ? (
                  <Text style={styles.igRateSub}>Half day {money(halfDay, cur)}</Text>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.igNameRow}>
            <Text style={styles.igName} numberOfLines={1}>
              {name}
            </Text>
            {locationDisplay ? (
              <Text style={styles.igLocation} numberOfLines={1}>
                {locationDisplay}
              </Text>
            ) : null}
          </View>

          {headlineDisplay ? (
            <View style={styles.yellowPill}>
              <Text style={styles.yellowPillText}>{headlineDisplay}</Text>
            </View>
          ) : null}

          {bioDisplay || (!isFreelancer && !bioDisplay && !headlineDisplay && !locationDisplay) ? (
            <View style={styles.igBio}>
              {bioDisplay ? <Text style={styles.igBioLine}>{bioDisplay}</Text> : null}
              {!bioDisplay && !headlineDisplay && !locationDisplay && !isFreelancer ? (
                <Text style={styles.igBioMuted}>No company description yet.</Text>
              ) : null}
            </View>
          ) : null}

          {(isFreelancer && availabilityStatus) ||
          (isFreelancer && profileNorm.open_to_remote) ||
          (isFreelancer && profileNorm.open_to_travel) ? (
            <View style={styles.igPillRow}>
              {isFreelancer && availabilityStatus ? (
                <View style={[styles.rolePill, styles.availPill]}>
                  <Text style={styles.rolePillText}>{availabilityStatus}</Text>
                </View>
              ) : null}
              {isFreelancer && profileNorm.open_to_remote ? (
                <View style={[styles.rolePill, styles.tagPill]}>
                  <Text style={styles.tagPillText}>REMOTE</Text>
                </View>
              ) : null}
              {isFreelancer && profileNorm.open_to_travel ? (
                <View style={[styles.rolePill, styles.tagPill]}>
                  <Text style={styles.tagPillText}>TRAVEL</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {socials.length > 0 ? (
            <View style={styles.igSocialIconRow}>
              {socials.map((s, i) => (
                <SocialButton key={i} icon={s.icon} url={s.url} accessibilityLabel={s.label} />
              ))}
            </View>
          ) : null}
        </View>

        {!isFreelancer ? (
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
        ) : null}

        {isFreelancer && availabilityDetails ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Availability note</Text>
            <Text style={styles.bio}>{availabilityDetails}</Text>
          </View>
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
            {projects.length > 0 ? (
              <>
                <View style={styles.workGrid}>
                  {visibleProjects.map((proj: PortfolioProject, i: number) => {
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
                {hasMoreProjects ? (
                  <TouchableOpacity
                    onPress={() => setVisibleProjectCount((n) => n + 6)}
                    style={styles.moreProjectsBtn}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.moreProjectsBtnText}>
                      Load more ({projects.length - visibleProjects.length} left)
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <Text style={styles.emptyHint}>No portfolio items yet.</Text>
            )}
          </View>
        ) : projects.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Work</Text>
            <View style={styles.workGrid}>
              {visibleProjects.map((proj: PortfolioProject, i: number) => {
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
            {hasMoreProjects ? (
              <TouchableOpacity
                onPress={() => setVisibleProjectCount((n) => n + 6)}
                style={styles.moreProjectsBtn}
                activeOpacity={0.85}
              >
                <Text style={styles.moreProjectsBtnText}>
                  Load more ({projects.length - visibleProjects.length} left)
                </Text>
              </TouchableOpacity>
            ) : null}
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

        {isFreelancer && previewMode && authUserId && authUserId === userId ? (
          <TouchableOpacity
            style={styles.availabilityPreviewLink}
            onPress={() => router.push('/(tabs)/availability')}
            activeOpacity={0.85}
            accessibilityRole="link"
            accessibilityLabel="Manage availability calendar"
          >
            <Text style={styles.availabilityPreviewLinkText}>Manage availability</Text>
            <ChevronRight size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
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
  scrollPad: { paddingHorizontal: 16, maxWidth: 560, alignSelf: 'center', width: '100%' },
  emptyHint: { fontSize: 14, color: 'rgba(255,255,255,0.38)', lineHeight: 20, fontStyle: 'italic' },
  previewBanner: { marginBottom: 16 },
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
  igHeader: { marginBottom: 16 },
  igTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginBottom: 12,
  },
  igRateAside: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  igRateLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  igRateValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFDC00',
    lineHeight: 26,
  },
  igRateSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
  },
  igAvatar: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#222',
  },
  igAvatarPlaceholder: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#FFDC00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  igAvatarLetter: { fontSize: 34, fontWeight: '900', color: '#0a0a0a' },
  igNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  igName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#fff' },
  igLocation: {
    flexShrink: 1,
    maxWidth: '48%',
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'right',
  },
  igBio: { gap: 2, marginBottom: 8 },
  igBioLine: { fontSize: 14, color: '#fff', lineHeight: 20 },
  igBioMuted: { fontSize: 14, color: 'rgba(255,255,255,0.38)', lineHeight: 20 },
  igPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  yellowPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    backgroundColor: '#FFDC00',
    marginBottom: 8,
  },
  yellowPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0a0a0a',
    letterSpacing: 0.2,
  },
  igSocialIconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  socialBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  block: {
    marginBottom: 22,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 16,
  },
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
  workGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  workTile: {
    width: '32.5%',
    marginBottom: 2,
  },
  workThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 0,
    backgroundColor: '#222',
    marginBottom: 0,
  },
  workThumbPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 0,
    backgroundColor: '#222',
    marginBottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0,
  },
  workThumbLetter: { fontSize: 22, fontWeight: '800', color: 'rgba(255,255,255,0.2)' },
  workTileTitle: { fontSize: 11, fontWeight: '600', color: '#fff', marginTop: 4, paddingHorizontal: 2 },
  workTileSub: { fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1, paddingHorizontal: 2, marginBottom: 6 },
  moreProjectsBtn: {
    marginTop: 8,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#111',
  },
  moreProjectsBtnText: { fontSize: 12, fontWeight: '700', color: '#FFDC00' },
  /** Under public availability calendar on own profile preview only */
  availabilityPreviewLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginTop: 4,
    marginBottom: 2,
    paddingVertical: 6,
  },
  availabilityPreviewLinkText: { fontSize: 13, fontWeight: '700', color: '#FFDC00' },
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

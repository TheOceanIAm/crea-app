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
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  Briefcase,
  Camera,
  ChevronLeft,
  Globe,
  MapPin,
  MessageCircle,
  Palette,
  Share2,
  Video,
} from 'lucide-react-native'
import { CeoPublicProfileView } from '@/components/CeoPublicProfileView'
import { AvailabilityMonthPreview } from '@/components/profile/AvailabilityMonthPreview'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { supabase } from '@/lib/supabase'
import { parseAvailabilityCalendar } from '@/lib/availabilityCalendar'
import { ICON_STROKE } from '@/lib/iconTheme'
import { money } from '@/lib/invoiceFormatting'
import {
  behanceUrl,
  instagramUrl,
  linkedinUrl,
  normalizeExternalUrl,
  vimeoUrl,
} from '@/lib/profilePublicLinks'
import { isCeoProfile, isFreelancerProfile } from '@/lib/profileRole'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'
import { parsePublicProfileWidgets } from '@/lib/publicProfileWidgets'
import { profileShareUrl } from '@/lib/shareLinks'
import { findOrCreateDirectConversation } from '@/lib/directConversation'

type ProfilePayload = {
  id: string
  name: string | null
  role: string | null
  headline: string | null
  location: string | null
  bio: string | null
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
  day_rate_amount?: number | null
  half_day_rate_amount?: number | null
  rates_currency?: string | null
  availability_calendar?: unknown
  availability_status?: string | null
  availability_details?: string | null
  open_to_remote?: boolean | null
  open_to_travel?: boolean | null
  years_experience?: number | null
  public_rating?: number | null
  workspace_projects_count?: number | null
  portfolio_items_count?: number | null
}

function strTrim(v: string | null | undefined): string {
  if (v == null) return ''
  return typeof v === 'string' ? v.trim() : ''
}

function SocialButton({ icon: Icon, url }: { icon: LucideIcon; url: string | null }) {
  if (!url) return null
  return (
    <TouchableOpacity
      style={styles.socialBtn}
      onPress={() => Linking.openURL(url).catch(() => {})}
      accessibilityRole="link"
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

export default function PublicProfileShareScreen() {
  const router = useRouter()
  const { userId } = useLocalSearchParams<{ userId: string }>()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfilePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [portfolioFilter, setPortfolioFilter] = useState<string>('All')
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setAuthUserId(data.user?.id ?? null))
  }, [])

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

  const skills = useMemo(() => (Array.isArray(profile?.skills) ? (profile!.skills as string[]) : []), [profile])
  const equipment = useMemo(
    () => (Array.isArray(profile?.equipment) ? (profile!.equipment as string[]).filter((s) => strTrim(s)) : []),
    [profile]
  )

  /** Web-style filters: unique client labels and role labels (e.g. DOP, Direction). */
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

  const filteredProjects = useMemo(() => {
    if (portfolioFilter === 'All') return projects
    return projects.filter((p) => {
      const c = strTrim(p.client)
      const r = strTrim(p.role)
      return c === portfolioFilter || r === portfolioFilter
    })
  }, [projects, portfolioFilter])

  const calendar = useMemo(
    () => (profile ? parseAvailabilityCalendar(profile.availability_calendar) : parseAvailabilityCalendar(null)),
    [profile]
  )

  const socials = useMemo(() => {
    if (!profile) return []
    const entries = [
      { icon: Globe, url: profile.portfolio_website ? normalizeExternalUrl(profile.portfolio_website) : null },
      { icon: Camera, url: instagramUrl(profile.portfolio_instagram ?? '') },
      { icon: Briefcase, url: linkedinUrl(profile.portfolio_linkedin ?? '') },
      { icon: Video, url: vimeoUrl(profile.portfolio_vimeo ?? '') },
      { icon: Palette, url: behanceUrl(profile.portfolio_behance ?? '') },
    ]
    return entries.filter((x): x is { icon: LucideIcon; url: string } => x.url != null)
  }, [profile])

  const shareUrl = useMemo(() => (userId && typeof userId === 'string' ? profileShareUrl(userId) : null), [userId])

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
  const headlineDisplay = strTrim(profile.headline)
  const locationDisplay = strTrim(profile.location)
  const bioDisplay = strTrim(profile.bio)
  const freelancer = isFreelancerProfile(profile.role)
  const cur = profile.rates_currency ?? 'EUR'
  const dayRate = freelancer ? profile.day_rate_amount ?? null : null
  const halfDay = freelancer ? profile.half_day_rate_amount ?? null : null
  const availabilityStatus = freelancer ? strTrim(profile.availability_status) : ''
  const availabilityDetails = freelancer ? strTrim(profile.availability_details) : ''
  const shareMessage = `${name} — view on Crea`
  const viewingOwn = Boolean(authUserId && userId && typeof userId === 'string' && authUserId === userId)

  const onMessagePress = async () => {
    if (!userId || typeof userId !== 'string') return
    if (!authUserId) {
      router.push('/login')
      return
    }
    if (isCeoProfile(profile.role)) {
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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

      <ShareSheetModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        sheetTitle="Share profile"
        shareMessage={shareMessage}
        shareUrl={shareUrl}
        mailSubject={`Crea profile: ${name}`}
      />

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
          {headlineDisplay ? <Text style={styles.headline}>{headlineDisplay}</Text> : null}
          {locationDisplay ? (
            <View style={styles.locationRow}>
              <MapPin size={16} color="rgba(255,255,255,0.4)" strokeWidth={ICON_STROKE} />
              <Text style={styles.location}>{locationDisplay}</Text>
            </View>
          ) : null}
          <View style={styles.pillRow}>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{roleLabel}</Text>
            </View>
            {availabilityStatus ? (
              <View style={[styles.rolePill, styles.availPill]}>
                <Text style={styles.rolePillText}>{availabilityStatus}</Text>
              </View>
            ) : null}
          </View>
          {freelancer ? (
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>
                  {(profile.workspace_projects_count ?? 0) > 0
                    ? String(profile.workspace_projects_count)
                    : String(profile.portfolio_items_count ?? 0)}
                </Text>
                <Text style={styles.statLabel}>PROJECTS</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>
                  {profile.years_experience != null ? String(profile.years_experience) : '—'}
                </Text>
                <Text style={styles.statLabel}>YEARS</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>
                  {profile.public_rating != null ? String(profile.public_rating) : '—'}
                </Text>
                <Text style={styles.statLabel}>RATING</Text>
              </View>
            </View>
          ) : null}
          {freelancer && (profile.open_to_remote || profile.open_to_travel) ? (
            <View style={[styles.pillRow, styles.pillRowSpaced]}>
              {profile.open_to_remote ? (
                <View style={[styles.rolePill, styles.tagPill]}>
                  <Text style={styles.tagPillText}>OPEN TO REMOTE</Text>
                </View>
              ) : null}
              {profile.open_to_travel ? (
                <View style={[styles.rolePill, styles.tagPill]}>
                  <Text style={styles.tagPillText}>OPEN TO TRAVEL</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {freelancer ? (
            <View style={styles.quickActions}>
              {authUserId && !viewingOwn && !isCeoProfile(profile.role) ? (
                <TouchableOpacity
                  style={styles.quickActionBtn}
                  onPress={() => void onMessagePress()}
                  activeOpacity={0.85}
                >
                  <MessageCircle size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                  <Text style={styles.quickActionText}>Send message</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.quickActionBtn} onPress={() => setShareOpen(true)} activeOpacity={0.85}>
                <Share2 size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.quickActionText}>Share profile</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {freelancer && (dayRate != null || halfDay != null) ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Rates</Text>
            {dayRate != null ? (
              <Text style={styles.rateMain}>
                {money(dayRate, cur)} <Text style={styles.ratePer}>per day</Text>
              </Text>
            ) : null}
            {halfDay != null ? (
              <Text style={styles.rateSub}>
                Half day: {money(halfDay, cur)}
              </Text>
            ) : null}
          </View>
        ) : null}

        {freelancer && availabilityDetails ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Availability note</Text>
            <Text style={styles.bio}>{availabilityDetails}</Text>
          </View>
        ) : null}

        {freelancer ? <AvailabilityMonthPreview calendar={calendar} anchor={new Date()} /> : null}

        {bioDisplay ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>About</Text>
            <Text style={styles.bio}>{bioDisplay}</Text>
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

        {freelancer && equipment.length > 0 ? (
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

        {socials.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Links</Text>
            <View style={styles.socialRow}>
              {socials.map((s, i) => (
                <SocialButton key={i} icon={s.icon} url={s.url} />
              ))}
            </View>
          </View>
        ) : null}

        {filteredProjects.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Work</Text>
            {workFilterTags.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterScroll}
                style={styles.filterBar}
              >
                <TouchableOpacity
                  onPress={() => setPortfolioFilter('All')}
                  style={[styles.filterChip, portfolioFilter === 'All' && styles.filterChipOn]}
                >
                  <Text style={[styles.filterChipText, portfolioFilter === 'All' && styles.filterChipTextOn]}>All</Text>
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
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  location: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
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

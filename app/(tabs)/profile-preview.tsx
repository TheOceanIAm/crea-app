import { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  Linking,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { router } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  Briefcase,
  Camera,
  ChevronLeft,
  Eye,
  Globe,
  MapPin,
  Palette,
  Share2,
  Video,
} from 'lucide-react-native'
import { CeoPublicProfileView } from '@/components/CeoPublicProfileView'
import { ShareSheetModal } from '@/components/ShareSheetModal'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile } from '@/lib/profileRole'
import type { PublicProfileWidgets } from '@/lib/publicProfileWidgets'
import { parsePublicProfileWidgets } from '@/lib/publicProfileWidgets'
import { profileShareUrl } from '@/lib/shareLinks'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'

const TAB_BAR_HEIGHT = 80

type ProfilePublic = {
  name: string
  role: string
  headline: string
  location: string
  bio: string
  avatarUrl: string
  skills: string[]
  equipment: string[]
  website: string
  instagram: string
  linkedin: string
  vimeo: string
  behance: string
  projects: PortfolioProject[]
  widgets: PublicProfileWidgets
}

function normalizeExternalUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`
  return `https://${t.replace(/^\/+/, '')}`
}

function instagramUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  const h = t.startsWith('@') ? t.slice(1) : t
  if (!h) return null
  return `https://instagram.com/${h.replace(/^@/, '')}`
}

function linkedinUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://linkedin.com/in/${t.replace(/^\/+/, '')}`
}

function vimeoUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://vimeo.com/${t.replace(/^\/+/, '')}`
}

function behanceUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://behance.net/${t.replace(/^\/+/, '')}`
}

function PreviewChip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  )
}

function SocialButton({
  icon: Icon,
  url,
}: {
  icon: LucideIcon
  url: string | null
}) {
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

export default function ProfilePreviewScreen() {
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [p, setP] = useState<ProfilePublic | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAuthUserId(null)
      setLoading(false)
      router.replace('/login')
      return
    }
    setAuthUserId(user.id)

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'name, role, headline, location, bio, avatar_url, skills, equipment, portfolio_website, portfolio_instagram, portfolio_linkedin, portfolio_vimeo, portfolio_behance, portfolio_projects, public_profile_widgets'
      )
      .eq('id', user.id)
      .single()

    if (error || !data) {
      setP(null)
      setLoading(false)
      return
    }

    setP({
      name: data.name ?? '',
      role: data.role ?? '',
      headline: data.headline ?? '',
      location: data.location ?? '',
      bio: data.bio ?? '',
      avatarUrl: data.avatar_url ?? '',
      skills: Array.isArray(data.skills) ? data.skills : [],
      equipment: Array.isArray(data.equipment) ? data.equipment : [],
      website: data.portfolio_website ?? '',
      instagram: data.portfolio_instagram ?? '',
      linkedin: data.portfolio_linkedin ?? '',
      vimeo: data.portfolio_vimeo ?? '',
      behance: data.portfolio_behance ?? '',
      projects: parsePortfolioProjects(data.portfolio_projects),
      widgets: parsePublicProfileWidgets(
        (data as { public_profile_widgets?: unknown }).public_profile_widgets
      ),
    })
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const avatarUri = p?.avatarUrl?.trim() ?? ''
  const showImage = /^https?:\/\//i.test(avatarUri)
  const letter = (p?.name || '?').trim().charAt(0).toUpperCase() || '?'

  const profilePublicUrl = useMemo(
    () => (authUserId ? profileShareUrl(authUserId) : null),
    [authUserId]
  )
  const profileCardMessage = useMemo(
    () => `${(p?.name || '').trim() || 'My Crea profile'} — view my profile on Crea`,
    [p?.name]
  )

  const socials = useMemo(() => {
    if (!p) return []
    const entries = [
      { icon: Globe, url: normalizeExternalUrl(p.website) },
      { icon: Camera, url: instagramUrl(p.instagram) },
      { icon: Briefcase, url: linkedinUrl(p.linkedin) },
      { icon: Video, url: vimeoUrl(p.vimeo) },
      { icon: Palette, url: behanceUrl(p.behance) },
    ]
    return entries.filter((x): x is { icon: LucideIcon; url: string } => x.url != null)
  }, [p])

  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 24

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!p) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Profile not loaded</Text>
          <Text style={styles.emptySub}>Check settings or run the SQL migrations.</Text>
        </View>
      </SafeAreaView>
    )
  }

  const freelancer = isFreelancerProfile(p.role)
  const company = isCompanyProfile(p.role)
  const ceo = isCeoProfile(p.role)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.topBarRight}>
          {(freelancer || ceo) && authUserId ? (
            <TouchableOpacity
              style={styles.shareIconBtn}
              onPress={() => setShareOpen(true)}
              hitSlop={12}
              accessibilityLabel="Share profile"
            >
              <Share2 size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.previewBadge}>
            <Eye size={14} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.previewBadgeText}>Preview</Text>
          </View>
        </View>
      </View>

      <ShareSheetModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        sheetTitle="Share profile"
        shareMessage={profileCardMessage}
        shareUrl={profilePublicUrl}
        mailSubject={`Crea profile: ${(p.name || '').trim() || 'Freelancer'}`}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>{ceo ? 'Public CEO profile' : 'Public profile'}</Text>
          <Text style={styles.bannerSub}>
            {ceo
              ? 'This is how your public CEO page looks to visitors. Direct messages to you stay one-way: you can message users from the app; they cannot start a chat with you.'
              : `This is how your profile looks to ${freelancer ? 'companies and other users' : 'freelancers and visitors'}.`}
          </Text>
        </View>

        {ceo ? (
          <CeoPublicProfileView
            name={p.name.trim() || 'Crea'}
            headline={p.headline}
            location={p.location}
            bio={p.bio}
            avatarUrl={avatarUri}
            widgets={p.widgets}
          />
        ) : (
          <View style={styles.heroCard}>
            {showImage ? (
              <Image source={{ uri: avatarUri }} style={styles.heroAvatar} />
            ) : (
              <View style={styles.heroAvatarPlaceholder}>
                <Text style={styles.heroLetter}>{letter}</Text>
              </View>
            )}
            <Text style={styles.heroName}>{p.name.trim() || 'Unnamed'}</Text>
            {p.headline.trim() ? <Text style={styles.heroHeadline}>{p.headline.trim()}</Text> : null}
            {p.location.trim() ? (
              <View style={styles.locationRow}>
                <MapPin size={16} color="rgba(255,255,255,0.4)" strokeWidth={ICON_STROKE} />
                <Text style={styles.heroLocation}>{p.location.trim()}</Text>
              </View>
            ) : null}
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{company ? 'Company' : 'Freelancer'}</Text>
            </View>
          </View>
        )}

        {!ceo && p.bio.trim() ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>About</Text>
            <Text style={styles.bioText}>{p.bio.trim()}</Text>
          </View>
        ) : null}

        {!ceo && freelancer && p.skills.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Skills</Text>
            <View style={styles.chipRow}>
              {p.skills.map((s) => (
                <PreviewChip key={s} label={s} />
              ))}
            </View>
          </View>
        ) : null}

        {!ceo && freelancer && p.equipment.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Equipment &amp; credentials</Text>
            <View style={styles.chipRow}>
              {p.equipment.map((s) => (
                <PreviewChip key={s} label={s} />
              ))}
            </View>
          </View>
        ) : null}

        {!ceo && socials.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Links</Text>
            <View style={styles.socialRow}>
              {socials.map((s, i) => (
                <SocialButton key={i} icon={s.icon} url={s.url} />
              ))}
            </View>
          </View>
        ) : null}

        {!ceo && freelancer && p.projects.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Portfolio</Text>
            {p.projects.map((proj, i) => {
              const projUrl = normalizeExternalUrl(proj.link)
              return (
                <View key={`${proj.title}-${i}`} style={styles.projectCard}>
                  <Text style={styles.projectTitle}>{proj.title}</Text>
                  {proj.client.trim() ? (
                    <Text style={styles.projectClient}>{proj.client.trim()}</Text>
                  ) : null}
                  {projUrl ? (
                    <TouchableOpacity onPress={() => Linking.openURL(projUrl).catch(() => {})}>
                      <Text style={styles.projectLink}>View link →</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )
            })}
          </View>
        ) : null}

        {ceo ? null : !p.bio.trim() &&
        !p.headline.trim() &&
        !p.location.trim() &&
        p.skills.length === 0 &&
        p.equipment.length === 0 &&
        socials.length === 0 &&
        p.projects.length === 0 ? (
          <View style={styles.hintCard}>
            <Text style={styles.hintText}>
              Your public profile still looks empty. Add a bio, skills, and links under Settings → Profile / Portfolio.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
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
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  banner: { marginBottom: 20 },
  bannerTitle: { fontSize: 11, fontWeight: '800', color: '#FFDC00', letterSpacing: 2, marginBottom: 6 },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.38)', lineHeight: 19 },
  heroCard: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  heroAvatar: { width: 96, height: 96, borderRadius: 48, marginBottom: 14, backgroundColor: '#222' },
  heroAvatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFDC00',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroLetter: { fontSize: 40, fontWeight: '900', color: '#0a0a0a' },
  heroName: { fontSize: 24, fontWeight: '900', color: '#ffffff', textAlign: 'center' },
  heroHeadline: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  heroLocation: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
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
  bioText: { fontSize: 15, color: 'rgba(255,255,255,0.82)', lineHeight: 24 },
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
  socialRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  socialBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    backgroundColor: 'rgba(255,220,0,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectCard: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  projectTitle: { fontSize: 16, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  projectClient: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 8 },
  projectLink: { fontSize: 14, fontWeight: '600', color: '#FFDC00' },
  hintCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.15)',
  },
  hintText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  emptySub: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
})

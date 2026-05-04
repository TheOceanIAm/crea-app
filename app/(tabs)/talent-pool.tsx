import { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
  Alert,
  TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { ChevronLeft, MapPin, Star } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { isFreelancerTalentPoolPlan, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'
import { ICON_STROKE } from '@/lib/iconTheme'

type TalentRow = {
  id: string
  name: string
  headline: string
  location: string
  avatarUrl: string | null
  role: string | null
  skills: string[]
}

type FreelancerDirectoryRow = {
  id: string
  location: string | null
  plan_tier: string | null
}

function initial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

function normalizeSkillTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

function rowMatchesSkillsQuery(row: TalentRow, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const skillHay = row.skills.map((s) => s.toLowerCase()).join(' ')
  const headlineHay = row.headline.toLowerCase()
  return tokens.every((tok) => skillHay.includes(tok) || headlineHay.includes(tok))
}

export default function TalentPoolScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [showFavoriteUi, setShowFavoriteUi] = useState(false)
  const [rows, setRows] = useState<TalentRow[]>([])
  const [favoriteProfileIds, setFavoriteProfileIds] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [skillsQuery, setSkillsQuery] = useState('')
  const [listFilter, setListFilter] = useState<'all' | 'favorites'>('all')
  const [meId, setMeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      router.replace('/login')
      return
    }
    setMeId(user.id)
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = resolveAppRole(p?.role, user)
    const plan = resolveFreelancerPlanFromUser(user)
    const canViewTalentPool =
      isCompanyProfile(role) ||
      isCeoProfile(role) ||
      (isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan))
    if (!canViewTalentPool) {
      setAllowed(false)
      setShowFavoriteUi(false)
      setFavoriteProfileIds([])
      setRows([])
      setLoading(false)
      return
    }
    setAllowed(true)
    const favUi = isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan)
    setShowFavoriteUi(favUi)

    let favIds: string[] = []
    if (favUi) {
      try {
        const { data: favRows, error: favErr } = await supabase
          .from('talent_pool_favorites')
          .select('favorite_profile_id')
          .eq('owner_id', user.id)
        if (!favErr && favRows) {
          favIds = favRows
            .map((r) => String((r as { favorite_profile_id?: string }).favorite_profile_id ?? '').trim())
            .filter(Boolean)
        }
      } catch {
        /* table may not exist until SQL is deployed */
      }
      setFavoriteProfileIds(favIds)
    } else {
      setFavoriteProfileIds([])
    }

    const { data: fpRows, error: fpErr } = await supabase
      .from('freelancer_profiles')
      .select('id, location, plan_tier')
      .neq('plan_tier', 'workspace')
      .limit(240)

    if (fpErr) {
      setLoadError(fpErr.message)
      setRows([])
    } else {
      const candidates = (fpRows ?? []) as unknown as FreelancerDirectoryRow[]
      const ids = [
        ...new Set(
          candidates
            .map((r) => (typeof r.id === 'string' ? r.id.trim() : ''))
            .filter((x) => x.length > 0)
        ),
      ]
      if (ids.length === 0) {
        setRows([])
        setLoading(false)
        return
      }
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, name, headline, location, avatar_url, role, skills')
        .in('id', ids)
        .neq('role', 'company')
        .neq('role', 'ceo')
        .order('name', { ascending: true })
      if (pErr) {
        setLoadError(pErr.message)
        setRows([])
      } else {
        const fpById = new Map<string, FreelancerDirectoryRow>()
        for (const fp of candidates) {
          if (typeof fp.id === 'string' && fp.id.trim()) fpById.set(fp.id.trim(), fp)
        }
        setRows(
          (profiles ?? []).map((r) => {
            const id = String(r.id)
            const fp = fpById.get(id)
            const url = (r.avatar_url as string | null)?.trim()
            const profileLoc = String(r.location ?? '').trim()
            const fpLoc = fp?.location ? String(fp.location).trim() : ''
            const rawSkills = (r as { skills?: unknown }).skills
            const skills = Array.isArray(rawSkills)
              ? rawSkills.map((x) => String(x ?? '').trim()).filter(Boolean)
              : []
            return {
              id,
              name: String(r.name ?? '').trim() || 'Freelancer',
              headline: String(r.headline ?? '').trim(),
              location: profileLoc || fpLoc,
              avatarUrl: url && /^https?:\/\//i.test(url) ? url : null,
              role: typeof r.role === 'string' ? r.role : null,
              skills,
            }
          })
        )
      }
    }
    setLoading(false)
  }, [router])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const skillsTokens = useMemo(() => normalizeSkillTokens(skillsQuery), [skillsQuery])

  const displayRows = useMemo(() => {
    let out = rows.filter((r) => rowMatchesSkillsQuery(r, skillsTokens))
    if (listFilter === 'favorites' && showFavoriteUi) {
      const set = new Set(favoriteProfileIds)
      out = out.filter((r) => set.has(r.id))
    }
    return out
  }, [rows, skillsTokens, listFilter, favoriteProfileIds, showFavoriteUi])

  const toggleFavorite = useCallback(
    async (profileId: string) => {
      if (!meId || !showFavoriteUi) return
      const isFav = favoriteProfileIds.includes(profileId)
      try {
        if (isFav) {
          const { error } = await supabase
            .from('talent_pool_favorites')
            .delete()
            .eq('owner_id', meId)
            .eq('favorite_profile_id', profileId)
          if (error) throw error
          setFavoriteProfileIds((prev) => prev.filter((id) => id !== profileId))
        } else {
          const { error } = await supabase.from('talent_pool_favorites').insert({
            owner_id: meId,
            favorite_profile_id: profileId,
          })
          if (error) throw error
          setFavoriteProfileIds((prev) => [...prev, profileId])
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not update favorite'
        Alert.alert('Favorites', msg)
      }
    },
    [meId, showFavoriteUi, favoriteProfileIds]
  )

  if (allowed === null || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.blockTitle}>Talent pool</Text>
          <Text style={styles.blockSub}>
            Only available for Pro users. Upgrade to browse freelancers, save favorites, and filter by skills.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Dashboard</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Talent pool</Text>
      <Text style={styles.subtitle}>Freelancers on Crea — open a public profile to learn more.</Text>

      {rows.length > 0 ? (
        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>Show</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, listFilter === 'all' && styles.chipOn]}
              onPress={() => setListFilter('all')}
            >
              <Text style={[styles.chipText, listFilter === 'all' && styles.chipTextOn]}>All</Text>
            </TouchableOpacity>
            {showFavoriteUi ? (
              <TouchableOpacity
                style={[styles.chip, listFilter === 'favorites' && styles.chipOn]}
                onPress={() => setListFilter('favorites')}
              >
                <Text style={[styles.chipText, listFilter === 'favorites' && styles.chipTextOn]}>Favorites</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
          <Text style={[styles.filterLabel, { marginTop: 10 }]}>Skills</Text>
          <TextInput
            style={styles.searchInput}
            value={skillsQuery}
            onChangeText={setSkillsQuery}
            placeholder="e.g. color, motion, gaffer"
            placeholderTextColor="rgba(255,255,255,0.28)"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{loadError}</Text>
          <Text style={styles.bannerHint}>
            If this persists, run the SQL in <Text style={styles.mono}>supabase/sql/talent_pool_select_policies.sql</Text>{' '}
            and <Text style={styles.mono}>talent_pool_favorites.sql</Text> on your project.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={displayRows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !loadError ? (
            <Text style={styles.empty}>
              {rows.length === 0
                ? 'No freelancers found yet.'
                : listFilter === 'favorites'
                  ? 'No favorites match this search.'
                  : skillsTokens.length > 0
                    ? 'No freelancers match these skills.'
                    : 'No freelancers match these filters.'}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const isFav = favoriteProfileIds.includes(item.id)
          return (
            <View style={styles.cardRow}>
              <TouchableOpacity
                style={styles.cardMain}
                activeOpacity={0.75}
                onPress={() => router.push(`/profile/${item.id}` as Href)}
              >
                <View style={styles.avatarWrap}>
                  {item.avatarUrl ? (
                    <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPh}>
                      <Text style={styles.avatarLetter}>{initial(item.name)}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.meta}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.headline ? (
                    <Text style={styles.headline} numberOfLines={1}>
                      {item.headline}
                    </Text>
                  ) : null}
                  {item.location ? (
                    <View style={styles.locRow}>
                      <MapPin size={12} color="rgba(255,255,255,0.35)" strokeWidth={ICON_STROKE} />
                      <Text style={styles.location} numberOfLines={1}>
                        {item.location}
                      </Text>
                    </View>
                  ) : null}
                  {item.role ? (
                    <Text style={styles.rolePill} numberOfLines={1}>
                      {item.role}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
              {showFavoriteUi ? (
                <TouchableOpacity
                  style={styles.starBtn}
                  onPress={() => void toggleFavorite(item.id)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel={isFav ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star
                    size={22}
                    color="#FFDC00"
                    strokeWidth={ICON_STROKE}
                    fill={isFav ? '#FFDC00' : 'transparent'}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 20, paddingTop: 8 },
  backText: { fontSize: 16, fontWeight: '600', color: '#FFDC00' },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#ffffff',
    paddingHorizontal: 20,
    marginTop: 8,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 20,
    marginTop: 6,
    marginBottom: 8,
    lineHeight: 18,
  },
  filterBlock: { paddingHorizontal: 20, marginBottom: 8 },
  filterLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111',
  },
  chipOn: { borderColor: '#FFDC00', backgroundColor: 'rgba(255,220,0,0.12)' },
  chipText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  chipTextOn: { color: '#FFDC00' },
  searchInput: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#fff',
  },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minWidth: 0 },
  starBtn: { paddingHorizontal: 12, paddingVertical: 14 },
  avatarWrap: {},
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#222' },
  avatarPh: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '800', color: '#FFDC00' },
  meta: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 2 },
  headline: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 4 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  location: { fontSize: 12, color: 'rgba(255,255,255,0.3)', flex: 1 },
  rolePill: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,220,0,0.85)',
    textTransform: 'capitalize',
  },
  empty: { color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 40 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center' },
  banner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  bannerText: { fontSize: 13, color: 'rgba(255,200,200,0.95)', marginBottom: 6 },
  bannerHint: { fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 16 },
  mono: { fontFamily: 'monospace', fontSize: 11, color: '#FFDC00' },
})

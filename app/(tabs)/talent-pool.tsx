import { useCallback, useMemo, useRef, useState } from 'react'
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
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { ChevronLeft, MapPin, Star } from 'lucide-react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { isCeoProfile, isCompanyProfile, isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { isFreelancerTalentPoolPlan, resolveFreelancerPlanFromUserAndProfileTier } from '@/lib/freelancerPlan'
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

type Folder = {
  id: string
  name: string
  profileIds: string[]
}

const foldersStorageKey = (uid: string) => `crea_app_talent_pool_folders_v1:${uid}`
const FOLDERS_TABLE = 'talent_pool_folders'

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

async function loadFreelancerDirectoryRows(options: { excludeUserId: string; maxRows?: number; pageSize?: number }) {
  const maxRows = options.maxRows ?? 5000
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 500, maxRows))
  const out: FreelancerDirectoryRow[] = []
  let offset = 0

  while (out.length < maxRows) {
    const end = Math.min(offset + pageSize - 1, maxRows - 1)
    const { data, error } = await supabase
      .from('freelancer_profiles')
      .select('id, location, plan_tier')
      .neq('id', options.excludeUserId)
      .range(offset, end)
    if (error) return { rows: [] as FreelancerDirectoryRow[], error: error.message }
    const chunk = (data ?? []) as unknown as FreelancerDirectoryRow[]
    out.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }

  return { rows: out, error: null as string | null }
}

export default function TalentPoolScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [showFavoriteUi, setShowFavoriteUi] = useState(false)
  const [favoriteMode, setFavoriteMode] = useState<'company' | 'freelancer' | null>(null)
  const [rows, setRows] = useState<TalentRow[]>([])
  const [favoriteProfileIds, setFavoriteProfileIds] = useState<string[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [skillsQuery, setSkillsQuery] = useState('')
  const [listFilter, setListFilter] = useState<'all' | 'favorites'>('all')
  const [meId, setMeId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const realtimeReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    const { data: p } = await supabase.from('profiles').select('role, subscription_tier').eq('id', user.id).single()
    const role = resolveAppRole(p?.role, user)
    const plan = resolveFreelancerPlanFromUserAndProfileTier(user, p?.subscription_tier)
    const canViewTalentPool =
      isCompanyProfile(role) ||
      isCeoProfile(role) ||
      (isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan))
    if (!canViewTalentPool) {
      setAllowed(false)
      setShowFavoriteUi(false)
      setFavoriteMode(null)
      setFavoriteProfileIds([])
      setFolders([])
      setRows([])
      setLoading(false)
      return
    }
    setAllowed(true)
    const favUi = isCompanyProfile(role) || (isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan))
    setShowFavoriteUi(favUi)
    const mode: 'company' | 'freelancer' | null = isCompanyProfile(role)
      ? 'company'
      : isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan)
        ? 'freelancer'
        : null
    setFavoriteMode(mode)

    let favIds: string[] = []
    if (favUi) {
      try {
        if (mode === 'company') {
          const { data: favRows, error: favErr } = await supabase
            .from('pool_saves')
            .select('freelancer_id')
            .eq('company_id', user.id)
          if (!favErr && favRows) {
            favIds = favRows
              .map((r) => String((r as { freelancer_id?: string }).freelancer_id ?? '').trim())
              .filter(Boolean)
          }
        } else {
          const { data: favRows, error: favErr } = await supabase
            .from('talent_pool_favorites')
            .select('favorite_profile_id')
            .eq('owner_id', user.id)
          if (!favErr && favRows) {
            favIds = favRows
              .map((r) => String((r as { favorite_profile_id?: string }).favorite_profile_id ?? '').trim())
              .filter(Boolean)
          }
        }
      } catch {
        /* table may not exist until SQL is deployed */
      }
      setFavoriteProfileIds(favIds)
      try {
        const raw = await AsyncStorage.getItem(foldersStorageKey(user.id))
        let localFolders: Folder[] = []
        if (raw) {
          const parsed = JSON.parse(raw) as Folder[]
          localFolders = (Array.isArray(parsed) ? parsed : [])
            .filter((f) => typeof f?.id === 'string' && typeof f?.name === 'string')
            .map((f) => ({
              id: f.id,
              name: f.name,
              profileIds: Array.isArray(f.profileIds) ? f.profileIds.map((x) => String(x)).filter(Boolean) : [],
            }))
        }
        // Optional cross-device sync: if table exists, prefer remote copy.
        try {
          const { data: remoteRows, error: remoteErr } = await supabase
            .from(FOLDERS_TABLE)
            .select('id,name,position,profile_ids')
            .eq('owner_id', user.id)
            .order('position', { ascending: true })
          if (!remoteErr && Array.isArray(remoteRows)) {
            const remoteFolders: Folder[] = remoteRows
              .filter((r) => typeof r?.id === 'string' && typeof r?.name === 'string')
              .map((r) => ({
                id: String(r.id),
                name: String(r.name),
                profileIds: Array.isArray((r as { profile_ids?: unknown }).profile_ids)
                  ? ((r as { profile_ids?: unknown[] }).profile_ids ?? []).map((x) => String(x)).filter(Boolean)
                  : [],
              }))
            if (remoteFolders.length > 0 || localFolders.length === 0) {
              localFolders = remoteFolders
            }
          }
        } catch {
          // Table missing is fine; local-only remains active.
        }
        setFolders(localFolders)
      } catch {
        setFolders([])
      }
    } else {
      setFavoriteProfileIds([])
      setFolders([])
    }

    const { rows: fpRows, error: fpErr } = await loadFreelancerDirectoryRows({
      excludeUserId: user.id,
      maxRows: 5000,
      pageSize: 500,
    })

    if (fpErr) {
      setLoadError(fpErr)
      setRows([])
    } else {
      const candidates = (fpRows ?? []).filter((r) => String(r.plan_tier ?? '').trim().toLowerCase() !== 'workspace')
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
      const profilesOut: Array<Record<string, unknown>> = []
      const chunkSize = 100
      let profilesErr: string | null = null
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize)
        const { data: profileChunk, error: pErr } = await supabase
          .from('profiles')
          .select('id, name, headline, location, avatar_url, role, skills')
          .in('id', chunk)
          .neq('role', 'company')
          .neq('role', 'ceo')
          .order('name', { ascending: true })
        if (pErr) {
          profilesErr = pErr.message
          break
        }
        profilesOut.push(...((profileChunk ?? []) as Array<Record<string, unknown>>))
      }

      if (profilesErr) {
        setLoadError(profilesErr)
        setRows([])
      } else {
        const fpById = new Map<string, FreelancerDirectoryRow>()
        for (const fp of candidates) {
          if (typeof fp.id === 'string' && fp.id.trim()) fpById.set(fp.id.trim(), fp)
        }
        setRows(
          profilesOut.map((r) => {
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  useFocusEffect(
    useCallback(() => {
      const scheduleReload = () => {
        if (realtimeReloadTimerRef.current) clearTimeout(realtimeReloadTimerRef.current)
        realtimeReloadTimerRef.current = setTimeout(() => {
          void load()
          realtimeReloadTimerRef.current = null
        }, 450)
      }

      const channel = supabase
        .channel('talent-pool-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'freelancer_profiles' },
          scheduleReload
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles', filter: 'role=eq.freelancer' },
          scheduleReload
        )
        .subscribe()

      return () => {
        if (realtimeReloadTimerRef.current) {
          clearTimeout(realtimeReloadTimerRef.current)
          realtimeReloadTimerRef.current = null
        }
        void supabase.removeChannel(channel)
      }
    }, [load])
  )

  const skillsTokens = useMemo(() => normalizeSkillTokens(skillsQuery), [skillsQuery])

  const displayRows = useMemo(() => {
    let out = rows.filter((r) => rowMatchesSkillsQuery(r, skillsTokens))
    if (listFilter === 'favorites' && showFavoriteUi) {
      const set = new Set(favoriteProfileIds)
      out = out.filter((r) => set.has(r.id))
      if (activeFolderId) {
        const folder = folders.find((f) => f.id === activeFolderId)
        const folderSet = new Set(folder?.profileIds ?? [])
        out = out.filter((r) => folderSet.has(r.id))
      }
    }
    return out
  }, [rows, skillsTokens, listFilter, favoriteProfileIds, showFavoriteUi, activeFolderId, folders])

  const persistFolders = useCallback(
    async (nextFolders: Folder[]) => {
      if (!meId) return
      await AsyncStorage.setItem(foldersStorageKey(meId), JSON.stringify(nextFolders))
      // Optional sync: no-op when table doesn't exist.
      try {
        await supabase.from(FOLDERS_TABLE).delete().eq('owner_id', meId)
        if (nextFolders.length > 0) {
          const payload = nextFolders.map((f, idx) => ({
            owner_id: meId,
            id: f.id,
            name: f.name,
            position: idx,
            profile_ids: f.profileIds,
          }))
          await supabase.from(FOLDERS_TABLE).upsert(payload, { onConflict: 'owner_id,id' })
        }
      } catch {
        // Keep local behavior if remote sync isn't available.
      }
    },
    [meId]
  )

  const toggleFavorite = useCallback(
    async (profileId: string) => {
      if (!meId || !showFavoriteUi) return
      const isFav = favoriteProfileIds.includes(profileId)
      try {
        if (isFav) {
          const { error } =
            favoriteMode === 'company'
              ? await supabase.from('pool_saves').delete().eq('company_id', meId).eq('freelancer_id', profileId)
              : await supabase
                  .from('talent_pool_favorites')
                  .delete()
                  .eq('owner_id', meId)
                  .eq('favorite_profile_id', profileId)
          if (error) throw error
          setFavoriteProfileIds((prev) => prev.filter((id) => id !== profileId))
          const nextFolders = folders.map((f) => ({ ...f, profileIds: f.profileIds.filter((id) => id !== profileId) }))
          setFolders(nextFolders)
          void persistFolders(nextFolders)
        } else {
          const { error } =
            favoriteMode === 'company'
              ? await supabase.from('pool_saves').upsert(
                  { company_id: meId, freelancer_id: profileId },
                  { onConflict: 'company_id,freelancer_id' }
                )
              : await supabase.from('talent_pool_favorites').insert({
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
    [meId, showFavoriteUi, favoriteProfileIds, favoriteMode, folders, persistFolders]
  )

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name || !meId) return
    const nextFolders = [...folders, { id: `${Date.now()}`, name, profileIds: [] }]
    setFolders(nextFolders)
    setNewFolderName('')
    setShowNewFolderInput(false)
    await persistFolders(nextFolders)
  }, [folders, newFolderName, meId, persistFolders])

  const renameFolder = useCallback(async () => {
    const name = renameFolderName.trim()
    if (!name || !renamingFolderId) return
    const nextFolders = folders.map((f) => (f.id === renamingFolderId ? { ...f, name } : f))
    setFolders(nextFolders)
    setRenamingFolderId(null)
    setRenameFolderName('')
    await persistFolders(nextFolders)
  }, [folders, renameFolderName, renamingFolderId, persistFolders])

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const nextFolders = folders.filter((f) => f.id !== folderId)
      setFolders(nextFolders)
      if (activeFolderId === folderId) setActiveFolderId(null)
      await persistFolders(nextFolders)
    },
    [folders, activeFolderId, persistFolders]
  )

  const moveFolder = useCallback(
    async (folderId: string, dir: -1 | 1) => {
      const idx = folders.findIndex((f) => f.id === folderId)
      const to = idx + dir
      if (idx < 0 || to < 0 || to >= folders.length) return
      const next = [...folders]
      const [item] = next.splice(idx, 1)
      next.splice(to, 0, item)
      setFolders(next)
      await persistFolders(next)
    },
    [folders, persistFolders]
  )

  const toggleFolderMembership = useCallback(
    async (folderId: string, profileId: string) => {
      const nextFolders = folders.map((f) => {
        if (f.id !== folderId) return f
        const has = f.profileIds.includes(profileId)
        return { ...f, profileIds: has ? f.profileIds.filter((id) => id !== profileId) : [...f.profileIds, profileId] }
      })
      setFolders(nextFolders)
      await persistFolders(nextFolders)
    },
    [folders, persistFolders]
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
          {showFavoriteUi ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.filterLabel}>Folders</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, activeFolderId === null && styles.chipOn]}
                  onPress={() => setActiveFolderId(null)}
                >
                  <Text style={[styles.chipText, activeFolderId === null && styles.chipTextOn]}>All folders</Text>
                </TouchableOpacity>
                {folders.map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.chip, activeFolderId === f.id && styles.chipOn]}
                    onPress={() => setActiveFolderId((prev) => (prev === f.id ? null : f.id))}
                  >
                    <Text style={[styles.chipText, activeFolderId === f.id && styles.chipTextOn]}>
                      {f.name} ({f.profileIds.length})
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.chip} onPress={() => setShowNewFolderInput((v) => !v)}>
                  <Text style={styles.chipText}>+ New folder</Text>
                </TouchableOpacity>
              </ScrollView>
              {showNewFolderInput ? (
                <View style={{ marginTop: 8, flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.searchInput, { flex: 1 }]}
                    value={newFolderName}
                    onChangeText={setNewFolderName}
                    placeholder="Folder name"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                  />
                  <TouchableOpacity style={styles.chipOn} onPress={() => void createFolder()}>
                    <Text style={[styles.chipTextOn, { paddingHorizontal: 12, paddingVertical: 10 }]}>Create</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {folders.length > 0 ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {folders.map((f, i) => (
                    <View key={`manage:${f.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {renamingFolderId === f.id ? (
                        <>
                          <TextInput
                            style={[styles.searchInput, { flex: 1, paddingVertical: 8 }]}
                            value={renameFolderName}
                            onChangeText={setRenameFolderName}
                            placeholder="Rename folder"
                            placeholderTextColor="rgba(255,255,255,0.28)"
                          />
                          <TouchableOpacity style={styles.chipOn} onPress={() => void renameFolder()}>
                            <Text style={[styles.chipTextOn, { paddingHorizontal: 10, paddingVertical: 8 }]}>Save</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <Text style={[styles.chipText, { flex: 1 }]} numberOfLines={1}>
                            {f.name}
                          </Text>
                          <TouchableOpacity style={styles.chip} onPress={() => moveFolder(f.id, -1)} disabled={i === 0}>
                            <Text style={styles.chipText}>↑</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.chip} onPress={() => moveFolder(f.id, 1)} disabled={i === folders.length - 1}>
                            <Text style={styles.chipText}>↓</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.chip}
                            onPress={() => {
                              setRenamingFolderId(f.id)
                              setRenameFolderName(f.name)
                            }}
                          >
                            <Text style={styles.chipText}>Rename</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.chip} onPress={() => void deleteFolder(f.id)}>
                            <Text style={styles.chipText}>Delete</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#FFDC00" />}
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
                <View style={{ alignItems: 'flex-end', paddingVertical: 8 }}>
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
                  {isFav && folders.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
                      {folders.map((f) => {
                        const inFolder = f.profileIds.includes(item.id)
                        return (
                          <TouchableOpacity
                            key={`${item.id}:${f.id}`}
                            style={[styles.chip, inFolder && styles.chipOn, { paddingVertical: 5, paddingHorizontal: 10 }]}
                            onPress={() => void toggleFolderMembership(f.id, item.id)}
                          >
                            <Text style={[styles.chipText, inFolder && styles.chipTextOn]} numberOfLines={1}>
                              {f.name}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </ScrollView>
                  ) : null}
                </View>
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
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
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

import AsyncStorage from '@react-native-async-storage/async-storage'
import { getCache, setCache } from '@/lib/appCache'
import { getAuthUser } from '@/lib/getAuthUser'
import {
  isCeoProfile,
  isCompanyProfile,
  isFreelancerProfile,
  resolveAppRole,
} from '@/lib/profileRole'
import {
  isFreelancerTalentPoolPlan,
  resolveFreelancerPlanFromUserAndProfileTier,
} from '@/lib/freelancerPlan'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { supabase } from '@/lib/supabase'
import { resolveProfileDisplayName } from '@/lib/resolveProfileDisplayName'
import { isFreelancerProPlanTier } from '@/lib/freelancerPlan'

type TalentRow = {
  id: string
  name: string
  headline: string
  location: string
  avatarUrl: string | null
  role: string | null
  skills: string[]
  isPro: boolean
}

type Folder = { id: string; name: string; profileIds: string[] }

type TalentPoolCache = {
  rows: TalentRow[]
  favoriteProfileIds: string[]
  folders: Folder[]
}

const TALENT_POOL_MAX_ROWS = 60
const TALENT_POOL_CACHE_TTL_MS = 60_000
const DISK_TTL_MS = 24 * 60 * 60 * 1000
const FOLDERS_TABLE = 'talent_pool_folders'

export function talentPoolCacheKey(userId: string): string {
  return `talent-pool:${userId}`
}

function foldersStorageKey(uid: string) {
  return `crea_app_talent_pool_folders_v1:${uid}`
}

function talentPoolDiskKey(userId: string) {
  return `crea:talent-pool:${userId}`
}

async function loadFreelancerDirectoryRows(userId: string) {
  const out: Array<{ id: string; location: string | null; plan_tier: string | null }> = []
  let offset = 0
  const pageSize = 100
  while (out.length < TALENT_POOL_MAX_ROWS) {
    const end = Math.min(offset + pageSize - 1, TALENT_POOL_MAX_ROWS - 1)
    const { data, error } = await supabase
      .from('freelancer_profiles')
      .select('id, location, plan_tier')
      .neq('id', userId)
      .range(offset, end)
    if (error) return { rows: [] as typeof out, error: error.message }
    const chunk = (data ?? []) as typeof out
    out.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }
  return { rows: out, error: null as string | null }
}

async function loadProfilesForTalentIds(ids: string[]) {
  if (!ids.length) return { profiles: [] as Array<Record<string, unknown>>, error: null as string | null }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, headline, location, avatar_url, role, skills')
    .in('id', ids)
    .neq('role', 'company')
    .neq('role', 'ceo')
    .order('name', { ascending: true })
  if (error) return { profiles: [] as Array<Record<string, unknown>>, error: error.message }
  return { profiles: (data ?? []) as Array<Record<string, unknown>>, error: null }
}

function buildTalentRows(
  candidates: Array<{ id: string; location: string | null; plan_tier?: string | null }>,
  profilesOut: Array<Record<string, unknown>>
): TalentRow[] {
  const fpById = new Map(candidates.map((fp) => [fp.id, fp]))
  return profilesOut.map((r) => {
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
      name: resolveProfileDisplayName(r.name as string | null, { email: r.email as string | null }),
      headline: String(r.headline ?? '').trim(),
      location: profileLoc || fpLoc,
      avatarUrl: url && /^https?:\/\//i.test(url) ? url : null,
      role: typeof r.role === 'string' ? r.role : null,
      skills,
      isPro: isFreelancerProPlanTier(fp?.plan_tier),
    }
  })
}

async function loadTalentPoolFavorites(
  userId: string,
  favUi: boolean,
  mode: 'company' | 'freelancer' | null
): Promise<{ favoriteProfileIds: string[]; folders: Folder[] }> {
  if (!favUi || !mode) return { favoriteProfileIds: [], folders: [] }

  let favIds: string[] = []
  try {
    if (mode === 'company') {
      const { data: favRows, error: favErr } = await supabase
        .from('pool_saves')
        .select('freelancer_id')
        .eq('company_id', userId)
        .limit(500)
      if (!favErr && favRows) {
        favIds = favRows
          .map((r) => String((r as { freelancer_id?: string }).freelancer_id ?? '').trim())
          .filter(Boolean)
      }
    } else {
      const { data: favRows, error: favErr } = await supabase
        .from('talent_pool_favorites')
        .select('favorite_profile_id')
        .eq('owner_id', userId)
        .limit(500)
      if (!favErr && favRows) {
        favIds = favRows
          .map((r) => String((r as { favorite_profile_id?: string }).favorite_profile_id ?? '').trim())
          .filter(Boolean)
      }
    }
  } catch {
    /* optional tables */
  }

  let folders: Folder[] = []
  try {
    const raw = await AsyncStorage.getItem(foldersStorageKey(userId))
    if (raw) {
      const parsed = JSON.parse(raw) as Folder[]
      folders = (Array.isArray(parsed) ? parsed : [])
        .filter((f) => typeof f?.id === 'string' && typeof f?.name === 'string')
        .map((f) => ({
          id: f.id,
          name: f.name,
          profileIds: Array.isArray(f.profileIds) ? f.profileIds.map(String).filter(Boolean) : [],
        }))
    }
  } catch {
    folders = []
  }

  return { favoriteProfileIds: favIds, folders }
}

export async function hydrateTalentPoolFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<TalentPoolCache>(talentPoolDiskKey(userId))
  if (!hit) return false
  setCache(talentPoolCacheKey(userId), hit, TALENT_POOL_CACHE_TTL_MS)
  return true
}

let inflight: Promise<void> | null = null

export async function prefetchTalentPoolData(userId: string): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (getCache<TalentPoolCache>(talentPoolCacheKey(userId))) return
    await hydrateTalentPoolFromDisk(userId)
    if (getCache<TalentPoolCache>(talentPoolCacheKey(userId))) return

    const user = await getAuthUser()
    if (!user || user.id !== userId) return

    const { data: p } = await supabase
      .from('profiles')
      .select('role, subscription_tier')
      .eq('id', user.id)
      .single()
    const role = resolveAppRole(p?.role, user)
    const plan = resolveFreelancerPlanFromUserAndProfileTier(user, p?.subscription_tier)
    const canView =
      isCompanyProfile(role) ||
      isCeoProfile(role) ||
      (isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan))
    if (!canView) return

    const favUi = isCompanyProfile(role) || (isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan))
    const mode: 'company' | 'freelancer' | null = isCompanyProfile(role)
      ? 'company'
      : isFreelancerProfile(role) && isFreelancerTalentPoolPlan(plan)
        ? 'freelancer'
        : null

    const [{ rows: fpRows, error: fpErr }, favoritesPayload] = await Promise.all([
      loadFreelancerDirectoryRows(user.id),
      loadTalentPoolFavorites(user.id, favUi, mode),
    ])

    if (fpErr) {
      setCache(
        talentPoolCacheKey(userId),
        { rows: [], favoriteProfileIds: favoritesPayload.favoriteProfileIds, folders: favoritesPayload.folders },
        TALENT_POOL_CACHE_TTL_MS
      )
      return
    }

    const ids = [...new Set((fpRows ?? []).map((r) => r.id.trim()).filter(Boolean))]
    if (!ids.length) {
      const empty = {
        rows: [] as TalentRow[],
        favoriteProfileIds: favoritesPayload.favoriteProfileIds,
        folders: favoritesPayload.folders,
      }
      setCache(talentPoolCacheKey(userId), empty, TALENT_POOL_CACHE_TTL_MS)
      void writePersistedCache(talentPoolDiskKey(userId), empty, DISK_TTL_MS)
      return
    }

    const { profiles: profilesOut, error: profilesErr } = await loadProfilesForTalentIds(ids)
    if (profilesErr) return

    const payload: TalentPoolCache = {
      rows: buildTalentRows(fpRows ?? [], profilesOut),
      favoriteProfileIds: favoritesPayload.favoriteProfileIds,
      folders: favoritesPayload.folders,
    }
    setCache(talentPoolCacheKey(userId), payload, TALENT_POOL_CACHE_TTL_MS)
    void writePersistedCache(talentPoolDiskKey(userId), payload, DISK_TTL_MS)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

import { supabase } from '@/lib/supabase'
import type { FreelancerPublicProfilePayload } from '@/lib/freelancerPublicProfileTypes'
import {
  buildPortfolioProjectsFromTableRows,
  fetchFreelancerPortfolioTableRows,
} from '@/lib/freelancerPortfolioTable'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'

/** Same columns as `profile_share_public` — used for explicit merge (PostgREST often omits null keys). */
export const PROFILE_PUBLIC_KEYS = [
  'id',
  'name',
  'role',
  'headline',
  'location',
  'bio',
  'avatar_url',
  'skills',
  'equipment',
  'portfolio_website',
  'portfolio_instagram',
  'portfolio_linkedin',
  'portfolio_vimeo',
  'portfolio_behance',
  'portfolio_projects',
  'public_profile_widgets',
  'day_rate_amount',
  'half_day_rate_amount',
  'rates_currency',
  'availability_calendar',
  'availability_status',
  'availability_details',
  'open_to_remote',
  'open_to_travel',
  'years_experience',
] as const

const PROFILE_PUBLIC_SELECT = PROFILE_PUBLIC_KEYS.join(',')

/** If one column is missing in DB, PostgREST errors on the whole select — fall back. */
const PROFILE_PUBLIC_SELECT_MINIMAL = [
  'id',
  'name',
  'role',
  'headline',
  'location',
  'bio',
  'avatar_url',
  'skills',
  'equipment',
  'portfolio_website',
  'portfolio_instagram',
  'portfolio_linkedin',
  'portfolio_vimeo',
  'portfolio_behance',
  'portfolio_projects',
  'day_rate_amount',
  'half_day_rate_amount',
  'rates_currency',
  'availability_calendar',
  'availability_status',
  'availability_details',
  'open_to_remote',
  'open_to_travel',
  'years_experience',
].join(',')

/** Core public fields only — last resort if optional columns break the query. */
const PROFILE_PUBLIC_CORE =
  'id,name,role,headline,location,bio,avatar_url,skills,equipment,portfolio_projects,availability_calendar,day_rate_amount,half_day_rate_amount,rates_currency'

/** Unwrap common PostgREST / client quirks so we always get a single profile object. */
function normalizeRpcProfileBlob(data: unknown): unknown {
  if (data == null) return null
  if (typeof data === 'string') {
    try {
      return normalizeRpcProfileBlob(JSON.parse(data) as unknown)
    } catch {
      return null
    }
  }
  if (Array.isArray(data)) {
    if (data.length === 1 && data[0] != null && typeof data[0] === 'object') return data[0]
    return null
  }
  if (typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>
    if (o.profile_share_public != null && typeof o.profile_share_public === 'object') {
      return normalizeRpcProfileBlob(o.profile_share_public)
    }
    if (o.data != null && typeof o.data === 'object') {
      return normalizeRpcProfileBlob(o.data)
    }
    if (o.result != null) {
      return normalizeRpcProfileBlob(o.result)
    }
  }
  return data
}

/**
 * Web app often stores rich public data in `freelancer_profiles` with the same or aliased columns.
 * Map common aliases onto the keys `combineProfileSources` / UI expect.
 */
function normalizeRawProfileRow(row: Record<string, unknown>): Record<string, unknown> {
  const o = { ...row }
  if (!isMeaningfulValue(o.bio)) {
    if (isMeaningfulValue(o.about)) o.bio = o.about
    else if (isMeaningfulValue(o.description)) o.bio = o.description
  }
  if (!isMeaningfulValue(o.portfolio_projects)) {
    if (isMeaningfulValue(o.portfolio)) o.portfolio_projects = o.portfolio
    else if (isMeaningfulValue(o.work)) o.portfolio_projects = o.work
    else if (isMeaningfulValue(o.videos)) o.portfolio_projects = o.videos
    else if (isMeaningfulValue(o.portfolio_items)) o.portfolio_projects = o.portfolio_items
    else if (isMeaningfulValue(o.portfolio_videos)) o.portfolio_projects = o.portfolio_videos
    else if (isMeaningfulValue(o.work_links)) o.portfolio_projects = o.work_links
    else if (isMeaningfulValue(o.video_items)) o.portfolio_projects = o.video_items
  }
  if (!isMeaningfulValue(o.skills)) {
    if (isMeaningfulValue(o.skill_tags)) o.skills = o.skill_tags
    else if (isMeaningfulValue(o.tags)) o.skills = o.tags
  }
  if (!isMeaningfulValue(o.availability_calendar) && isMeaningfulValue(o.availability)) {
    o.availability_calendar = o.availability
  }
  return o
}

/**
 * Overlay wins only for meaningful values so sparse `freelancer_profiles` rows do not wipe `profiles.name`.
 */
function mergeProfileRows(
  profiles: Record<string, unknown> | null,
  freelancer: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!profiles && !freelancer) return null
  const out: Record<string, unknown> = { ...(profiles || {}) }
  if (freelancer) {
    for (const [k, v] of Object.entries(freelancer)) {
      if (isMeaningfulValue(v)) out[k] = v
    }
  }
  return normalizeRawProfileRow(out)
}

/** Web “Work” table rows + JSON `portfolio_projects` — table rows first, dedupe by `link`. */
function mergeTableAndJsonPortfolio(tableProjects: PortfolioProject[], jsonRaw: unknown): PortfolioProject[] {
  const fromJson = parsePortfolioProjects(jsonRaw)
  const seen = new Set<string>()
  const merged: PortfolioProject[] = []
  for (const p of [...tableProjects, ...fromJson]) {
    const key = typeof p.link === 'string' ? p.link.trim().toLowerCase() : ''
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(p)
      continue
    }
    const fallback = `${p.title}\0${p.image_url ?? ''}`
    if (seen.has(fallback)) continue
    seen.add(fallback)
    merged.push(p)
  }
  return merged
}

function isMeaningfulValue(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  if (typeof v === 'boolean') return true
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('days' in o && o.days && typeof o.days === 'object' && !Array.isArray(o.days)) {
      const dayKeys = Object.keys(o.days as object)
      const notes = typeof o.notes === 'string' ? o.notes.trim() : ''
      return dayKeys.length > 0 || notes.length > 0
    }
    return Object.keys(o).length > 0
  }
  return false
}

/**
 * For each public field: take the first *meaningful* value from row, then RPC.
 * So a full `profiles` read and a sparse RPC (or the reverse) still produce one complete object.
 */
function combineProfileSources(
  row: Record<string, unknown> | null,
  rpc: FreelancerPublicProfilePayload | null,
  workspaceCount: number | null
): FreelancerPublicProfilePayload {
  const sources: Record<string, unknown>[] = []
  if (row) sources.push(row)
  if (rpc) sources.push(rpc as Record<string, unknown>)

  const out: Record<string, unknown> = {}
  for (const key of PROFILE_PUBLIC_KEYS) {
    const k = key as string
    let v: unknown = undefined
    for (const s of sources) {
      const c = s[k]
      if (isMeaningfulValue(c)) {
        v = c
        break
      }
    }
    if (v === undefined) {
      for (const s of sources) {
        const c = s[k]
        if (c !== undefined && c !== null) {
          v = c
          break
        }
      }
    }
    out[k] = v
  }

  const id = row?.id ?? rpc?.id
  if (id != null) out.id = String(id)

  out.workspace_projects_count = workspaceCount ?? rpc?.workspace_projects_count ?? 0
  const rowP = row ? parsePortfolioProjects(row.portfolio_projects).length : 0
  const rpcP = rpc ? parsePortfolioProjects(rpc.portfolio_projects).length : 0
  out.portfolio_items_count = Math.max(rowP, rpcP, rpc?.portfolio_items_count ?? 0)

  return out as FreelancerPublicProfilePayload
}

function asPayload(data: unknown): FreelancerPublicProfilePayload | null {
  const n = normalizeRpcProfileBlob(data)
  if (n != null && typeof n === 'object' && !Array.isArray(n)) {
    return n as FreelancerPublicProfilePayload
  }
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    return data as FreelancerPublicProfilePayload
  }
  return null
}

/**
 * Try several selects: full column list → `*` → minimal (no public_profile_widgets) → core public fields.
 * Also runs when not logged in — some projects allow anon SELECT on `profiles` for public discovery.
 */
async function fetchProfileRowForPublic(userId: string): Promise<Record<string, unknown> | null> {
  const uid = userId.trim()
  const attempts = [
    PROFILE_PUBLIC_SELECT,
    '*',
    PROFILE_PUBLIC_SELECT_MINIMAL,
    PROFILE_PUBLIC_CORE,
  ] as const

  for (const sel of attempts) {
    const { data, error } = await supabase.from('profiles').select(sel).eq('id', uid).maybeSingle()
    if (error) {
      continue
    }
    if (data && typeof data === 'object') {
      return data as Record<string, unknown>
    }
  }
  return null
}

/**
 * Website loads public freelancer fields from `freelancer_profiles` (see Network: …/freelancer_profiles?…).
 * Try common FK column names; anon RLS must allow SELECT for public profiles.
 */
async function fetchFreelancerProfilesRow(userId: string): Promise<Record<string, unknown> | null> {
  const uid = userId.trim()
  const attempts = [
    () => supabase.from('freelancer_profiles').select('*').eq('id', uid).maybeSingle(),
    () => supabase.from('freelancer_profiles').select('*').eq('profile_id', uid).maybeSingle(),
    () => supabase.from('freelancer_profiles').select('*').eq('user_id', uid).maybeSingle(),
  ]
  for (const run of attempts) {
    const { data, error } = await run()
    if (error) continue
    if (data && typeof data === 'object') {
      return normalizeRawProfileRow(data as Record<string, unknown>)
    }
  }
  return null
}

/**
 * Loads public profile: merges `profile_share_public` RPC with a direct `profiles` row when available.
 * Field-wise merge so either source can supply bio / skills / portfolio / calendar.
 */
export async function loadPublicProfile(userId: string): Promise<{
  profile: FreelancerPublicProfilePayload | null
  error: string | null
}> {
  const trimmed = userId.trim()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const authed = !!user

  const [rpcResult, countResult, row, fpRow, portfolioTableRows] = await Promise.all([
    supabase.rpc('profile_share_public', { profile_id: trimmed }),
    authed
      ? supabase.from('projects').select('*', { count: 'exact', head: true }).eq('freelancer_id', trimmed)
      : Promise.resolve({ count: null as number | null, error: null as null }),
    fetchProfileRowForPublic(trimmed),
    fetchFreelancerProfilesRow(trimmed),
    fetchFreelancerPortfolioTableRows(trimmed),
  ])

  const { data: rpcData, error: rpcError } = rpcResult
  const rpcPayload = asPayload(rpcData)

  const wsCount = countResult.error ? null : countResult.count

  const mergedRow = mergeProfileRows(row, fpRow)

  if (rpcError && !mergedRow && !rpcPayload) {
    return { profile: null, error: rpcError.message }
  }

  if (!rpcPayload && !mergedRow) {
    return { profile: null, error: null }
  }

  const merged = combineProfileSources(mergedRow, rpcPayload, wsCount)

  if (!merged.id && trimmed) {
    merged.id = trimmed
  }

  const tablePortfolio = await buildPortfolioProjectsFromTableRows(portfolioTableRows)
  merged.portfolio_projects = mergeTableAndJsonPortfolio(tablePortfolio, merged.portfolio_projects)
  const portfolioCount = parsePortfolioProjects(merged.portfolio_projects).length
  merged.portfolio_items_count = Math.max(merged.portfolio_items_count ?? 0, portfolioCount)

  if (__DEV__) {
    const bio = merged.bio
    const skills = merged.skills
    const hasBio = typeof bio === 'string' && bio.trim().length > 0
    const hasSkills = Array.isArray(skills) && skills.length > 0
    const hasPortfolio = parsePortfolioProjects(merged.portfolio_projects).length > 0
    if (merged.name && !hasBio && !hasSkills && !hasPortfolio) {
      console.warn(
        '[loadPublicProfile] sparse profile for',
        trimmed,
        'profilesRow?',
        !!row,
        'freelancer_profiles?',
        !!fpRow,
        'rpcPayloadKeys',
        rpcPayload ? Object.keys(rpcPayload).length : 0
      )
    }
  }

  return { profile: merged, error: null }
}

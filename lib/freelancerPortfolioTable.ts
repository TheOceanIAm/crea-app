import { supabase } from '@/lib/supabase'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'

/**
 * Web app stores public “Work” as rows (see Network: `video_url`, `role_in_project`, `photo_paths`, `sort_order`).
 * Table name may differ per project — try candidates until one responds without a schema error.
 */
/** Matches web: `/rest/v1/freelancer_portfolio_projects?...` */
/** Same bucket as web (`lib/freelancer-portfolio.ts`). */
export const FREELANCER_PORTFOLIO_BUCKET = 'freelancer-portfolio'

const PORTFOLIO_TABLE_CANDIDATES = [
  'freelancer_portfolio_projects',
  'freelancer_portfolio_items',
  'freelancer_portfolio',
  'portfolio_work_items',
] as const

/**
 * Comma-separated bucket names (tried in order for `photo_paths`).
 * Default matches web Storage bucket `freelancer-portfolio`.
 */
function portfolioStorageBuckets(): string[] {
  const raw =
    process.env.EXPO_PUBLIC_PORTFOLIO_STORAGE_BUCKET ||
    'freelancer-portfolio,freelancer-portfolio-projects,portfolio'
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Public URL for a storage object path (no network probe — matches web). */
function resolveStoragePublicUrlForPath(objectPath: string): string | undefined {
  const clean = objectPath.trim()
  if (!clean) return undefined
  if (/^https?:\/\//i.test(clean)) return clean

  const buckets = portfolioStorageBuckets()
  for (const b of buckets) {
    const url = supabase.storage.from(b).getPublicUrl(clean).data.publicUrl
    if (url) return url
  }
  return undefined
}

function resolvePhotoPathsThumbnail(photoPaths: unknown): string | undefined {
  if (!Array.isArray(photoPaths) || photoPaths.length === 0) return undefined
  const first = photoPaths[0]
  if (typeof first !== 'string' || !first.trim()) return undefined
  return resolveStoragePublicUrlForPath(first)
}

/** Aligns with web `youtubeVideoId` — lenient id length. */
export function youtubeVideoIdFromUrl(url: string): string | null {
  const u = url.trim()
  if (!u) return null
  const short = u.match(/youtu\.be\/([\w-]{6,})/i)
  if (short) return short[1]
  const watch = u.match(/[?&]v=([\w-]{6,})/i)
  if (watch) return watch[1]
  const embed = u.match(/youtube\.com\/embed\/([\w-]{6,})/i)
  if (embed) return embed[1]
  const shorts = u.match(/youtube\.com\/shorts\/([\w-]{6,})/i)
  if (shorts) return shorts[1]
  return null
}

export function youtubeThumbnailFromVideoUrl(videoUrl: string): string | undefined {
  const id = youtubeVideoIdFromUrl(videoUrl)
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : undefined
}

const vimeoThumbCache = new Map<string, string | undefined>()

async function vimeoThumbnailFromPageUrl(videoPageUrl: string): Promise<string | undefined> {
  const key = videoPageUrl.trim()
  if (!key) return undefined
  if (vimeoThumbCache.has(key)) return vimeoThumbCache.get(key)
  try {
    const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(key)}`)
    if (!r.ok) {
      vimeoThumbCache.set(key, undefined)
      return undefined
    }
    const j = (await r.json()) as { thumbnail_url?: string }
    const t = j.thumbnail_url?.trim()
    const out = t || undefined
    vimeoThumbCache.set(key, out)
    return out
  } catch {
    vimeoThumbCache.set(key, undefined)
    return undefined
  }
}

function isVimeoUrl(url: string): boolean {
  return /vimeo\.com/i.test(url)
}

async function resolveVideoPosterUrl(videoUrl: string): Promise<string | undefined> {
  const u = videoUrl.trim()
  if (!u) return undefined
  const yt = youtubeThumbnailFromVideoUrl(u)
  if (yt) return yt
  if (isVimeoUrl(u)) return vimeoThumbnailFromPageUrl(u)
  return undefined
}

function sortPortfolioRows(rows: Record<string, unknown>[]): void {
  rows.sort((a, b) => {
    const sa = typeof a.sort_order === 'number' ? a.sort_order : Number(a.sort_order) || 0
    const sb = typeof b.sort_order === 'number' ? b.sort_order : Number(b.sort_order) || 0
    if (sa !== sb) return sa - sb
    const ta = typeof a.created_at === 'string' ? a.created_at : ''
    const tb = typeof b.created_at === 'string' ? b.created_at : ''
    return ta.localeCompare(tb)
  })
}

const PORTFOLIO_ROW_LIMIT = 24

export async function fetchFreelancerPortfolioTableRows(freelancerId: string): Promise<Record<string, unknown>[]> {
  const uid = freelancerId.trim()
  if (!uid) return []

  let best: Record<string, unknown>[] = []
  for (const table of PORTFOLIO_TABLE_CANDIDATES) {
    const { data, error } = await supabase
      .from(table)
      .select('id, title, role_in_project, video_url, photo_paths, sort_order, created_at')
      .eq('freelancer_id', uid)
      .order('created_at', { ascending: false })
      .limit(PORTFOLIO_ROW_LIMIT)
    if (error) continue
    if (!Array.isArray(data) || data.length === 0) continue
    const rows = data as Record<string, unknown>[]
    sortPortfolioRows(rows)
    if (table === 'freelancer_portfolio_projects') return rows
    if (rows.length > best.length) best = rows
  }
  return best
}

/**
 * Maps `freelancer_portfolio_projects` rows to portfolio tiles with thumbnails:
 * 1) `photo_paths` → Supabase Storage public URL (tries multiple buckets)
 * 2) else poster from YouTube / Vimeo oEmbed
 */
export async function buildPortfolioProjectsFromTableRows(
  rows: Record<string, unknown>[]
): Promise<PortfolioProject[]> {
  const resolved = await Promise.all(
    rows.map(async (row) => {
      const parsed = parsePortfolioProjects([row])
      const p = parsed[0]
      if (!p) return null
      const link = typeof p.link === 'string' ? p.link.trim() : ''

      let image_url: string | undefined =
        typeof p.image_url === 'string' && /^https?:\/\//i.test(p.image_url.trim())
          ? p.image_url.trim()
          : undefined

      if (!image_url) {
        image_url = resolvePhotoPathsThumbnail(row.photo_paths)
      }
      if (!image_url && link) {
        image_url = await resolveVideoPosterUrl(link)
      }

      if (!link && !image_url) return null
      const client =
        (typeof p.client === 'string' && p.client.trim()) ||
        (typeof row.role_in_project === 'string' && row.role_in_project.trim()) ||
        ''
      const rowId = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : undefined
      return {
        ...p,
        id: rowId,
        client,
        link,
        image_url,
      } as PortfolioProject
    })
  )
  return resolved.filter((p): p is PortfolioProject => p !== null)
}

/** Web settings + public profile use `freelancer_portfolio_projects`; app also keeps JSON on `profiles`. */
export function mergeTableAndJsonPortfolio(
  tableProjects: PortfolioProject[],
  jsonRaw: unknown
): PortfolioProject[] {
  const fromJson = parsePortfolioProjects(jsonRaw)
  const seen = new Set<string>()
  const merged: PortfolioProject[] = []
  const upsert = (p: PortfolioProject) => {
    const key = typeof p.link === 'string' ? p.link.trim().toLowerCase() : ''
    if (key) {
      const idx = merged.findIndex((m) => (m.link ?? '').trim().toLowerCase() === key)
      if (idx >= 0) {
        const prev = merged[idx]
        merged[idx] = {
          ...prev,
          ...p,
          id: p.id ?? prev.id,
          image_url: p.image_url ?? prev.image_url,
        }
        return
      }
      if (seen.has(key)) return
      seen.add(key)
      merged.push(p)
      return
    }
    const fallback = `${p.title}\0${p.image_url ?? ''}`
    if (seen.has(fallback)) return
    seen.add(fallback)
    merged.push(p)
  }
  for (const p of [...tableProjects, ...fromJson]) upsert(p)
  return merged
}

export function normalizePortfolioProjectLink(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function portfolioLinkKey(url: string | null | undefined): string {
  return (url ?? '').trim().toLowerCase()
}

function portfolioTitleRoleKey(title: string, role: string): string {
  return `${title.trim().toLowerCase()}\0${role.trim().toLowerCase()}`
}

/**
 * Mirror app portfolio edits to `freelancer_portfolio_projects` (same as web settings save).
 * Projects without a link stay in `profiles.portfolio_projects` JSON only.
 */
export async function syncFreelancerPortfolioProjectsTable(
  userId: string,
  projects: PortfolioProject[]
): Promise<{ error: string | null }> {
  const uid = userId.trim()
  if (!uid) return { error: 'Missing user id' }

  const { data: existingProjects, error: portSelectErr } = await supabase
    .from('freelancer_portfolio_projects')
    .select('id, video_url, photo_paths')
    .eq('freelancer_id', uid)

  if (portSelectErr) return { error: portSelectErr.message }

  const existingRows = (existingProjects ?? []) as {
    id: string
    title?: string | null
    role_in_project?: string | null
    video_url?: string | null
    photo_paths?: unknown
  }[]

  const keptIds = new Set<string>()
  let sortOrder = 0

  for (const item of projects) {
    const title = item.title.trim()
    if (!title) continue
    const role = (item.client || item.role || '').trim() || '—'
    const urlNorm = normalizePortfolioProjectLink(item.link || '')

    const existingById = item.id ? existingRows.find((r) => r.id === item.id) : undefined
    const existingByUrl =
      !existingById && urlNorm
        ? existingRows.find((r) => portfolioLinkKey(r.video_url) === portfolioLinkKey(urlNorm))
        : undefined
    const existingByTitle =
      !existingById && !existingByUrl
        ? existingRows.find(
            (r) =>
              portfolioTitleRoleKey(String(r.title ?? ''), String(r.role_in_project ?? '')) ===
              portfolioTitleRoleKey(title, role)
          )
        : undefined
    const existing = existingById ?? existingByUrl ?? existingByTitle

    if (existing) {
      keptIds.add(existing.id)
      const photoPaths = Array.isArray(existing.photo_paths)
        ? existing.photo_paths.filter((p): p is string => typeof p === 'string')
        : []
      if (!urlNorm && photoPaths.length === 0) continue

      const { error: upErr } = await supabase
        .from('freelancer_portfolio_projects')
        .update({
          title,
          role_in_project: role,
          video_url: urlNorm,
          sort_order: sortOrder,
        })
        .eq('id', existing.id)
        .eq('freelancer_id', uid)
      if (upErr) return { error: upErr.message }
      sortOrder++
      continue
    }

    if (!urlNorm) continue

    const { data: inserted, error: insErr } = await supabase
      .from('freelancer_portfolio_projects')
      .insert({
        freelancer_id: uid,
        title,
        role_in_project: role,
        video_url: urlNorm,
        photo_paths: [],
        sort_order: sortOrder,
      })
      .select('id')
      .single()

    if (insErr) return { error: insErr.message }
    if (inserted?.id) keptIds.add(String(inserted.id))
    sortOrder++
  }

  for (const row of existingRows) {
    if (keptIds.has(row.id)) continue
    const { error: delErr } = await supabase
      .from('freelancer_portfolio_projects')
      .delete()
      .eq('id', row.id)
      .eq('freelancer_id', uid)
    if (delErr) return { error: delErr.message }

    const paths = Array.isArray(row.photo_paths)
      ? row.photo_paths.filter((p): p is string => typeof p === 'string')
      : []
    if (paths.length > 0) {
      await supabase.storage.from(FREELANCER_PORTFOLIO_BUCKET).remove(paths)
    }
  }

  return { error: null }
}

/** Load portfolio for app settings: table rows (web) merged with legacy JSON on `profiles`. */
export async function loadPortfolioProjectsForSettings(
  freelancerId: string
): Promise<PortfolioProject[]> {
  const uid = freelancerId.trim()
  if (!uid) return []

  const [{ data: profileRow }, tableRows] = await Promise.all([
    supabase.from('profiles').select('portfolio_projects').eq('id', uid).maybeSingle(),
    fetchFreelancerPortfolioTableRows(uid),
  ])

  const tableProjects = await buildPortfolioProjectsFromTableRows(tableRows)
  const merged = mergeTableAndJsonPortfolio(tableProjects, profileRow?.portfolio_projects)
  return enrichPortfolioProjectsThumbnails(merged)
}

/** Fill missing `image_url` from YouTube/Vimeo links (JSON / RPC portfolio rows). */
export async function enrichPortfolioProjectsThumbnails(
  projects: PortfolioProject[]
): Promise<PortfolioProject[]> {
  return Promise.all(
    projects.map(async (p) => {
      const existing =
        typeof p.image_url === 'string' && /^https?:\/\//i.test(p.image_url.trim())
          ? p.image_url.trim()
          : undefined
      if (existing) {
        return { ...p, image_url: existing }
      }
      const link = typeof p.link === 'string' ? p.link.trim() : ''
      const image_url = link ? await resolveVideoPosterUrl(link) : undefined
      return image_url ? { ...p, image_url } : p
    })
  )
}

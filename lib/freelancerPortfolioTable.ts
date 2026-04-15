import { supabase } from '@/lib/supabase'
import { parsePortfolioProjects, type PortfolioProject } from '@/lib/profileSettingsExtras'

/**
 * Web app stores public “Work” as rows (see Network: `video_url`, `role_in_project`, `photo_paths`, `sort_order`).
 * Table name may differ per project — try candidates until one responds without a schema error.
 */
/** Matches web: `/rest/v1/freelancer_portfolio_projects?...` */
const PORTFOLIO_TABLE_CANDIDATES = [
  'freelancer_portfolio_projects',
  'freelancer_portfolio_items',
  'freelancer_portfolio',
  'portfolio_work_items',
] as const

/**
 * Comma-separated bucket names (tried in order for `photo_paths`).
 * Default aligns with table name `freelancer_portfolio_projects`; override if your bucket differs.
 */
function portfolioStorageBuckets(): string[] {
  const raw =
    process.env.EXPO_PUBLIC_PORTFOLIO_STORAGE_BUCKET ||
    'freelancer-portfolio-projects,freelancer-portfolio,portfolio'
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function urlReachable(url: string): Promise<boolean> {
  try {
    let res = await fetch(url, { method: 'HEAD' })
    if (res.ok) return true
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } })
      return res.ok
    }
    return false
  } catch {
    return false
  }
}

/** Pick first bucket where the object exists (public URL returns 2xx). */
async function resolveStoragePublicUrlForPath(objectPath: string): Promise<string | undefined> {
  const clean = objectPath.trim()
  if (!clean) return undefined
  if (/^https?:\/\//i.test(clean)) return clean

  const buckets = portfolioStorageBuckets()
  const candidates = buckets.map((b) => supabase.storage.from(b).getPublicUrl(clean).data.publicUrl)

  const checks = await Promise.all(
    candidates.map(async (url) => ((await urlReachable(url)) ? url : null))
  )
  const hit = checks.find(Boolean)
  if (hit) return hit

  // HEAD may fail (CORS on web, etc.) — still return canonical URL for first bucket so `<Image>` can try.
  if (buckets.length > 0) {
    return supabase.storage.from(buckets[0]).getPublicUrl(clean).data.publicUrl
  }
  return undefined
}

async function resolvePhotoPathsThumbnail(photoPaths: unknown): Promise<string | undefined> {
  if (!Array.isArray(photoPaths) || photoPaths.length === 0) return undefined
  const first = photoPaths[0]
  if (typeof first !== 'string' || !first.trim()) return undefined
  return resolveStoragePublicUrlForPath(first)
}

function youtubeVideoIdFromUrl(url: string): string | null {
  const u = url.trim()
  try {
    const parsed = new URL(u.includes('://') ? u : `https://${u}`)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0]
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }
    if (host.includes('youtube.com')) {
      const v = parsed.searchParams.get('v')
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v
      const m = parsed.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/)
      if (m) return m[1]
    }
  } catch {
    /* ignore */
  }
  return null
}

function youtubeThumbnailFromVideoUrl(videoUrl: string): string | undefined {
  const id = youtubeVideoIdFromUrl(videoUrl)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : undefined
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

export async function fetchFreelancerPortfolioTableRows(freelancerId: string): Promise<Record<string, unknown>[]> {
  const uid = freelancerId.trim()
  if (!uid) return []

  for (const table of PORTFOLIO_TABLE_CANDIDATES) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('freelancer_id', uid)
      .order('created_at', { ascending: false })
    if (error) continue
    if (!Array.isArray(data)) return []
    const rows = data as Record<string, unknown>[]
    sortPortfolioRows(rows)
    return rows
  }
  return []
}

/**
 * Maps `freelancer_portfolio_projects` rows to portfolio tiles with thumbnails:
 * 1) `photo_paths` → Supabase Storage public URL (tries multiple buckets)
 * 2) else poster from YouTube / Vimeo oEmbed
 */
export async function buildPortfolioProjectsFromTableRows(
  rows: Record<string, unknown>[]
): Promise<PortfolioProject[]> {
  const out: PortfolioProject[] = []
  for (const row of rows) {
    const parsed = parsePortfolioProjects([row])
    const p = parsed[0]
    if (!p) continue
    const link = typeof p.link === 'string' ? p.link.trim() : ''

    let image_url: string | undefined =
      typeof p.image_url === 'string' && /^https?:\/\//i.test(p.image_url.trim())
        ? p.image_url.trim()
        : undefined

    if (!image_url) {
      image_url = await resolvePhotoPathsThumbnail(row.photo_paths)
    }
    if (!image_url && link) {
      image_url = await resolveVideoPosterUrl(link)
    }

    if (!link && !image_url) continue
    out.push({
      ...p,
      link,
      image_url,
    })
  }
  return out
}

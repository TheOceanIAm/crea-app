import { getCreaWebBaseUrl } from '@/lib/creaWeb'

/**
 * Public web URLs for sharing. Uses EXPO_PUBLIC_CREA_SHARE_BASE_URL if set,
 * otherwise EXPO_PUBLIC_CREA_WEB_URL. Align these paths with your deployed site
 * (e.g. /jobs/:id, /profile/:userId).
 */
export function getShareBaseUrl(): string {
  const explicit = (process.env.EXPO_PUBLIC_CREA_SHARE_BASE_URL || '').replace(/\/$/, '')
  if (explicit) return explicit
  return getCreaWebBaseUrl()
}

/** First 8 hex chars of a UUID, same shape as the web short link (`/s/70e93ee8`). */
export function jobShortShareSlug(id: string): string {
  return id.trim().replace(/-/g, '').toLowerCase().slice(0, 8)
}

/**
 * Public job link. Opens `/s/{prefix}` on the web and redirects to the job,
 * matching crea-services `getJobPublicUrl`.
 */
export function jobShareUrl(jobId: string): string | null {
  const base = getShareBaseUrl()
  const id = jobId.trim()
  if (!base || !id) return null
  const slug = jobShortShareSlug(id)
  if (!/^[0-9a-f]{8}$/.test(slug)) return `${base}/jobs/${encodeURIComponent(id)}`
  return `${base}/s/${slug}`
}

export function profileShareUrl(userId: string): string | null {
  const base = getShareBaseUrl()
  const id = userId.trim()
  if (!base || !id) return null
  return `${base}/profile/${encodeURIComponent(id)}`
}

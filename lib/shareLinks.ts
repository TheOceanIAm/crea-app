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

export function jobShareUrl(jobId: string): string | null {
  const base = getShareBaseUrl()
  const id = jobId.trim()
  if (!base || !id) return null
  return `${base}/jobs/${encodeURIComponent(id)}`
}

export function profileShareUrl(userId: string): string | null {
  const base = getShareBaseUrl()
  const id = userId.trim()
  if (!base || !id) return null
  return `${base}/profile/${encodeURIComponent(id)}`
}

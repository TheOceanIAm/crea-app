import type { Href } from 'expo-router'
import type { Router } from 'expo-router'
import { parseBookingDeepLinkTargetIds } from '@/lib/parseCreaDeepLinkHref'

const BOOKING_UUID =
  /(?:project|jobs)[/]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i

export type BookingNavigationOpts = {
  replyStatus: 'accepted' | 'declined' | null
  mine: boolean
}

function bookingDeepLinkQuerySuffix(raw: string): string {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return ''
  try {
    let normalized = u.replace(/%2F/gi, '/').replace(/%2f/gi, '/')
    normalized = normalized.replace(/^crea:\/\//i, 'http://crea/')
    const url = new URL(normalized)
    const qs = new URLSearchParams()
    const bookingMsg = url.searchParams.get('bookingMsg')
    const conv = url.searchParams.get('conv')
    if (bookingMsg) qs.set('bookingMsg', bookingMsg)
    if (conv) qs.set('conv', conv)
    const q = qs.toString()
    return q ? `?${q}` : ''
  } catch {
    return ''
  }
}

function extractBookingTargetIds(raw: string): { jobId?: string; projectId?: string } {
  const parsed = parseBookingDeepLinkTargetIds(raw)
  if (parsed.jobId || parsed.projectId) return parsed

  const m = raw.match(BOOKING_UUID)
  if (!m?.[1]) return {}
  const id = m[1]
  if (/project/i.test(m[0])) return { projectId: id }
  return { jobId: id }
}

/** Sync target — no network; safe to call from gesture-handler touchables inside Swipeable. */
export function getBookingNavigationHref(
  raw: string,
  opts: BookingNavigationOpts
): Href | null {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u || u === 'crea://') return null

  const { jobId, projectId } = extractBookingTargetIds(u)
  const suffix = bookingDeepLinkQuerySuffix(u)
  const openWorkspace = opts.replyStatus === 'accepted' || opts.mine

  if (openWorkspace) {
    const pid = projectId || jobId
    if (pid) return `/project/${pid}` as Href
  }

  if (jobId) return `/jobs/${jobId}${suffix}` as Href
  if (projectId) return `/project/${projectId}${suffix}` as Href
  return null
}

export function navigateBookingContext(
  router: Router,
  raw: string,
  opts: BookingNavigationOpts
): boolean {
  const href = getBookingNavigationHref(raw, opts)
  if (!href) return false
  router.push(href)
  return true
}

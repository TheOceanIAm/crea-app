import type { Href } from 'expo-router'
import type { Router } from 'expo-router'

/**
 * Maps `crea://jobs/…` / `crea://project/…` (optional query) to an in-app expo-router href.
 * Prefer **`/(tabs)/jobs/[id]`** for job detail so booking Accept/Decline (query `bookingMsg`, `conv`)
 * hits the authenticated tab screen — not the stack-only public share route `app/jobs/[id].tsx`.
 */
export function parseCreaDeepLinkHref(raw: string): Href | null {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return null
  const normalized = u.replace(/^crea:\/\//i, 'http://crea/')
  try {
    const url = new URL(normalized)
    const pathname = url.pathname.replace(/^\/+/, '')
    const search = url.search
    if (pathname.startsWith('jobs/')) {
      const rest = pathname.slice('jobs/'.length)
      if (!rest || rest.includes('/')) return null
      return `/(tabs)/jobs/${rest}${search}` as Href
    }
    if (pathname.startsWith('project/')) {
      const rest = pathname.slice('project/'.length)
      if (!rest || rest.includes('/')) return null
      return `/project/${rest}${search}` as Href
    }
  } catch {
    return null
  }
  return null
}

/**
 * Navigate from a `crea://…` booking link. Uses a **string href + query** so `bookingMsg` / `conv`
 * survive nested tab stacks (object `params` alone often drops extra keys in Expo Router 4).
 */
export function navigateCreaDeepLink(router: Router, raw: string): boolean {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return false
  const normalized = u.replace(/^crea:\/\//i, 'http://crea-link/')
  try {
    const url = new URL(normalized)
    const path = url.pathname.replace(/^\/+/, '')
    const bookingMsg = url.searchParams.get('bookingMsg') ?? undefined
    const conv = url.searchParams.get('conv') ?? undefined
    const qs = new URLSearchParams()
    if (bookingMsg) qs.set('bookingMsg', bookingMsg)
    if (conv) qs.set('conv', conv)
    const q = qs.toString()
    const suffix = q ? `?${q}` : ''
    if (path.startsWith('jobs/')) {
      const id = path.slice('jobs/'.length).split('/')[0]
      if (!id) return false
      router.push(`/(tabs)/jobs/${id}${suffix}` as Href)
      return true
    }
    if (path.startsWith('project/')) {
      const id = path.slice('project/'.length).split('/')[0]
      if (!id) return false
      router.push(`/project/${id}${suffix}` as Href)
      return true
    }
  } catch {
    return false
  }
  return false
}

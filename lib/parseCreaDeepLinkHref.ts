import type { Href } from 'expo-router'
import type { Router } from 'expo-router'
import { ensureMarketplaceJobWorkspaceRow } from '@/lib/ensureMarketplaceJobWorkspace'
import { supabase } from '@/lib/supabase'

/** Parse job/project ids from `crea://jobs/…` or `crea://project/…` (ignores query). */
export function parseBookingDeepLinkTargetIds(raw: string): { jobId?: string; projectId?: string } {
  let u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return {}
  try {
    u = decodeURIComponent(u)
  } catch {
    /* keep raw */
  }
  u = u.replace(/%2F/gi, '/').replace(/%2f/gi, '/')
  const normalized = u.replace(/^crea:\/\//i, 'http://crea/')
  try {
    const url = new URL(normalized)
    let path = url.pathname.replace(/^\/+/, '')
    // `crea://jobs/{id}` is sometimes parsed as host=jobs, path={id}
    if (!path.startsWith('jobs/') && !path.startsWith('project/') && url.hostname === 'jobs') {
      path = `jobs/${path}`
    }
    if (!path.startsWith('project/') && url.hostname === 'project') {
      path = `project/${path}`
    }
    if (path.startsWith('jobs/')) {
      const id = path.slice('jobs/'.length).split('/')[0]?.trim()
      return id ? { jobId: id } : {}
    }
    if (path.startsWith('project/')) {
      const id = path.slice('project/'.length).split('/')[0]?.trim()
      return id ? { projectId: id } : {}
    }
  } catch {
    return {}
  }
  return {}
}

/** Resolve marketplace workspace row for a booking deep link (job id or project id). */
export async function resolveBookingWorkspaceProjectId(openDeepLink: string): Promise<string | null> {
  const { jobId, projectId } = parseBookingDeepLinkTargetIds(openDeepLink)

  const readProjectId = async (pid: string): Promise<string | null> => {
    const { data } = await supabase.from('projects').select('id').eq('id', pid).maybeSingle()
    return data?.id ? String(data.id) : null
  }

  if (projectId) {
    const found = await readProjectId(projectId)
    if (found) return found
  }

  if (jobId) {
    const { data: byJob } = await supabase.from('projects').select('id').eq('job_id', jobId).maybeSingle()
    if (byJob?.id) return String(byJob.id)
    const byPk = await readProjectId(jobId)
    if (byPk) return byPk

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const ensured = await ensureMarketplaceJobWorkspaceRow(supabase, { jobId, userId: user.id })
      if (ensured.projectId) return ensured.projectId
      if (ensured.ok) {
        const again = await readProjectId(jobId)
        if (again) return again
      }
    }

    // Marketplace rows often use project.id === job.id even before SELECT succeeds.
    return jobId
  }

  return null
}

function bookingDeepLinkQuerySuffix(raw: string): string {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return ''
  try {
    const normalized = u.replace(/^crea:\/\//i, 'http://crea/')
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

/**
 * Maps `crea://jobs/…` / `crea://project/…` (optional query) to an in-app expo-router href.
 * Job links use root **`/jobs/[id]`** (handoff → tabs) so navigation from Messages does not reset tabs to Feed.
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
      return `/jobs/${rest}${search}` as Href
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
 * Navigate from a `crea://…` booking link via root `/jobs/[id]` handoff or `/project/[id]`.
 */
export function navigateCreaDeepLink(router: Router, raw: string): boolean {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return false
  const suffix = bookingDeepLinkQuerySuffix(u)
  const { jobId, projectId } = parseBookingDeepLinkTargetIds(u)

  if (jobId) {
    router.push(`/jobs/${jobId}${suffix}` as Href)
    return true
  }
  if (projectId) {
    router.push(`/project/${projectId}${suffix}` as Href)
    return true
  }
  return false
}

/** @deprecated use navigateBookingContext from @/lib/bookingNavigation */
export async function openBookingDeepLinkContext(
  router: Router,
  raw: string,
  opts: { replyStatus: 'accepted' | 'declined' | null; mine: boolean }
): Promise<boolean> {
  const { navigateBookingContext } = await import('@/lib/bookingNavigation')
  return navigateBookingContext(router, raw, opts)
}

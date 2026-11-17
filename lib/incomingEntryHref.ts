import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `crea://jobs/{id}`, `https://…/jobs/{id}`, and the same shapes for a project. */
export function hrefFromJobUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/^crea:\/\//i, 'http://crea/')
  try {
    const url = new URL(normalized)
    let path = url.pathname.replace(/^\/+/, '')
    if (!path.startsWith('jobs/') && !path.startsWith('project/') && url.hostname === 'jobs') {
      path = `jobs/${path}`
    }
    if (!path.startsWith('project/') && url.hostname === 'project') {
      path = `project/${path}`
    }
    const search = url.search || ''
    if (path.startsWith('jobs/')) {
      const id = path.slice('jobs/'.length).split('/')[0]?.trim() ?? ''
      if (!JOB_ID.test(id)) return null
      return `/(tabs)/jobs/${id}${search}`
    }
    if (path.startsWith('project/')) {
      const id = path.slice('project/'.length).split('/')[0]?.trim() ?? ''
      if (!id || id.includes('/')) return null
      return `/project/${id}${search}`
    }
  } catch {
    return null
  }
  return null
}

/**
 * Where a notification tap should go.
 * A payload that names a job opens that job, except an application inbox notice.
 */
export function hrefFromNotificationData(data: Record<string, unknown> | null | undefined): string | null {
  if (!data || typeof data !== 'object') return null
  const type = typeof data.type === 'string' ? data.type : ''
  const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : ''
  const projectId = typeof data.projectId === 'string' ? data.projectId.trim() : ''

  const rawUrl = [data.url, data.link, data.href].find((value) => typeof value === 'string' && value.trim())
  if (typeof rawUrl === 'string') {
    const fromUrl = hrefFromJobUrl(rawUrl)
    if (fromUrl) return fromUrl
  }

  if (type === 'message') {
    const cid = data.conversationId
    if (typeof cid === 'string' && cid.length > 0) return `/conversation/${cid}`
    return null
  }
  if (type === 'invoice') {
    const id = data.invoiceId
    if (typeof id === 'string' && id.length > 0) return `/(tabs)/invoices/${id}`
    return null
  }
  if (type === 'job_application') return '/(tabs)/company-applications'
  if (type === 'project_crew_invite') return '/(tabs)/notifications'
  if (type === 'workspace_ready' || type === 'project_message' || type === 'workspace_activity') {
    if (projectId) return `/project/${projectId}`
    if (JOB_ID.test(jobId)) return `/(tabs)/jobs/${jobId}`
    return null
  }
  if (type === 'profile_completion') return '/(tabs)/profile'
  if (JOB_ID.test(jobId)) return `/(tabs)/jobs/${jobId}`
  return null
}

export function hrefFromNotificationResponse(
  response: Notifications.NotificationResponse | null
): string | null {
  if (!response) return null
  if (
    response.actionIdentifier &&
    response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
  ) {
    return null
  }
  const data = response.notification.request.content.data
  if (!data || typeof data !== 'object') return null
  return hrefFromNotificationData(data as Record<string, unknown>)
}

/** Job/project link or a fresh notification tap. Null means the projects dashboard may open. */
export async function resolveIncomingEntryHref(): Promise<string | null> {
  const initial = await Linking.getInitialURL().catch(() => null)
  if (initial) {
    const fromUrl = hrefFromJobUrl(initial)
    if (fromUrl) return fromUrl
  }
  if (Platform.OS === 'web') return null
  try {
    const response = await Notifications.getLastNotificationResponseAsync()
    return hrefFromNotificationResponse(response)
  } catch {
    return null
  }
}

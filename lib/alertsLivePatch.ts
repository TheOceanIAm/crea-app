import {
  cacheNotifications,
  readCachedNotifications,
  type NotificationsCache,
} from '@/lib/notificationsCache'
import type { NotificationRow } from '@/lib/notificationsFeed'
import { publishAlertsLivePatch } from '@/lib/invalidateAlerts'
import { supabase } from '@/lib/supabase'

export type ProjectMessageInsertRow = {
  id?: unknown
  project_id?: unknown
  sender_id?: unknown
  body?: unknown
  created_at?: unknown
}

export function projectMessageAlertKey(messageId: string): string {
  return `project-msg-${messageId}`
}

export function notificationRowFromProjectMessage(opts: {
  messageId: string
  projectId: string
  createdAt?: string | null
  projectTitle?: string
  jobId?: string
}): NotificationRow {
  return {
    id: projectMessageAlertKey(opts.messageId),
    kind: 'project_message',
    projectId: opts.projectId,
    jobId: opts.jobId,
    title: opts.projectTitle?.trim() || 'Project',
    body: 'New message.',
    at: opts.createdAt?.trim() || new Date().toISOString(),
  }
}

export function countUnreadFromNotificationsCache(cache: NotificationsCache): number {
  const reads = new Set(cache.reads)
  return cache.rows.filter((r) => !reads.has(r.id)).length
}

export function countUnreadAlertsCached(userId: string): number | null {
  const cache = readCachedNotifications(userId)
  if (!cache) return null
  return countUnreadFromNotificationsCache(cache)
}

/**
 * Prepend a project-message alert into the in-memory cache (idempotent).
 * Returns badgeDelta 1 when a new unread row was inserted.
 */
export function patchAlertsCacheWithProjectMessage(
  userId: string,
  row: NotificationRow
): { inserted: boolean; badgeDelta: number; unreadCount: number } {
  const prev = readCachedNotifications(userId) ?? { rows: [], reads: [] }
  if (prev.rows.some((r) => r.id === row.id)) {
    return {
      inserted: false,
      badgeDelta: 0,
      unreadCount: countUnreadFromNotificationsCache(prev),
    }
  }
  const next: NotificationsCache = {
    rows: [row, ...prev.rows],
    reads: prev.reads,
  }
  cacheNotifications(userId, next)
  const wasUnread = !prev.reads.includes(row.id)
  return {
    inserted: true,
    badgeDelta: wasUnread ? 1 : 0,
    unreadCount: countUnreadFromNotificationsCache(next),
  }
}

function titleFromCache(userId: string, projectId: string): string | undefined {
  const cache = readCachedNotifications(userId)
  const hit = cache?.rows.find((r) => r.projectId === projectId && r.title.trim())
  return hit?.title
}

function jobIdFromCache(userId: string, projectId: string): string | undefined {
  const cache = readCachedNotifications(userId)
  return cache?.rows.find((r) => r.projectId === projectId && r.jobId)?.jobId
}

/**
 * Apply a Realtime project_messages INSERT for the current user.
 * Skips own messages. Publishes to Alerts UI subscribers.
 */
export function applyProjectMessageInsertAlert(
  userId: string,
  raw: ProjectMessageInsertRow
): { inserted: boolean; badgeDelta: number; unreadCount: number; row: NotificationRow | null } {
  const messageId = typeof raw.id === 'string' ? raw.id.trim() : ''
  const projectId = typeof raw.project_id === 'string' ? raw.project_id.trim() : ''
  const senderId = typeof raw.sender_id === 'string' ? raw.sender_id.trim() : ''
  if (!messageId || !projectId || !senderId || senderId === userId) {
    return { inserted: false, badgeDelta: 0, unreadCount: countUnreadAlertsCached(userId) ?? 0, row: null }
  }

  const row = notificationRowFromProjectMessage({
    messageId,
    projectId,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
    projectTitle: titleFromCache(userId, projectId),
    jobId: jobIdFromCache(userId, projectId),
  })
  const result = patchAlertsCacheWithProjectMessage(userId, row)
  if (result.inserted) {
    publishAlertsLivePatch({ userId, row })
  }
  return { ...result, row: result.inserted ? row : null }
}

/** Best-effort title/jobId enrich after optimistic insert (does not block UI). */
export async function enrichProjectMessageAlertTitle(
  userId: string,
  projectId: string,
  alertKey: string
): Promise<void> {
  const { data } = await supabase
    .from('projects')
    .select('title, job_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!data) return
  const title = String(data.title ?? '').trim()
  const jobId = data.job_id != null ? String(data.job_id).trim() : ''
  if (!title && !jobId) return
  const prev = readCachedNotifications(userId)
  if (!prev) return
  let changed = false
  const rows = prev.rows.map((r) => {
    if (r.id !== alertKey) return r
    const next = {
      ...r,
      title: title || r.title,
      jobId: jobId || r.jobId,
    }
    if (next.title !== r.title || next.jobId !== r.jobId) changed = true
    return next
  })
  if (!changed) return
  cacheNotifications(userId, { rows, reads: prev.reads })
  const row = rows.find((r) => r.id === alertKey)
  if (row) publishAlertsLivePatch({ userId, row })
}

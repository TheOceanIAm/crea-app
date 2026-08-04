import type { SupabaseClient } from '@supabase/supabase-js'

/** Keep in sync with crea-services/lib/workspace-messages.ts */

export type WorkspaceMessageRaw = {
  id: string
  sender_id: string
  content: string
  created_at: string
  profiles?: { name: string | null } | { name: string | null }[] | null
}

/** Mirror insert can land a second later — treat nearby same-body rows as one message. */
export const WORKSPACE_MESSAGE_DEDUPE_WINDOW_MS = 30_000

export function workspaceMessageTimeMs(createdAtIso: string): number {
  const ms = Date.parse(createdAtIso)
  return Number.isFinite(ms) ? ms : 0
}

/** Exact second key (legacy). Prefer `workspaceMessagesNearDuplicate` for UI/merge. */
export function workspaceMessageSyncKey(senderId: string, body: string, createdAtIso: string): string {
  const t = Number.isNaN(Date.parse(createdAtIso))
    ? createdAtIso.trim()
    : new Date(createdAtIso).toISOString().slice(0, 19)
  return `${senderId}|${body.trim()}|${t}`
}

/** Same sender + body within a short window = job_messages ↔ project_messages mirror pair. */
export function workspaceMessagesNearDuplicate(
  a: { senderId: string; body: string; createdAt: string },
  b: { senderId: string; body: string; createdAt: string },
  windowMs = WORKSPACE_MESSAGE_DEDUPE_WINDOW_MS
): boolean {
  if (a.senderId !== b.senderId) return false
  if (a.body.trim() !== b.body.trim()) return false
  const ta = workspaceMessageTimeMs(a.createdAt)
  const tb = workspaceMessageTimeMs(b.createdAt)
  if (!ta || !tb) {
    return (
      workspaceMessageSyncKey(a.senderId, a.body, a.createdAt) ===
      workspaceMessageSyncKey(b.senderId, b.body, b.createdAt)
    )
  }
  return Math.abs(ta - tb) <= windowMs
}

function dedupeWorkspaceMessages(rows: WorkspaceMessageRaw[]): WorkspaceMessageRaw[] {
  const kept: WorkspaceMessageRaw[] = []
  for (const row of rows) {
    const dupIdx = kept.findIndex((existing) =>
      workspaceMessagesNearDuplicate(
        { senderId: existing.sender_id, body: existing.content, createdAt: existing.created_at },
        { senderId: row.sender_id, body: row.content, createdAt: row.created_at }
      )
    )
    if (dupIdx < 0) {
      kept.push(row)
      continue
    }
    if (row.id < kept[dupIdx].id) kept[dupIdx] = row
  }
  return kept.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export async function fetchMergedWorkspaceMessages(
  supabase: SupabaseClient,
  opts: { projectId: string; jobId: string | null }
): Promise<{ rows: WorkspaceMessageRaw[]; error: string | null }> {
  const profileSelect = 'id, sender_id, created_at, profiles(name, avatar_url)'

  const projRes = await supabase
    .from('project_messages')
    .select(`${profileSelect}, body`)
    .eq('project_id', opts.projectId)
    .order('created_at', { ascending: true })
    .limit(300)

  const fromProject: WorkspaceMessageRaw[] = projRes.error
    ? []
    : (projRes.data ?? []).map((r) => {
        const row = r as Record<string, unknown>
        return {
          id: String(row.id),
          sender_id: String(row.sender_id),
          content: String(row.body ?? ''),
          created_at: String(row.created_at),
          profiles: row.profiles as WorkspaceMessageRaw['profiles'],
        }
      })

  if (!opts.jobId) {
    return {
      rows: dedupeWorkspaceMessages(fromProject),
      error: projRes.error ? projRes.error.message : null,
    }
  }

  const jobRes = await supabase
    .from('job_messages')
    .select(`${profileSelect}, content`)
    .eq('job_id', opts.jobId)
    .order('created_at', { ascending: true })
    .limit(300)

  if (jobRes.error) return { rows: [], error: jobRes.error.message }

  const fromJob: WorkspaceMessageRaw[] = (jobRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      sender_id: String(row.sender_id),
      content: String(row.content ?? ''),
      created_at: String(row.created_at),
      profiles: row.profiles as WorkspaceMessageRaw['profiles'],
    }
  })

  return {
    rows: dedupeWorkspaceMessages([...fromProject, ...fromJob]),
    error: projRes.error ? projRes.error.message : null,
  }
}

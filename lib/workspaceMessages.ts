import type { SupabaseClient } from '@supabase/supabase-js'

/** Keep in sync with crea-services/lib/workspace-messages.ts */

export type WorkspaceMessageRaw = {
  id: string
  sender_id: string
  content: string
  created_at: string
  profiles?: { name: string | null } | { name: string | null }[] | null
}

export function workspaceMessageSyncKey(senderId: string, body: string, createdAtIso: string): string {
  const t = Number.isNaN(Date.parse(createdAtIso))
    ? createdAtIso.trim()
    : new Date(createdAtIso).toISOString().slice(0, 19)
  return `${senderId}|${body.trim()}|${t}`
}

function dedupeWorkspaceMessages(rows: WorkspaceMessageRaw[]): WorkspaceMessageRaw[] {
  const byKey = new Map<string, WorkspaceMessageRaw>()
  for (const row of rows) {
    const key = workspaceMessageSyncKey(row.sender_id, row.content, row.created_at)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, row)
      continue
    }
    if (row.id < existing.id) byKey.set(key, row)
  }
  return Array.from(byKey.values()).sort((a, b) => a.created_at.localeCompare(b.created_at))
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

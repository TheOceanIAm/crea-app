import type { SupabaseClient } from '@supabase/supabase-js'

import { workspaceMessagesNearDuplicate } from '@/lib/workspaceMessages'

type DeleteOpts = {
  messageId: string
  senderId: string
  body: string
  createdAt: string
  jobId: string | null
  projectId: string
}

function rowMatchesDelete(
  row: { id: string; sender_id: string; content: string; created_at: string },
  opts: DeleteOpts
): boolean {
  if (row.sender_id !== opts.senderId) return false
  if (row.id === opts.messageId) return true
  return workspaceMessagesNearDuplicate(
    { senderId: row.sender_id, body: row.content, createdAt: row.created_at },
    { senderId: opts.senderId, body: opts.body, createdAt: opts.createdAt }
  )
}

/** Remove own message and any mirrored duplicate (job_messages ↔ project_messages). */
export async function deleteOwnWorkspaceMessage(
  db: SupabaseClient,
  opts: DeleteOpts
): Promise<{ error: string | null }> {
  let deletedCount = 0
  const errors: string[] = []

  if (opts.jobId) {
    const { data: jobRows, error: jobSelErr } = await db
      .from('job_messages')
      .select('id, sender_id, content, created_at')
      .eq('job_id', opts.jobId)
      .eq('sender_id', opts.senderId)
    if (jobSelErr) errors.push(jobSelErr.message)

    for (const row of jobRows ?? []) {
      const r = row as { id: string; sender_id: string; content: string; created_at: string }
      if (!rowMatchesDelete(r, opts)) continue
      const { error } = await db.from('job_messages').delete().eq('id', r.id).eq('sender_id', opts.senderId)
      if (error) errors.push(error.message)
      else deletedCount += 1
    }
  }

  const { data: projRows, error: projSelErr } = await db
    .from('project_messages')
    .select('id, sender_id, body, created_at')
    .eq('project_id', opts.projectId)
    .eq('sender_id', opts.senderId)
  if (projSelErr) errors.push(projSelErr.message)

  for (const row of projRows ?? []) {
    const r = row as { id: string; sender_id: string; body: string; created_at: string }
    const normalized = {
      id: r.id,
      sender_id: r.sender_id,
      content: r.body,
      created_at: r.created_at,
    }
    if (!rowMatchesDelete(normalized, opts)) continue
    const { error } = await db
      .from('project_messages')
      .delete()
      .eq('id', r.id)
      .eq('sender_id', opts.senderId)
    if (error) errors.push(error.message)
    else deletedCount += 1
  }

  if (deletedCount > 0) return { error: null }
  const unique = [...new Set(errors)]
  if (unique.length > 0) return { error: unique[0] }
  return { error: 'Message not found or already deleted.' }
}

export function filterRowsAfterDelete<
  T extends { id: string; sender_id: string; body: string; created_at: string },
>(prev: T[], deleted: T): T[] {
  return prev.filter(
    (m) =>
      m.id !== deleted.id &&
      !workspaceMessagesNearDuplicate(
        { senderId: m.sender_id, body: m.body, createdAt: m.created_at },
        { senderId: deleted.sender_id, body: deleted.body, createdAt: deleted.created_at }
      )
  )
}

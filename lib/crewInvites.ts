import { supabase } from '@/lib/supabase'

/**
 * Crew invite -> accept helpers.
 *
 * A company/lead "adds" a freelancer via `add_project_crew_by_profile_id` which
 * now creates a PENDING `project_crew_invites` row (no access). The freelancer
 * accepts/declines via `respond_to_project_crew_invite`; only on accept is a
 * `project_members` row created (which grants workspace access).
 *
 * All reads are resilient: if the migration hasn't been deployed yet (table /
 * RPC missing), they resolve to empty instead of throwing, so the app keeps
 * working before and after the backend deploy.
 */

export type IncomingCrewInvite = {
  id: string
  projectId: string
  projectTitle: string
  companyName: string
  invitedAt: string
}

export type ProjectCrewInvite = {
  id: string
  profileId: string
  name: string
  avatarUrl: string | null
  invitedAt: string
}

function isMissingInviteBackend(message: string | null | undefined): boolean {
  const m = (message ?? '').toLowerCase()
  return (
    m.includes('project_crew_invites') ||
    m.includes('list_my_crew_invites') ||
    m.includes('list_project_crew_invites') ||
    m.includes('respond_to_project_crew_invite') ||
    m.includes('cancel_project_crew_invite') ||
    m.includes('does not exist') ||
    m.includes('could not find') ||
    m.includes('schema cache')
  )
}

/** Pending invites for the signed-in freelancer (for the Alerts feed). */
export async function listMyCrewInvites(): Promise<IncomingCrewInvite[]> {
  try {
    const { data, error } = await supabase.rpc('list_my_crew_invites')
    if (error) {
      if (!isMissingInviteBackend(error.message)) {
        console.warn('[crewInvites] list_my_crew_invites', error.message)
      }
      return []
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      projectTitle: String(r.project_title ?? 'Project'),
      companyName: String(r.company_name ?? 'A company'),
      invitedAt: String(r.invited_at ?? new Date().toISOString()),
    }))
  } catch {
    return []
  }
}

/** Pending invites the company/lead has sent for a project. */
export async function listProjectCrewInvites(projectId: string): Promise<ProjectCrewInvite[]> {
  try {
    const { data, error } = await supabase.rpc('list_project_crew_invites', { p_project_id: projectId })
    if (error) {
      if (!isMissingInviteBackend(error.message)) {
        console.warn('[crewInvites] list_project_crew_invites', error.message)
      }
      return []
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const url = typeof r.avatar_url === 'string' ? r.avatar_url.trim() : ''
      return {
        id: String(r.id),
        profileId: String(r.profile_id),
        name: (typeof r.name === 'string' && r.name.trim()) || 'Freelancer',
        avatarUrl: url && /^https?:\/\//i.test(url) ? url : null,
        invitedAt: String(r.invited_at ?? new Date().toISOString()),
      }
    })
  } catch {
    return []
  }
}

export async function respondToCrewInvite(
  inviteId: string,
  action: 'accept' | 'decline'
): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('respond_to_project_crew_invite', {
      p_invite_id: inviteId,
      p_action: action,
    })
    if (error) {
      if (isMissingInviteBackend(error.message)) {
        return { ok: false, error: 'Invitations are not available yet. Please try again later.' }
      }
      return { ok: false, error: error.message }
    }
    return { ok: true, status: typeof data === 'string' ? data : action }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' }
  }
}

export async function cancelCrewInvite(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc('cancel_project_crew_invite', { p_invite_id: inviteId })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' }
  }
}

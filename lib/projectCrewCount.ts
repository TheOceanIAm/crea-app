import type { SupabaseClient } from '@supabase/supabase-js'

/** Crew rows shown in the native project Crew tab (registered + manual). */
export async function countProjectCrewMembers(
  supabase: SupabaseClient,
  projectId: string
): Promise<number> {
  const [membersRes, manualRes] = await Promise.all([
    supabase
      .from('project_members')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId),
    supabase
      .from('project_manual_crew_readable')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('claimed_profile_id', null),
  ])
  return (membersRes.count ?? 0) + (manualRes.count ?? 0)
}

export function crewMembersSubLabel(count: number): string {
  return count === 1 ? 'member added' : 'members added'
}

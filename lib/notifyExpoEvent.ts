import { supabase } from '@/lib/supabase'

export type NotifyExpoKind =
  | 'job_application'
  | 'invoice'
  | 'project_message'
  | 'workspace_ready'
  | 'project_crew_invite'

export async function notifyExpoEvent(payload: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('notify-expo-event', { body: payload })
    if (error) console.warn('[notify-expo-event]', error.message)
  } catch (e) {
    console.warn('[notify-expo-event]', e)
  }
}

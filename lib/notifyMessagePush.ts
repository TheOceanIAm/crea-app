import { supabase } from '@/lib/supabase'

/**
 * Asks the backend to send a remote push to the other participant (Expo → APNs/FCM).
 * No-op if the function is not deployed or the recipient has push disabled.
 */
export async function requestNotifyRecipientPush(messageId: string): Promise<void> {
  if (!messageId) return
  try {
    const { error } = await supabase.functions.invoke('notify-message-push', {
      body: { messageId },
    })
    if (error) {
      console.warn('[notify-message-push]', error.message)
    }
  } catch (e) {
    console.warn('[notify-message-push]', e)
  }
}

import { Platform } from 'react-native'
import { supabase } from '@/lib/supabase'
import { parseNotificationSettings } from '@/lib/profileSettingsExtras'
import { registerForExpoPushTokenAsync } from '@/lib/pushNotifications'

/** Registers Expo push token once per session when permissions allow (physical device). */
export async function registerPushTokenSilently(): Promise<void> {
  if (Platform.OS === 'web') return
  const res = await registerForExpoPushTokenAsync()
  if (!res.ok || !('token' in res)) return

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { data: prof } = await supabase
    .from('profiles')
    .select('notification_settings')
    .eq('id', user.id)
    .maybeSingle()

  const parsed = parseNotificationSettings(prof?.notification_settings)
  if (parsed.expoPushToken === res.token && parsed.pushEnabled) return

  const next = {
    ...parsed,
    expoPushToken: res.token,
    pushEnabled: true,
  }
  await supabase.from('profiles').update({ notification_settings: next }).eq('id', user.id)
}

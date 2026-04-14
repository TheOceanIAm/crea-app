import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  })
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
  })
}

export type PushRegisterResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'web' | 'simulator' | 'denied' | string }

/**
 * Requests OS permission and returns an Expo push token for this install.
 * Persist the token on your user profile so Supabase/Edge Functions can send pushes via Expo’s API.
 */
export async function registerForExpoPushTokenAsync(): Promise<PushRegisterResult> {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web' }
  }
  await ensureAndroidNotificationChannel()
  if (!Device.isDevice) {
    return { ok: false, reason: 'simulator' }
  }
  const { status: existing } = await Notifications.getPermissionsAsync()
  let next = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    next = status
  }
  if (next !== 'granted') {
    return { ok: false, reason: 'denied' }
  }
  try {
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )
    return { ok: true, token: tokenData.data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unavailable'
    return { ok: false, reason: msg }
  }
}

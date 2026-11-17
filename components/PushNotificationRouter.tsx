import { useEffect } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useRouter, type Href } from 'expo-router'

import { hrefFromNotificationData, hrefFromNotificationResponse } from '@/lib/incomingEntryHref'

function openFromData(router: ReturnType<typeof useRouter>, data: Record<string, unknown> | undefined) {
  const href = hrefFromNotificationData(data)
  if (href) router.push(href as Href)
}

/**
 * Opens the conversation when the user taps a push notification (cold start + background).
 */
export function PushNotificationRouter() {
  const router = useRouter()

  useEffect(() => {
    if (Platform.OS === 'web') return

    void Notifications.getLastNotificationResponseAsync().then((r) => {
      const href = hrefFromNotificationResponse(r)
      if (href) router.push(href as Href)
    })

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined
      openFromData(router, data)
    })
    return () => sub.remove()
  }, [router])

  return null
}

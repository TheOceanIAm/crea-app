import { useEffect } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'

function openFromData(router: ReturnType<typeof useRouter>, data: Record<string, unknown> | undefined) {
  if (!data || typeof data !== 'object') return
  const cid = data.conversationId
  if (typeof cid === 'string' && cid.length > 0) {
    router.push(`/conversation/${cid}`)
  }
}

/**
 * Opens the conversation when the user taps a push notification (cold start + background).
 */
export function PushNotificationRouter() {
  const router = useRouter()

  useEffect(() => {
    if (Platform.OS === 'web') return

    void Notifications.getLastNotificationResponseAsync().then((r) => {
      const data = r?.notification.request.content.data as Record<string, unknown> | undefined
      if (data?.type === 'message') openFromData(router, data)
    })

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined
      if (data?.type === 'message') openFromData(router, data)
    })
    return () => sub.remove()
  }, [router])

  return null
}

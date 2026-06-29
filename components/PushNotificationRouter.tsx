import { useEffect } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'

function openFromData(router: ReturnType<typeof useRouter>, data: Record<string, unknown> | undefined) {
  if (!data || typeof data !== 'object') return
  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'message') {
    const cid = data.conversationId
    if (typeof cid === 'string' && cid.length > 0) router.push(`/conversation/${cid}`)
    return
  }
  if (type === 'invoice') {
    const id = data.invoiceId
    if (typeof id === 'string' && id.length > 0) router.push(`/(tabs)/invoices/${id}`)
    return
  }
  if (type === 'job_application') {
    router.push('/(tabs)/company-applications')
    return
  }
  if (type === 'project_crew_invite') {
    // Invitee accepts/declines in the Alerts tab (no workspace access yet).
    router.push('/(tabs)/notifications')
    return
  }
  if (type === 'workspace_ready' || type === 'project_message' || type === 'workspace_activity') {
    const pid = data.projectId
    if (typeof pid === 'string' && pid.length > 0) {
      router.push(`/project/${pid}`)
      return
    }
    return
  }
  if (type === 'profile_completion') {
    router.push('/(tabs)/profile')
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
      openFromData(router, data)
    })

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined
      openFromData(router, data)
    })
    return () => sub.remove()
  }, [router])

  return null
}

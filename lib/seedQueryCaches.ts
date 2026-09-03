import { queryClient } from '@/lib/queryClient'
import { messagesKey, notificationsKey, conversationKey } from '@/lib/queryKeys'
import { readCachedMessages, type MessagesCache } from '@/lib/messagesCache'
import { readCachedNotifications, type NotificationsCache } from '@/lib/notificationsCache'
import { readCachedConversation, type ConversationCache } from '@/lib/conversationCache'

/** Seed QueryClient from in-memory caches so screens paint without waiting for mount hooks. */
export function seedMessagesQuery(
  userId: string,
  data?: MessagesCache | null,
  opts?: { force?: boolean }
): void {
  const payload = data ?? readCachedMessages(userId)
  if (!payload) return
  if (!opts?.force && queryClient.getQueryData(messagesKey(userId))) return
  queryClient.setQueryData(messagesKey(userId), payload)
}

export function seedNotificationsQuery(
  userId: string,
  data?: NotificationsCache | null,
  opts?: { force?: boolean }
): void {
  const payload = data ?? readCachedNotifications(userId)
  if (!payload) return
  if (!opts?.force && queryClient.getQueryData(notificationsKey(userId))) return
  queryClient.setQueryData(notificationsKey(userId), payload)
}

export function seedConversationQuery(conversationId: string, data?: ConversationCache | null): void {
  const payload = data ?? readCachedConversation(conversationId)
  if (!payload) return
  if (queryClient.getQueryData(conversationKey(conversationId))) return
  queryClient.setQueryData(conversationKey(conversationId), payload)
}

/** After disk hydrate: push mem hits into QueryClient for instant tab paint. */
export function seedSecondaryQueriesFromMem(userId: string): void {
  seedMessagesQuery(userId)
  seedNotificationsQuery(userId)
}

/** Shared TanStack Query keys — keep bootstrap seeding and screens in sync. */

export const authUserIdKey = ['authUserId'] as const

export const messagesKey = (userId: string | null | undefined) =>
  ['messages', userId ?? 'anon'] as const

export const notificationsKey = (userId: string | null | undefined) =>
  ['notifications', userId ?? 'anon'] as const

export const conversationKey = (conversationId: string) =>
  ['conversation', conversationId] as const

export const dashboardKey = (userId: string | null | undefined) =>
  ['dashboardOverview', userId ?? 'anon'] as const

/** Lets conversation threads / inbox refresh the tab-bar DM badge without relying on Realtime UPDATE delivery. */

import { queryClient } from '@/lib/queryClient'

type Listener = () => void
const listeners = new Set<Listener>()

/** @deprecated Badge now lives in TanStack Query; kept for any non-query listeners. */
export function subscribeDmBadgeInvalidate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function invalidateDmBadge(): void {
  for (const fn of listeners) fn()
  // Matches every ['unreadDmCount', <userId>] query regardless of user id.
  void queryClient.invalidateQueries({ queryKey: ['unreadDmCount'] })
}

/** Pub/sub so conversation threads can refresh the tab-bar DM dot without relying on Realtime UPDATE delivery. */

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeDmBadgeInvalidate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function invalidateDmBadge(): void {
  for (const fn of listeners) fn()
}

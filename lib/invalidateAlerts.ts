/** Lightweight pub/sub so realtime bridges can refresh Alerts badge without prop drilling. */

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeAlertsInvalidate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function invalidateAlertsBadge(): void {
  for (const fn of listeners) fn()
}

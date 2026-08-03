/** Lightweight pub/sub so realtime bridges can refresh Alerts badge without prop drilling. */

import type { NotificationRow } from '@/lib/notificationsFeed'

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeAlertsInvalidate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function invalidateAlertsBadge(): void {
  for (const fn of listeners) fn()
}

export type AlertsLivePatch = {
  userId: string
  row: NotificationRow
}

type LiveListener = (patch: AlertsLivePatch) => void
const liveListeners = new Set<LiveListener>()

export function subscribeAlertsLivePatch(fn: LiveListener): () => void {
  liveListeners.add(fn)
  return () => liveListeners.delete(fn)
}

export function publishAlertsLivePatch(patch: AlertsLivePatch): void {
  for (const fn of liveListeners) fn(patch)
}

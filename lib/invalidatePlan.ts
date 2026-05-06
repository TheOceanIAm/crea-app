/** Lightweight pub/sub for plan changes so feature-gated screens refresh immediately. */

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribePlanInvalidate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function invalidatePlan(): void {
  for (const fn of listeners) fn()
}

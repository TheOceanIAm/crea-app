type PlanSyncListener = () => void

const listeners = new Set<PlanSyncListener>()

export function emitPlanChanged(): void {
  for (const cb of listeners) {
    try {
      cb()
    } catch {
      // Keep other listeners alive even if one fails.
    }
  }
}

export function subscribePlanChanged(listener: PlanSyncListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

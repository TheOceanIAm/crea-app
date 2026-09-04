import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

const KEY = 'crea:offline-shot-outbox'

export type OfflineShotStatus = 'open' | 'rolling' | 'done' | 'pick'

export type ShotStatusOutboxItem = {
  projectId: string
  shotId: string
  status: OfflineShotStatus
  queuedAt: string
}

async function readAll(): Promise<ShotStatusOutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ShotStatusOutboxItem[]
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.shotId && x.projectId) : []
  } catch {
    return []
  }
}

async function writeAll(items: ShotStatusOutboxItem[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(items))
}

/** Keep the latest status per shot. */
export async function queueShotStatus(item: Omit<ShotStatusOutboxItem, 'queuedAt'>): Promise<void> {
  const queuedAt = new Date().toISOString()
  const all = await readAll()
  const next = all.filter((x) => !(x.projectId === item.projectId && x.shotId === item.shotId))
  next.push({ ...item, queuedAt })
  await writeAll(next)
}

export async function pendingShotStatuses(projectId: string): Promise<Map<string, OfflineShotStatus>> {
  const map = new Map<string, OfflineShotStatus>()
  for (const item of await readAll()) {
    if (item.projectId === projectId) map.set(item.shotId, item.status)
  }
  return map
}

export async function pendingShotStatusCount(projectId: string): Promise<number> {
  return (await pendingShotStatuses(projectId)).size
}

export function applyOutboxToShots<T extends { id: string; status: OfflineShotStatus }>(
  shots: T[],
  pending: Map<string, OfflineShotStatus>
): T[] {
  if (pending.size === 0) return shots
  return shots.map((s) => {
    const status = pending.get(s.id)
    return status ? { ...s, status } : s
  })
}

export async function overlayPendingStatuses<T extends { id: string; status: OfflineShotStatus }>(
  projectId: string,
  shots: T[]
): Promise<T[]> {
  const pending = await pendingShotStatuses(projectId)
  return applyOutboxToShots(shots, pending)
}

export async function flushShotStatusOutbox(
  projectId: string
): Promise<{ flushed: number; remaining: number }> {
  const all = await readAll()
  const mine = all.filter((x) => x.projectId === projectId)
  const others = all.filter((x) => x.projectId !== projectId)
  if (mine.length === 0) return { flushed: 0, remaining: 0 }

  const latest = new Map<string, ShotStatusOutboxItem>()
  for (const item of mine) latest.set(item.shotId, item)

  const failed: ShotStatusOutboxItem[] = []
  let flushed = 0
  for (const item of latest.values()) {
    const { error } = await supabase
      .from('production_shots')
      .update({ status: item.status })
      .eq('id', item.shotId)
      .eq('project_id', projectId)
    if (error) failed.push(item)
    else flushed += 1
  }
  await writeAll([...others, ...failed])
  return { flushed, remaining: failed.length }
}

export async function clearShotStatusOutbox(projectId: string): Promise<void> {
  const all = await readAll()
  await writeAll(all.filter((x) => x.projectId !== projectId))
}

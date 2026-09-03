import { getCache, setCache } from '@/lib/appCache'
import {
  type CalendarDefaultMode,
  type CellState,
  parseAvailabilityCalendar,
} from '@/lib/availabilityCalendar'
import { getAuthUser } from '@/lib/getAuthUser'
import { isFreelancerProfile } from '@/lib/profileRole'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { supabase } from '@/lib/supabase'
import { LIST_DISK_TTL_MS, LIST_MEM_TTL_MS } from '@/lib/cachePolicy'

export type AvailabilityCache = {
  role: string | null
  days: Record<string, CellState>
  notes: string
  defaultMode: CalendarDefaultMode
}

const MEM_TTL_MS = LIST_MEM_TTL_MS
const DISK_TTL_MS = LIST_DISK_TTL_MS

export function availabilityCacheKey(userId: string): string {
  return `availability:${userId}`
}

function availabilityDiskKey(userId: string): string {
  return `crea:availability:${userId}`
}

export function readCachedAvailability(userId: string): AvailabilityCache | null {
  return getCache<AvailabilityCache>(availabilityCacheKey(userId))
}

export function cacheAvailability(userId: string, data: AvailabilityCache): void {
  setCache(availabilityCacheKey(userId), data, MEM_TTL_MS)
}

export async function hydrateAvailabilityFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<AvailabilityCache>(availabilityDiskKey(userId))
  if (!hit) return false
  cacheAvailability(userId, hit)
  return true
}

async function persistAvailabilityToDisk(userId: string, data: AvailabilityCache): Promise<void> {
  await writePersistedCache(availabilityDiskKey(userId), data, DISK_TTL_MS)
}

export async function loadAvailabilityCache(userId: string): Promise<AvailabilityCache | null> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, availability_calendar')
    .eq('id', userId)
    .single()
  if (error) return null

  const role = profile?.role ?? null
  if (!isFreelancerProfile(role)) {
    return { role, days: {}, notes: '', defaultMode: 'available' }
  }

  const parsed = parseAvailabilityCalendar(profile?.availability_calendar)
  return {
    role,
    days: parsed.days,
    notes: parsed.notes ?? '',
    defaultMode: parsed.version === 3 ? 'available' : 'off',
  }
}

let inflight: Promise<void> | null = null

export async function prefetchAvailability(userId: string): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    if (!readCachedAvailability(userId)) {
      await hydrateAvailabilityFromDisk(userId)
    }
    const user = await getAuthUser()
    if (!user || user.id !== userId) return
    const data = await loadAvailabilityCache(userId)
    if (!data) return
    cacheAvailability(userId, data)
    void persistAvailabilityToDisk(userId, data)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

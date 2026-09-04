import { supabase } from '@/lib/supabase'
import {
  downloadOfflinePack,
  isNetworkAvailable,
  readOfflinePack,
  shouldPreferOfflinePack,
  type OfflinePack,
} from '@/lib/offlinePack'
import { pendingShotStatuses } from '@/lib/offlineShotOutbox'

export type PackFreshness = {
  changes: number
  shootSoon: boolean
  nextShootDate: string | null
  shootSoonLabel: 'today' | 'tomorrow' | null
}

function localYmd(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  dt.setDate(dt.getDate() + days)
  return localYmd(dt)
}

function isoMs(raw: string | null | undefined): number {
  if (!raw) return 0
  const n = Date.parse(raw)
  return Number.isFinite(n) ? n : 0
}

function shootSoonFromDates(dates: string[]): Pick<PackFreshness, 'shootSoon' | 'nextShootDate' | 'shootSoonLabel'> {
  const today = localYmd()
  const tomorrow = addDaysYmd(today, 1)
  const sorted = [...dates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (sorted.includes(today)) {
    return { shootSoon: true, nextShootDate: today, shootSoonLabel: 'today' }
  }
  if (sorted.includes(tomorrow)) {
    return { shootSoon: true, nextShootDate: tomorrow, shootSoonLabel: 'tomorrow' }
  }
  return { shootSoon: false, nextShootDate: sorted.find((d) => d >= today) ?? null, shootSoonLabel: null }
}

export function packShootSoon(pack: OfflinePack): PackFreshness {
  const soon = shootSoonFromDates(pack.shootDates)
  return { changes: 0, ...soon }
}

export async function probePackFreshness(projectId: string): Promise<PackFreshness | null> {
  const pack = await readOfflinePack(projectId)
  if (!pack) return null
  const soon = shootSoonFromDates(pack.shootDates)
  const online = await isNetworkAvailable()
  if (!online) return { changes: 0, ...soon }

  const pending = await pendingShotStatuses(projectId)
  const downloadedMs = isoMs(pack.downloadedAt)

  const [shotsRes, daysRes, membersRes, manualRes, milesRes] = await Promise.all([
    supabase.from('production_shots').select('id, updated_at, status').eq('project_id', projectId),
    supabase.from('production_days').select('id, date, updated_at').eq('project_id', projectId),
    supabase.from('project_members').select('id').eq('project_id', projectId),
    supabase.from('project_manual_crew_readable').select('id, claimed_profile_id').eq('project_id', projectId),
    pack.jobId
      ? supabase.from('milestones').select('id, status').eq('job_id', pack.jobId)
      : Promise.resolve({ data: [] as Array<{ id: string; status: string }>, error: null }),
  ])

  if (shotsRes.error || daysRes.error) return { changes: 0, ...soon }

  let changes = 0
  const packShotIds = new Set(pack.shots.map((s) => s.id))
  const remoteShots = (shotsRes.data ?? []) as Array<{ id: string; updated_at?: string; status?: string }>
  const remoteShotIds = new Set<string>()
  for (const row of remoteShots) {
    remoteShotIds.add(row.id)
    if (!packShotIds.has(row.id)) {
      changes += 1
      continue
    }
    if (pending.has(row.id)) continue
    if (isoMs(row.updated_at) > downloadedMs + 1500) changes += 1
  }
  for (const shot of pack.shots) {
    if (!remoteShotIds.has(shot.id)) changes += 1
  }

  const packDayIds = new Set(pack.productionDays.map((d) => d.id))
  const remoteDays = (daysRes.data ?? []) as Array<{ id: string; updated_at?: string }>
  const remoteDayIds = new Set<string>()
  for (const row of remoteDays) {
    remoteDayIds.add(row.id)
    if (!packDayIds.has(row.id)) {
      changes += 1
      continue
    }
    if (isoMs(row.updated_at) > downloadedMs + 1500) changes += 1
  }
  for (const day of pack.productionDays) {
    if (!remoteDayIds.has(day.id)) changes += 1
  }

  let manualCount = 0
  const manualRows = (manualRes.data ?? []) as Array<{ claimed_profile_id?: string | null }>
  if (!manualRes.error) {
    manualCount = manualRows.filter((m) => !(typeof m.claimed_profile_id === 'string' && m.claimed_profile_id.trim()))
      .length
  }
  const remoteCrew = (membersRes.data?.length ?? 0) + manualCount
  if (remoteCrew !== pack.crew.length) changes += Math.abs(remoteCrew - pack.crew.length)

  if (!milesRes.error) {
    const remoteMiles = (milesRes.data ?? []) as Array<{ id: string; status?: string }>
    const packMiles = new Map(pack.milestones.map((m) => [m.id, m.status]))
    const remoteIds = new Set<string>()
    for (const row of remoteMiles) {
      remoteIds.add(row.id)
      const local = packMiles.get(row.id)
      if (!local || local !== row.status) changes += 1
    }
    for (const id of packMiles.keys()) {
      if (!remoteIds.has(id)) changes += 1
    }
  }

  return { changes, ...soon }
}

const lastSilentAt = new Map<string, number>()
const SILENT_MIN_MS = 90_000

export async function maybeSilentRefreshPack(opts: {
  projectId: string
  projectTitle: string
  jobId?: string | null
  shootDates?: string[]
  projectLocation?: string | null
}): Promise<'skipped' | 'updated' | 'failed'> {
  if (shouldPreferOfflinePack(opts.projectId)) return 'skipped'
  const pack = await readOfflinePack(opts.projectId)
  if (!pack) return 'skipped'
  const now = Date.now()
  const last = lastSilentAt.get(opts.projectId) ?? 0
  if (now - last < SILENT_MIN_MS) return 'skipped'
  if (now - isoMs(pack.downloadedAt) < SILENT_MIN_MS) return 'skipped'
  const online = await isNetworkAvailable()
  if (!online) return 'skipped'
  lastSilentAt.set(opts.projectId, now)
  const result = await downloadOfflinePack({ ...opts, silent: true })
  return result.ok ? 'updated' : 'failed'
}

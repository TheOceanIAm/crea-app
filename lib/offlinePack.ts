import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system'
import { supabase } from '@/lib/supabase'
import { isRetryableSupabaseError } from '@/lib/userFacingError'
import { crewDisplayRole } from '@/lib/jobApplicationRole'
import {
  calendarDatesFromSlots,
  formatBookedSlotsSummary,
  memberBookedSlotsFromRow,
  type BookedDateEntry,
} from '@/lib/memberBookedDates'
import { fetchWorkspaceMilestones, type WorkspaceMilestoneUi } from '@/lib/workspaceMilestones'
import { fetchProductionEquipment, fetchProductionTasks, type ProductionEquipmentItem, type ProductionTask } from '@/lib/productionLists'
import { overlayPendingStatuses, type OfflineShotStatus } from '@/lib/offlineShotOutbox'
import { buildCallSheetHtml, generateCallSheetPdfFile } from '@/lib/offlineCallSheetPdf'

export type { OfflineShotStatus }

export const OFFLINE_PACK_VERSION = 2 as const
const SUPPORTED_PACK_VERSIONS = new Set([1, 2])

export type OfflineShot = {
  id: string
  project_id: string
  shoot_date: string
  scene_nr: string
  description: string
  lens: string
  location: string
  framing: string
  audio_notes: string
  brief_ai_synced: boolean
  status: OfflineShotStatus
  created_at: string
  updated_at: string
}

export type OfflineCallOverride = { call_time?: string; location?: string }

export type OfflineProductionDay = {
  id: string
  project_id: string
  date: string
  wrap_time: string | null
  notes: string | null
  call_sheet: Record<string, OfflineCallOverride>
}

export type OfflineCallSheetCrew = {
  key: string
  name: string
  roleLabel: string
  source: 'member' | 'manual'
}

export type OfflineCrewMember = {
  source: 'registered' | 'manual'
  id: string
  profile_id?: string
  member_role: string
  name: string
  subtitle: string
  role_display?: string | null
  email: string | null
  phone: string | null
  avatar_url?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contact_label?: string | null
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
  bookingDates: string[]
  bookingSlots: BookedDateEntry[]
  day_rate_amount?: number | null
  half_day_rate_amount?: number | null
  inviteStatus?: 'none' | 'pending'
  pendingInviteId?: string | null
}

export type OfflinePack = {
  version: typeof OFFLINE_PACK_VERSION
  projectId: string
  jobId: string | null
  projectTitle: string
  downloadedAt: string
  shootDates: string[]
  shots: OfflineShot[]
  productionDays: OfflineProductionDay[]
  callSheetCrew: OfflineCallSheetCrew[]
  crew: OfflineCrewMember[]
  milestones: WorkspaceMilestoneUi[]
  tasks?: ProductionTask[]
  equipment?: ProductionEquipmentItem[]
  /** YYYY-MM-DD → filename inside the pack files folder. */
  callSheetPdfs?: Record<string, string>
}

export type OfflinePackMeta = {
  projectId: string
  projectTitle: string
  downloadedAt: string
  shootDates: string[]
  bytes: number
  pdfDays?: number
}

const preferPackIds = new Set<string>()
const packListeners = new Set<(projectId: string) => void>()

export function subscribeOfflinePack(listener: (projectId: string) => void): () => void {
  packListeners.add(listener)
  return () => {
    packListeners.delete(listener)
  }
}

function notifyOfflinePack(projectId: string) {
  for (const listener of packListeners) listener(projectId)
}

export function setPreferOfflinePack(projectId: string, on: boolean) {
  if (on) preferPackIds.add(projectId)
  else preferPackIds.delete(projectId)
  notifyOfflinePack(projectId)
}

export function shouldPreferOfflinePack(projectId: string): boolean {
  return preferPackIds.has(projectId)
}

export const OFFLINE_READ_ONLY_TITLE = 'Downloaded version'
export const OFFLINE_READ_ONLY_MESSAGE =
  'Connect to the internet to edit this field. Shot status still saves on this device and syncs later.'

function packsDir(): string | null {
  const root = FileSystem.documentDirectory
  if (!root) return null
  return `${root}crea-offline-packs/`
}

function packPath(projectId: string): string | null {
  const dir = packsDir()
  if (!dir) return null
  return `${dir}${projectId}.json`
}

export function packFilesDir(projectId: string): string | null {
  const dir = packsDir()
  if (!dir) return null
  return `${dir}${projectId}/`
}

async function ensurePacksDir(): Promise<string | null> {
  const dir = packsDir()
  if (!dir) return null
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  return dir
}

function isSupportedPack(parsed: unknown): parsed is OfflinePack {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as OfflinePack
  return SUPPORTED_PACK_VERSIONS.has(Number(p.version)) && typeof p.projectId === 'string'
}

function metaFromPack(pack: OfflinePack, bytes: number): OfflinePackMeta {
  return {
    projectId: pack.projectId,
    projectTitle: pack.projectTitle,
    downloadedAt: pack.downloadedAt,
    shootDates: pack.shootDates,
    bytes,
    pdfDays: pack.callSheetPdfs ? Object.keys(pack.callSheetPdfs).length : 0,
  }
}

async function fileBytes(path: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(path)
  return 'size' in info && typeof info.size === 'number' ? info.size : 0
}

async function writePackFile(pack: OfflinePack): Promise<OfflinePackMeta> {
  const dir = await ensurePacksDir()
  const path = packPath(pack.projectId)
  if (!dir || !path) throw new Error('This device cannot store an offline pack.')
  await FileSystem.writeAsStringAsync(path, JSON.stringify(pack))
  return metaFromPack(pack, await fileBytes(path))
}

export function formatOfflinePackStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'saved'
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function isNetworkAvailable(): Promise<boolean> {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim()
  if (!url) return false
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
      method: 'GET',
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    return true
  } catch {
    return false
  }
}

export function isOfflineFetchError(error: unknown): boolean {
  return isRetryableSupabaseError(error)
}

export async function readOfflinePack(projectId: string): Promise<OfflinePack | null> {
  if (Platform.OS === 'web') return null
  const path = packPath(projectId)
  if (!path) return null
  try {
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return null
    const raw = await FileSystem.readAsStringAsync(path)
    const parsed = JSON.parse(raw) as OfflinePack
    if (!isSupportedPack(parsed) || parsed.projectId !== projectId) return null
    return parsed
  } catch {
    return null
  }
}

export async function getOfflinePackMeta(projectId: string): Promise<OfflinePackMeta | null> {
  if (Platform.OS === 'web') return null
  const path = packPath(projectId)
  if (!path) return null
  try {
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return null
    const pack = await readOfflinePack(projectId)
    if (!pack) return null
    return metaFromPack(pack, 'size' in info && typeof info.size === 'number' ? info.size : 0)
  } catch {
    return null
  }
}

export async function deleteOfflinePack(projectId: string): Promise<void> {
  preferPackIds.delete(projectId)
  const path = packPath(projectId)
  if (path) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
  }
  const files = packFilesDir(projectId)
  if (files) {
    await FileSystem.deleteAsync(files, { idempotent: true }).catch(() => {})
  }
  notifyOfflinePack(projectId)
}

export async function getPackedCallSheetPdfUri(projectId: string, shootDay: string): Promise<string | null> {
  const pack = await readOfflinePack(projectId)
  const dir = packFilesDir(projectId)
  if (!pack || !dir) return null
  const date = shootDay.slice(0, 10)
  const named = pack.callSheetPdfs?.[date]
  const candidates = [named ? `${dir}${named}` : null, `${dir}call-sheet-${date}.pdf`].filter(Boolean) as string[]
  for (const candidate of candidates) {
    const info = await FileSystem.getInfoAsync(candidate)
    if (info.exists) return candidate
  }
  return null
}

export async function patchShotStatusInPack(
  projectId: string,
  shotId: string,
  status: OfflineShotStatus
): Promise<void> {
  const pack = await readOfflinePack(projectId)
  if (!pack) return
  pack.shots = pack.shots.map((s) =>
    s.id === shotId ? { ...s, status, updated_at: new Date().toISOString() } : s
  )
  await writePackFile(pack)
}

function roleLabel(r: string) {
  if (r === 'company') return 'Client'
  if (r === 'lead') return 'Lead'
  return 'Crew'
}

function parseOptionalRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 100) / 100
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100
  }
  return null
}

function normalizeShot(raw: Record<string, unknown>): OfflineShot {
  const status = String(raw.status ?? 'open')
  const ok: OfflineShotStatus =
    status === 'rolling' || status === 'done' || status === 'pick' || status === 'open' ? status : 'open'
  return {
    id: String(raw.id),
    project_id: String(raw.project_id),
    shoot_date: String(raw.shoot_date ?? '').slice(0, 10),
    scene_nr: String(raw.scene_nr ?? ''),
    description: String(raw.description ?? ''),
    lens: String(raw.lens ?? ''),
    location: String(raw.location ?? ''),
    framing: String(raw.framing ?? ''),
    audio_notes: String(raw.audio_notes ?? ''),
    brief_ai_synced: Boolean(raw.brief_ai_synced),
    status: ok,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  }
}

function parseProductionDay(raw: Record<string, unknown>): OfflineProductionDay | null {
  if (raw.id == null || raw.project_id == null) return null
  return {
    id: String(raw.id),
    project_id: String(raw.project_id),
    date: String(raw.date ?? '').slice(0, 10),
    wrap_time: (raw.wrap_time as string | null) ?? null,
    notes: (raw.notes as string | null) ?? null,
    call_sheet: (raw.call_sheet as Record<string, OfflineCallOverride>) ?? {},
  }
}

function callSheetCrewFromMembers(crew: OfflineCrewMember[]): OfflineCallSheetCrew[] {
  return crew.map((m) =>
    m.source === 'registered'
      ? {
          key: m.profile_id || m.id,
          name: m.name,
          roleLabel: m.role_display || roleLabel(m.member_role),
          source: 'member' as const,
        }
      : {
          key: `manual:${m.id}`,
          name: m.name,
          roleLabel: m.role_display || m.member_role || 'Crew',
          source: 'manual' as const,
        }
  )
}

export function productionFromPack(
  pack: OfflinePack,
  shootDay: string
): {
  shots: OfflineShot[]
  prodDay: OfflineProductionDay | null
  crew: OfflineCallSheetCrew[]
} {
  const day = shootDay.slice(0, 10)
  return {
    shots: pack.shots.filter((s) => s.shoot_date === day),
    prodDay: pack.productionDays.find((d) => d.date === day) ?? null,
    crew: pack.callSheetCrew,
  }
}

export async function downloadOfflinePack(opts: {
  projectId: string
  projectTitle: string
  jobId?: string | null
  shootDates?: string[]
  projectLocation?: string | null
  silent?: boolean
}): Promise<{ ok: true; meta: OfflinePackMeta } | { ok: false; error: string }> {
  if (Platform.OS === 'web') {
    return { ok: false, error: 'Offline packs are available in the iOS and Android apps.' }
  }
  const dir = await ensurePacksDir()
  const path = packPath(opts.projectId)
  if (!dir || !path) {
    return { ok: false, error: 'This device cannot store an offline pack.' }
  }

  const projectId = opts.projectId
  let jobId = opts.jobId?.trim() || ''
  if (!jobId) {
    const { data: projRow, error: projErr } = await supabase
      .from('projects')
      .select('job_id, title')
      .eq('id', projectId)
      .maybeSingle()
    if (projErr && isOfflineFetchError(projErr)) {
      return { ok: false, error: 'No internet connection. Connect to download.' }
    }
    jobId = String((projRow as { job_id?: string | null } | null)?.job_id ?? '').trim()
  }

  const [shotsRes, daysRes, membersRes, manualRes] = await Promise.all([
    supabase.from('production_shots').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
    supabase.from('production_days').select('*').eq('project_id', projectId).order('date', { ascending: true }),
    supabase
      .from('project_members')
      .select(
        'id, profile_id, member_role, scheduling_start_date, scheduling_end_date, booked_dates, contact_email, contact_phone, contact_label, works_as, profiles(name, avatar_url, headline, email)'
      )
      .eq('project_id', projectId)
      .order('member_role', { ascending: true }),
    supabase
      .from('project_manual_crew_readable')
      .select(
        'id, project_id, name, member_role, email, phone, booked_dates, scheduling_start_date, scheduling_end_date, day_rate_amount, half_day_rate_amount, claimed_profile_id'
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ])

  const firstErr = shotsRes.error || daysRes.error || membersRes.error
  if (firstErr && isOfflineFetchError(firstErr)) {
    return { ok: false, error: 'No internet connection. Connect to download.' }
  }
  if (shotsRes.error) return { ok: false, error: shotsRes.error.message }
  if (daysRes.error) return { ok: false, error: daysRes.error.message }
  if (membersRes.error) return { ok: false, error: membersRes.error.message }

  let manualData = manualRes.data as Array<Record<string, unknown>> | null
  if (manualRes.error) {
    const fallback = await supabase
      .from('project_manual_crew')
      .select(
        'id, project_id, name, member_role, email, phone, booked_dates, scheduling_start_date, scheduling_end_date, day_rate_amount, half_day_rate_amount, claimed_profile_id'
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
    if (fallback.error && isOfflineFetchError(fallback.error)) {
      return { ok: false, error: 'No internet connection. Connect to download.' }
    }
    manualData = (fallback.data as Array<Record<string, unknown>> | null) ?? []
  }

  const appliedRoleByProfile = new Map<string, string>()
  if (jobId) {
    const { data: appRows } = await supabase
      .from('job_applications')
      .select('freelancer_id, applied_role, status')
      .eq('job_id', jobId)
      .in('status', ['pending', 'accepted'])
    for (const row of appRows ?? []) {
      const fid = String((row as { freelancer_id?: string }).freelancer_id ?? '').trim()
      const ar = String((row as { applied_role?: string | null }).applied_role ?? '').trim()
      if (fid && ar) appliedRoleByProfile.set(fid, ar)
    }
  }

  const registered: OfflineCrewMember[] = ((membersRes.data as unknown as Array<Record<string, unknown>>) ?? []).map(
    (m) => {
      const prof = m.profiles as
        | { name: string | null; avatar_url: string | null; headline?: string | null; email?: string | null }
        | Array<{ name: string | null; avatar_url: string | null; headline?: string | null; email?: string | null }>
        | null
      const p = Array.isArray(prof) ? prof[0] : prof
      const profileId = String(m.profile_id ?? '')
      const memberRole = String(m.member_role ?? 'crew')
      const rl = roleLabel(memberRole)
      const worksAs = typeof m.works_as === 'string' && m.works_as.trim() ? m.works_as.trim() : ''
      const appliedForJob = appliedRoleByProfile.get(profileId) ?? ''
      const roleDisplay = crewDisplayRole(
        worksAs || appliedForJob,
        typeof p?.headline === 'string' && p.headline.trim().length > 0 ? p.headline.trim() : null,
        rl
      )
      const rawContactNote = typeof m.contact_label === 'string' && m.contact_label.trim() ? m.contact_label.trim() : ''
      const subtitle =
        rawContactNote.length > 0
          ? `${roleDisplay} · ${rawContactNote.length > 38 ? `${rawContactNote.slice(0, 38)}…` : rawContactNote}`
          : roleDisplay
      const bookingSlots = memberBookedSlotsFromRow({
        booked_dates: m.booked_dates,
        scheduling_start_date: typeof m.scheduling_start_date === 'string' ? m.scheduling_start_date : null,
        scheduling_end_date: typeof m.scheduling_end_date === 'string' ? m.scheduling_end_date : null,
      })
      const avatar = typeof p?.avatar_url === 'string' && /^https?:\/\//i.test(p.avatar_url.trim()) ? p.avatar_url.trim() : null
      return {
        source: 'registered' as const,
        id: String(m.id),
        profile_id: profileId,
        member_role: memberRole,
        name: p?.name || 'Member',
        subtitle,
        role_display: roleDisplay,
        email: typeof p?.email === 'string' && p.email.trim() ? p.email.trim() : null,
        phone: null,
        avatar_url: avatar,
        contact_email: typeof m.contact_email === 'string' ? m.contact_email : null,
        contact_phone: typeof m.contact_phone === 'string' ? m.contact_phone : null,
        contact_label: typeof m.contact_label === 'string' ? m.contact_label : null,
        scheduling_start_date:
          typeof m.scheduling_start_date === 'string' ? m.scheduling_start_date.slice(0, 10) : null,
        scheduling_end_date: typeof m.scheduling_end_date === 'string' ? m.scheduling_end_date.slice(0, 10) : null,
        bookingDates: calendarDatesFromSlots(bookingSlots),
        bookingSlots,
      }
    }
  )

  const manual: OfflineCrewMember[] = (manualData ?? [])
    .filter((m) => !(typeof m.claimed_profile_id === 'string' && String(m.claimed_profile_id).trim()))
    .map((m) => {
      const role = String(m.member_role ?? '').trim()
      const bookingSlots = memberBookedSlotsFromRow({
        booked_dates: m.booked_dates,
        scheduling_start_date: typeof m.scheduling_start_date === 'string' ? m.scheduling_start_date : null,
        scheduling_end_date: typeof m.scheduling_end_date === 'string' ? m.scheduling_end_date : null,
      })
      const dayRate = parseOptionalRate(m.day_rate_amount)
      const rateNote = dayRate != null ? ` · €${dayRate}/day` : ''
      const shootNote = formatBookedSlotsSummary(bookingSlots)
      return {
        source: 'manual' as const,
        id: String(m.id),
        member_role: String(m.member_role || 'crew'),
        role_display: role || 'Crew',
        name: String(m.name ?? 'Crew'),
        subtitle: `${role || 'Crew'}${rateNote}${shootNote ? ` · ${shootNote}` : ''}`,
        email: typeof m.email === 'string' && m.email.trim() ? m.email.trim() : null,
        phone: typeof m.phone === 'string' && m.phone.trim() ? m.phone.trim() : null,
        bookingDates: calendarDatesFromSlots(bookingSlots),
        bookingSlots,
        day_rate_amount: dayRate,
        half_day_rate_amount: parseOptionalRate(m.half_day_rate_amount),
        inviteStatus: 'none' as const,
        pendingInviteId: null,
      }
    })

  const crew = [...registered, ...manual]
  const shots = await overlayPendingStatuses(
    projectId,
    ((shotsRes.data ?? []) as Array<Record<string, unknown>>).map(normalizeShot)
  )
  const productionDays = ((daysRes.data ?? []) as Array<Record<string, unknown>>)
    .map(parseProductionDay)
    .filter((d): d is OfflineProductionDay => d != null)

  let milestones: WorkspaceMilestoneUi[] = []
  if (jobId) {
    const { rows, error } = await fetchWorkspaceMilestones(supabase, jobId)
    if (error && isOfflineFetchError({ message: error })) {
      return { ok: false, error: 'No internet connection. Connect to download.' }
    }
    milestones = rows
  }

  const [tasksRes, gearRes] = await Promise.all([
    fetchProductionTasks(projectId),
    fetchProductionEquipment(projectId),
  ])
  const tasks = tasksRes.error ? [] : tasksRes.rows
  const equipment = gearRes.error ? [] : gearRes.rows

  const fromWindow = (opts.shootDates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  const shootDates = [
    ...new Set([
      ...fromWindow,
      ...shots.map((s) => s.shoot_date).filter(Boolean),
      ...productionDays.map((d) => d.date).filter(Boolean),
    ]),
  ].sort()

  const pack: OfflinePack = {
    version: OFFLINE_PACK_VERSION,
    projectId,
    jobId: jobId || null,
    projectTitle: opts.projectTitle.trim() || 'Production',
    downloadedAt: new Date().toISOString(),
    shootDates,
    shots,
    productionDays,
    callSheetCrew: callSheetCrewFromMembers(crew),
    crew,
    milestones,
    tasks,
    equipment,
    callSheetPdfs: {},
  }

  pack.callSheetPdfs = await writeCallSheetPdfsForPack(pack, opts.projectLocation ?? null)

  try {
    const meta = await writePackFile(pack)
    notifyOfflinePack(projectId)
    return { ok: true, meta }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the offline pack.' }
  }
}

async function writeCallSheetPdfsForPack(
  pack: OfflinePack,
  locationFallback: string | null
): Promise<Record<string, string>> {
  const dir = packFilesDir(pack.projectId)
  if (!dir) return {}
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  const crew = pack.callSheetCrew
  const out: Record<string, string> = {}
  for (const date of pack.shootDates) {
    const day = pack.productionDays.find((d) => d.date === date)
    const html = buildCallSheetHtml({
      projectTitle: pack.projectTitle,
      shootDay: date,
      notes: day?.notes ?? null,
      wrapTime: day?.wrap_time ?? null,
      locationFallback,
      crew,
      callSheet: day?.call_sheet ?? {},
    })
    const fileName = `call-sheet-${date}.pdf`
    const dest = `${dir}${fileName}`
    const ok = await generateCallSheetPdfFile(html, dest)
    if (ok) out[date] = fileName
  }
  return out
}

export async function resolveOfflineRead(
  projectId: string
): Promise<{ pack: OfflinePack; reason: 'prefer' | 'offline' } | null> {
  if (shouldPreferOfflinePack(projectId)) {
    const pack = await readOfflinePack(projectId)
    return pack ? { pack, reason: 'prefer' } : null
  }
  const online = await isNetworkAvailable()
  if (online) return null
  const pack = await readOfflinePack(projectId)
  return pack ? { pack, reason: 'offline' } : null
}


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
import type { CrewSpendMemberRow, EquipmentSpendRow } from '@/lib/projectInternalBudget'

export type { OfflineShotStatus }

export const OFFLINE_PACK_VERSION = 3 as const
const SUPPORTED_PACK_VERSIONS = new Set([1, 2, 3])
/** Same ceiling as Files upload — skip oversized attachments rather than bloating the pack. */
const MAX_PACK_FILE_BYTES = 20 * 1024 * 1024
const MAX_PACK_FILES_TOTAL_BYTES = 250 * 1024 * 1024
const JOB_ATTACHMENTS_BUCKET = 'job-attachments'
const PROJECT_FILES_BUCKET = 'project-files'

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

export type OfflineBudgetLine = {
  id: string
  label: string
  planned_amount: number
  spent_amount: number
  sort_order: number
}

export type OfflineBudgetSnapshot = {
  currency: string
  total_budget: number | null
  production_budget: number | null
  lines: OfflineBudgetLine[]
  members: CrewSpendMemberRow[]
}

export type OfflinePackedFile = {
  key: string
  name: string
  source: 'job' | 'legacy'
  mimeType?: string | null
  /** Filename inside the pack files folder when the bytes were stored. */
  localFileName?: string | null
  skipped?: boolean
  skipReason?: string | null
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
  budget?: OfflineBudgetSnapshot | null
  files?: OfflinePackedFile[]
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
  fileCount?: number
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
  const packedFiles = (pack.files ?? []).filter((f) => f.localFileName && !f.skipped).length
  return {
    projectId: pack.projectId,
    projectTitle: pack.projectTitle,
    downloadedAt: pack.downloadedAt,
    shootDates: pack.shootDates,
    bytes,
    pdfDays: pack.callSheetPdfs ? Object.keys(pack.callSheetPdfs).length : 0,
    fileCount: packedFiles,
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
  const staging = packStagingDir(projectId)
  if (staging) {
    await FileSystem.deleteAsync(staging, { idempotent: true }).catch(() => {})
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

export async function getPackedAttachmentUri(projectId: string, localFileName: string): Promise<string | null> {
  const dir = packFilesDir(projectId)
  if (!dir || !localFileName) return null
  const path = `${dir}${localFileName}`
  const info = await FileSystem.getInfoAsync(path)
  return info.exists ? path : null
}

export function equipmentSpendFromPack(pack: OfflinePack): EquipmentSpendRow[] {
  return (pack.equipment ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    qty: e.qty,
    unit_price: e.unit_price,
    notes: e.notes,
  }))
}

export function mimeFromFileName(name: string, fallback?: string | null): string {
  const lower = name.toLowerCase()
  if (fallback && fallback.includes('/')) return fallback
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.heic')) return 'image/heic'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (lower.endsWith('.zip')) return 'application/zip'
  return 'application/octet-stream'
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

  const budget = await fetchBudgetSnapshotForPack(projectId)
  if (budget === 'offline') {
    return { ok: false, error: 'No internet connection. Connect to download.' }
  }

  const fromWindow = (opts.shootDates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  const shootDates = [
    ...new Set([
      ...fromWindow,
      ...shots.map((s) => s.shoot_date).filter(Boolean),
      ...productionDays.map((d) => d.date).filter(Boolean),
    ]),
  ].sort()

  const stagingDir = await prepareStagingDir(projectId)
  if (!stagingDir) {
    return { ok: false, error: 'This device cannot store an offline pack.' }
  }

  const files = await downloadAttachmentsForPack({
    projectId,
    jobId: jobId || null,
    dir: stagingDir,
  })
  if (files === 'offline') {
    await FileSystem.deleteAsync(stagingDir, { idempotent: true }).catch(() => {})
    return { ok: false, error: 'No internet connection. Connect to download.' }
  }

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
    budget,
    files,
    callSheetPdfs: {},
  }

  pack.callSheetPdfs = await writeCallSheetPdfsForPack(pack, opts.projectLocation ?? null, stagingDir)

  try {
    await commitStagingDir(projectId)
    const meta = await writePackFile(pack)
    notifyOfflinePack(projectId)
    return { ok: true, meta }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the offline pack.' }
  }
}

function packStagingDir(projectId: string): string | null {
  const dir = packsDir()
  if (!dir) return null
  return `${dir}${projectId}.downloading/`
}

async function prepareStagingDir(projectId: string): Promise<string | null> {
  const dir = packStagingDir(projectId)
  if (!dir) return null
  await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {})
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  return dir
}

async function commitStagingDir(projectId: string): Promise<void> {
  const staging = packStagingDir(projectId)
  const finalDir = packFilesDir(projectId)
  if (!staging || !finalDir) return
  await FileSystem.deleteAsync(finalDir, { idempotent: true }).catch(() => {})
  await FileSystem.moveAsync({ from: staging, to: finalDir })
}

function moneyOrNull(value: unknown): number | null {
  return parseOptionalRate(value)
}

function moneyOrZero(value: unknown): number {
  return parseOptionalRate(value) ?? 0
}

async function fetchBudgetSnapshotForPack(
  projectId: string
): Promise<OfflineBudgetSnapshot | null | 'offline'> {
  const [planRes, linesRes, membersRes, manualRes] = await Promise.all([
    supabase.from('project_budget_plans').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('project_budget_lines').select('*').eq('project_id', projectId).order('sort_order'),
    supabase
      .from('project_members')
      .select(
        'profile_id, member_role, booked_dates, scheduling_start_date, scheduling_end_date, profiles(name, day_rate_amount, half_day_rate_amount, rates_currency)'
      )
      .eq('project_id', projectId),
    supabase
      .from('project_manual_crew_readable')
      .select(
        'id, name, member_role, booked_dates, scheduling_start_date, scheduling_end_date, day_rate_amount, half_day_rate_amount, claimed_profile_id'
      )
      .eq('project_id', projectId)
      .is('claimed_profile_id', null),
  ])

  if (
    (planRes.error && isOfflineFetchError(planRes.error)) ||
    (linesRes.error && isOfflineFetchError(linesRes.error))
  ) {
    return 'offline'
  }
  // RLS: crew cannot read budget — pack still downloads, just without numbers.
  if (planRes.error || linesRes.error) return null

  const plan = planRes.data as {
    currency?: string | null
    total_budget?: unknown
    production_budget?: unknown
  } | null

  const registered = (membersRes.error ? [] : (membersRes.data ?? [])) as CrewSpendMemberRow[]
  const manualRows = (manualRes.error ? [] : (manualRes.data ?? [])) as Array<{
    id: string
    name: string | null
    member_role: string | null
    booked_dates?: unknown
    scheduling_start_date?: string | null
    scheduling_end_date?: string | null
    day_rate_amount?: number | null
    half_day_rate_amount?: number | null
  }>
  const manualAsSpend: CrewSpendMemberRow[] = manualRows.map((m) => ({
    profile_id: `manual:${m.id}`,
    member_role: (m.member_role ?? 'crew').trim() || 'crew',
    booked_dates: m.booked_dates,
    scheduling_start_date: m.scheduling_start_date,
    scheduling_end_date: m.scheduling_end_date,
    day_rate_amount: moneyOrNull(m.day_rate_amount),
    half_day_rate_amount: moneyOrNull(m.half_day_rate_amount),
    display_name: (m.name ?? '').trim() || 'Crew',
    profiles: null,
  }))

  const lines = ((linesRes.data ?? []) as Array<Record<string, unknown>>).map((r, i) => ({
    id: String(r.id ?? `line-${i}`),
    label: String(r.label ?? ''),
    planned_amount: moneyOrZero(r.planned_amount),
    spent_amount: moneyOrZero(r.spent_amount),
    sort_order: typeof r.sort_order === 'number' ? r.sort_order : i,
  }))

  return {
    currency: (plan?.currency ?? 'EUR').trim() || 'EUR',
    total_budget: moneyOrNull(plan?.total_budget),
    production_budget: moneyOrNull(plan?.production_budget),
    lines,
    members: [...registered, ...manualAsSpend],
  }
}

function packedAttachmentName(index: number, displayName: string): string {
  const safe = displayName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80)
  return `file-${String(index).padStart(3, '0')}-${safe || 'attachment'}`
}

async function downloadSignedFile(signedUrl: string, destPath: string): Promise<boolean> {
  try {
    const res = await FileSystem.downloadAsync(signedUrl, destPath)
    return res.status === 200
  } catch {
    return false
  }
}

async function signedDownloadToPack(bucket: string, storagePath: string, destPath: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 180)
  if (error || !data?.signedUrl) return false
  return downloadSignedFile(data.signedUrl, destPath)
}

async function downloadAttachmentsForPack(opts: {
  projectId: string
  jobId: string | null
  dir: string
}): Promise<OfflinePackedFile[] | 'offline'> {
  const listed: Array<{
    key: string
    name: string
    source: 'job' | 'legacy'
    bucket: string
    storagePath: string
    mimeType: string | null
    size: number | null
  }> = []

  if (opts.jobId) {
    const { data: rows, error } = await supabase
      .from('job_attachments')
      .select('id, file_name, storage_path, content_type, file_size, created_at')
      .eq('job_id', opts.jobId)
      .order('created_at', { ascending: false })
    if (error && isOfflineFetchError(error)) return 'offline'
    if (!error) {
      for (const r of rows ?? []) {
        const storagePath = String(r.storage_path ?? '').trim()
        if (!storagePath) continue
        listed.push({
          key: `job:${String(r.id)}`,
          name: String(r.file_name ?? 'file'),
          source: 'job',
          bucket: JOB_ATTACHMENTS_BUCKET,
          storagePath,
          mimeType: typeof r.content_type === 'string' ? r.content_type : null,
          size: typeof r.file_size === 'number' ? r.file_size : Number(r.file_size) || null,
        })
      }
    }
  }

  const { data: legacy, error: legacyErr } = await supabase.storage.from(PROJECT_FILES_BUCKET).list(opts.projectId, {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' },
  })
  if (legacyErr && isOfflineFetchError(legacyErr)) return 'offline'
  if (!legacyErr) {
    for (const f of legacy ?? []) {
      const name = (f.name ?? '').trim()
      if (!name) continue
      const meta = (f.metadata ?? null) as { size?: number; mimetype?: string } | null
      listed.push({
        key: `legacy:${name}`,
        name: name.replace(/^\d+_/, ''),
        source: 'legacy',
        bucket: PROJECT_FILES_BUCKET,
        storagePath: `${opts.projectId}/${name}`,
        mimeType: typeof meta?.mimetype === 'string' ? meta.mimetype : null,
        size: typeof meta?.size === 'number' ? meta.size : null,
      })
    }
  }

  const out: OfflinePackedFile[] = []
  let usedBytes = 0
  for (let i = 0; i < listed.length; i++) {
    const item = listed[i]!
    const size = item.size != null && Number.isFinite(item.size) ? item.size : null
    if (size != null && size > MAX_PACK_FILE_BYTES) {
      out.push({
        key: item.key,
        name: item.name,
        source: item.source,
        mimeType: item.mimeType,
        skipped: true,
        skipReason: 'File is larger than 20 MB',
      })
      continue
    }
    if (size != null && usedBytes + size > MAX_PACK_FILES_TOTAL_BYTES) {
      out.push({
        key: item.key,
        name: item.name,
        source: item.source,
        mimeType: item.mimeType,
        skipped: true,
        skipReason: 'Offline pack size limit',
      })
      continue
    }

    const localFileName = packedAttachmentName(i, item.name)
    const dest = `${opts.dir}${localFileName}`
    const ok = await signedDownloadToPack(item.bucket, item.storagePath, dest)
    if (!ok) {
      out.push({
        key: item.key,
        name: item.name,
        source: item.source,
        mimeType: item.mimeType,
        skipped: true,
        skipReason: 'Could not download',
      })
      continue
    }
    const stored = await fileBytes(dest)
    if (stored > MAX_PACK_FILE_BYTES || usedBytes + stored > MAX_PACK_FILES_TOTAL_BYTES) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {})
      out.push({
        key: item.key,
        name: item.name,
        source: item.source,
        mimeType: item.mimeType,
        skipped: true,
        skipReason: stored > MAX_PACK_FILE_BYTES ? 'File is larger than 20 MB' : 'Offline pack size limit',
      })
      continue
    }
    usedBytes += stored
    out.push({
      key: item.key,
      name: item.name,
      source: item.source,
      mimeType: item.mimeType,
      localFileName,
    })
  }
  return out
}

async function writeCallSheetPdfsForPack(
  pack: OfflinePack,
  locationFallback: string | null,
  destDir: string
): Promise<Record<string, string>> {
  await FileSystem.makeDirectoryAsync(destDir, { intermediates: true }).catch(() => {})
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
    const dest = `${destDir}${fileName}`
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


/** Structured call sheet stored in `production_days.call_sheet` JSON. */

export type CallSheetPersonKind = 'cast' | 'crew'

export type CallSheetPersonCell = {
  call_time?: string
  location?: string
  kind?: CallSheetPersonKind
  cast_no?: number
  character?: string
  status?: string
  report?: string
  hmu?: string
  wardrobe?: string
  ready?: string
  remarks?: string
}

export type CallSheetDayTimes = {
  general_call: string
  breakfast: string
  shoot_call: string
  lunch: string
  safety_note: string
  safety_meeting: string
}

export type CallSheetPlaces = {
  parking: string
  basecamp: string
  hmu: string
  wardrobe: string
  hospital: string
}

/** Shared by the project call sheet and the public generator. */
export type CallSheetAddress = {
  name: string
  address: string
  notes?: string
}

/** 24-hour clock, HH:MM. Empty string means no time. */
export type CallSheetClock = string

export type CallSheetLocation = CallSheetAddress & {
  id: string
}

export type CallSheetDepartments = {
  camera: string
  sound: string
  wardrobe: string
}

export type CallSheetContacts = {
  upm: string
  first_ad: string
  second_ad: string
  medic_name: string
  medic_phone: string
}

/** Short scene row for the call sheet. The PDF prints the full line; the editor stays one card. */
export type CallSheetSceneRow = {
  scene: string
  int_ext: string
  description: string
  cast: string
  location: string
  move: string
  time?: CallSheetClock
  location_id?: string
}

export type CallSheetBackgroundRow = {
  label: string
  count?: number
  in?: string
  ready?: string
}

export type CallSheetDocument = {
  v: 2
  people: Record<string, CallSheetPersonCell>
  day: CallSheetDayTimes
  places: CallSheetPlaces
  special: string
  departments: CallSheetDepartments
  background: CallSheetBackgroundRow[]
  contacts: CallSheetContacts
  scenes: CallSheetSceneRow[]
  locations: CallSheetLocation[]
}

export const CALL_SHEET_LOCATION_LIMIT = 30
export const CALL_SHEET_SCENE_LIMIT = 500
export const CALL_SHEET_LOCATION_NAME_LIMIT = 120
export const CALL_SHEET_LOCATION_ADDRESS_LIMIT = 300
export const CALL_SHEET_LOCATION_NOTES_LIMIT = 2000

export const CALL_SHEET_CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const CALL_SHEET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const EMPTY_CALL_SHEET_DAY: CallSheetDayTimes = {
  general_call: '',
  breakfast: '',
  shoot_call: '',
  lunch: '',
  safety_note: '',
  safety_meeting: '',
}

export const EMPTY_CALL_SHEET_PLACES: CallSheetPlaces = {
  parking: '',
  basecamp: '',
  hmu: '',
  wardrobe: '',
  hospital: '',
}

export const EMPTY_CALL_SHEET_DEPARTMENTS: CallSheetDepartments = {
  camera: '',
  sound: '',
  wardrobe: '',
}

export const EMPTY_CALL_SHEET_CONTACTS: CallSheetContacts = {
  upm: '',
  first_ad: '',
  second_ad: '',
  medic_name: '',
  medic_phone: '',
}

export const EMPTY_CALL_SHEET_SCENE: CallSheetSceneRow = {
  scene: '',
  int_ext: '',
  description: '',
  cast: '',
  location: '',
  move: '',
  time: '',
  location_id: '',
}

export const CALL_SHEET_PLACE_ORDER: Array<{ key: keyof CallSheetPlaces; label: string }> = [
  { key: 'parking', label: 'Crew parking' },
  { key: 'basecamp', label: 'Basecamp' },
  { key: 'hmu', label: 'HMU' },
  { key: 'wardrobe', label: 'Wardrobe' },
  { key: 'hospital', label: 'Hospital' },
]

export const DEFAULT_CALL_SHEET_SAFETY =
  'Be alert. Look out for yourself and others. Report unsafe conditions immediately.'

export function emptyCallSheet(): CallSheetDocument {
  return {
    v: 2,
    people: {},
    day: { ...EMPTY_CALL_SHEET_DAY },
    places: { ...EMPTY_CALL_SHEET_PLACES },
    special: '',
    departments: { ...EMPTY_CALL_SHEET_DEPARTMENTS },
    background: [],
    contacts: { ...EMPTY_CALL_SHEET_CONTACTS },
    scenes: [],
    locations: [],
  }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function clockOrEmpty(value: unknown): CallSheetClock {
  const text = str(value).trim()
  return CALL_SHEET_CLOCK_RE.test(text) ? text : ''
}

function parsePersonCell(raw: unknown): CallSheetPersonCell {
  const obj = asRecord(raw) ?? {}
  const cell: CallSheetPersonCell = {}
  const call = str(obj.call_time).trim()
  const loc = str(obj.location).trim()
  if (call) cell.call_time = call
  if (loc) cell.location = loc
  if (obj.kind === 'cast' || obj.kind === 'crew') cell.kind = obj.kind
  const castNo = typeof obj.cast_no === 'number' ? obj.cast_no : Number(obj.cast_no)
  if (Number.isFinite(castNo) && castNo > 0) cell.cast_no = Math.round(castNo)
  const character = str(obj.character).trim()
  if (character) cell.character = character
  const status = str(obj.status).trim()
  if (status) cell.status = status
  const report = str(obj.report).trim()
  if (report) cell.report = report
  const hmu = str(obj.hmu).trim()
  if (hmu) cell.hmu = hmu
  const wardrobe = str(obj.wardrobe).trim()
  if (wardrobe) cell.wardrobe = wardrobe
  const ready = str(obj.ready).trim()
  if (ready) cell.ready = ready
  const remarks = str(obj.remarks).trim()
  if (remarks) cell.remarks = remarks
  return cell
}

function parsePeople(raw: unknown): Record<string, CallSheetPersonCell> {
  const obj = asRecord(raw)
  if (!obj) return {}
  const out: Record<string, CallSheetPersonCell> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!key || key === 'v' || key === 'people' || key === 'day' || key === 'places') continue
    if (!asRecord(value)) continue
    const cell = parsePersonCell(value)
    if (Object.keys(cell).length > 0) out[key] = cell
    else out[key] = {}
  }
  return out
}

function parseDay(raw: unknown): CallSheetDayTimes {
  const obj = asRecord(raw) ?? {}
  return {
    general_call: str(obj.general_call).trim(),
    breakfast: str(obj.breakfast).trim(),
    shoot_call: str(obj.shoot_call).trim(),
    lunch: str(obj.lunch).trim(),
    safety_note: str(obj.safety_note).trim(),
    safety_meeting: str(obj.safety_meeting).trim(),
  }
}

function parsePlaces(raw: unknown): CallSheetPlaces {
  const obj = asRecord(raw) ?? {}
  return {
    parking: str(obj.parking).trim(),
    basecamp: str(obj.basecamp).trim(),
    hmu: str(obj.hmu).trim(),
    wardrobe: str(obj.wardrobe).trim(),
    hospital: str(obj.hospital).trim(),
  }
}

function parseDepartments(raw: unknown): CallSheetDepartments {
  const obj = asRecord(raw) ?? {}
  return {
    camera: str(obj.camera).trim(),
    sound: str(obj.sound).trim(),
    wardrobe: str(obj.wardrobe).trim(),
  }
}

function parseContacts(raw: unknown): CallSheetContacts {
  const obj = asRecord(raw) ?? {}
  return {
    upm: str(obj.upm).trim(),
    first_ad: str(obj.first_ad).trim(),
    second_ad: str(obj.second_ad).trim(),
    medic_name: str(obj.medic_name).trim(),
    medic_phone: str(obj.medic_phone).trim(),
  }
}

function parseScenes(raw: unknown): CallSheetSceneRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => {
      const obj = asRecord(row)
      if (!obj) return null
      const next: CallSheetSceneRow = {
        scene: str(obj.scene).trim(),
        int_ext: str(obj.int_ext).trim(),
        description: str(obj.description).trim(),
        cast: str(obj.cast).trim(),
        location: str(obj.location).trim(),
        move: str(obj.move).trim(),
        time: hasOwn(obj, 'time') ? clockOrEmpty(obj.time) : '',
        location_id:
          hasOwn(obj, 'location_id') && CALL_SHEET_UUID_RE.test(str(obj.location_id).trim())
            ? str(obj.location_id).trim()
            : '',
      }
      if (
        !next.scene &&
        !next.int_ext &&
        !next.description &&
        !next.cast &&
        !next.location &&
        !next.move &&
        !next.time &&
        !next.location_id
      ) {
        return null
      }
      return next
    })
    .filter((row): row is CallSheetSceneRow => row != null)
}

function parseLocations(raw: unknown): CallSheetLocation[] {
  if (!Array.isArray(raw)) return []
  const out: CallSheetLocation[] = []
  for (const item of raw) {
    const obj = asRecord(item)
    if (!obj) continue
    const id = str(obj.id).trim()
    if (!CALL_SHEET_UUID_RE.test(id)) continue
    const notes = str(obj.notes).trim().slice(0, CALL_SHEET_LOCATION_NOTES_LIMIT)
    const next: CallSheetLocation = {
      id,
      name: str(obj.name).trim().slice(0, CALL_SHEET_LOCATION_NAME_LIMIT),
      address: str(obj.address).trim().slice(0, CALL_SHEET_LOCATION_ADDRESS_LIMIT),
    }
    if (notes) next.notes = notes
    out.push(next)
    if (out.length >= CALL_SHEET_LOCATION_LIMIT) break
  }
  return out
}

function parseBackground(raw: unknown): CallSheetBackgroundRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => {
      const obj = asRecord(row)
      if (!obj) return null
      const label = str(obj.label).trim()
      if (!label) return null
      const countRaw = typeof obj.count === 'number' ? obj.count : Number(obj.count)
      const next: CallSheetBackgroundRow = { label }
      if (Number.isFinite(countRaw) && countRaw > 0) next.count = Math.round(countRaw)
      const inn = str(obj.in).trim()
      if (inn) next.in = inn
      const ready = str(obj.ready).trim()
      if (ready) next.ready = ready
      return next
    })
    .filter((row): row is CallSheetBackgroundRow => row != null)
}

function versionOf(obj: Record<string, unknown>): number | null {
  if (obj.v === 3 || obj.v === '3') return 3
  if (obj.v === 2 || obj.v === '2') return 2
  return null
}

function documentFrom(obj: Record<string, unknown>): CallSheetDocument {
  return {
    v: 2,
    people: parsePeople(obj.people),
    day: parseDay(obj.day),
    places: parsePlaces(obj.places),
    special: str(obj.special).trim(),
    departments: parseDepartments(obj.departments),
    background: parseBackground(obj.background),
    contacts: parseContacts(obj.contacts),
    scenes: parseScenes(obj.scenes),
    locations: hasOwn(obj, 'locations') ? parseLocations(obj.locations) : [],
  }
}

export function isCallSheetV2(raw: unknown): boolean {
  const obj = asRecord(raw)
  const version = obj ? versionOf(obj) : null
  return Boolean(obj && (version === 2 || version === 3) && asRecord(obj.people))
}

/**
 * Reads a stored call sheet and always returns version 2.
 * Locations, scene time, and location_id are kept when those keys are present.
 */
export function normalizeCallSheet(raw: unknown): CallSheetDocument {
  const empty = emptyCallSheet()
  const obj = asRecord(raw)
  if (!obj) return empty
  const version = versionOf(obj)
  if (version === 2 || version === 3 || hasOwn(obj, 'locations') || hasOwn(obj, 'scenes') || asRecord(obj.people)) {
    return documentFrom(obj)
  }
  return { ...empty, people: parsePeople(obj) }
}

export function parseCallSheet(raw: unknown): CallSheetDocument {
  return normalizeCallSheet(raw)
}

function serializeScene(row: CallSheetSceneRow): CallSheetSceneRow | null {
  const next: CallSheetSceneRow = {
    scene: row.scene.trim(),
    int_ext: row.int_ext.trim(),
    description: row.description.trim(),
    cast: row.cast.trim(),
    location: row.location.trim(),
    move: row.move.trim(),
    time: clockOrEmpty(row.time),
    location_id: CALL_SHEET_UUID_RE.test((row.location_id ?? '').trim()) ? (row.location_id ?? '').trim() : '',
  }
  if (
    !next.scene &&
    !next.int_ext &&
    !next.description &&
    !next.cast &&
    !next.location &&
    !next.move &&
    !next.time &&
    !next.location_id
  ) {
    return null
  }
  return next
}

export function serializeCallSheet(doc: CallSheetDocument): CallSheetDocument {
  const ids = new Set(doc.locations.map((loc) => loc.id))
  return {
    v: 2,
    people: { ...doc.people },
    day: { ...EMPTY_CALL_SHEET_DAY, ...doc.day },
    places: { ...EMPTY_CALL_SHEET_PLACES, ...doc.places },
    special: (doc.special ?? '').trim(),
    departments: { ...EMPTY_CALL_SHEET_DEPARTMENTS, ...doc.departments },
    background: Array.isArray(doc.background) ? doc.background : [],
    contacts: { ...EMPTY_CALL_SHEET_CONTACTS, ...doc.contacts },
    locations: doc.locations.slice(0, CALL_SHEET_LOCATION_LIMIT).map((loc) => {
      const notes = (loc.notes ?? '').trim().slice(0, CALL_SHEET_LOCATION_NOTES_LIMIT)
      const next: CallSheetLocation = {
        id: loc.id,
        name: loc.name.trim().slice(0, CALL_SHEET_LOCATION_NAME_LIMIT),
        address: loc.address.trim().slice(0, CALL_SHEET_LOCATION_ADDRESS_LIMIT),
      }
      if (notes) next.notes = notes
      return next
    }),
    scenes: (Array.isArray(doc.scenes) ? doc.scenes : [])
      .slice(0, CALL_SHEET_SCENE_LIMIT)
      .map((row) => {
        const next = serializeScene(row)
        if (!next) return null
        if (next.location_id && !ids.has(next.location_id)) next.location_id = ''
        return next
      })
      .filter((row): row is CallSheetSceneRow => row != null),
  }
}

/**
 * Old clients omit locations, scene time, and location_id.
 * Keep those values from the stored document when the incoming object has no such key.
 * A present key, including an empty list or an empty time, is kept.
 * Scene time is copied only when the scene label at the same index matches.
 * Keep this in sync with production_days_preserve_call_sheet_v3.
 */
export function retainMissingCallSheetFields(previous: unknown, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming
  const prev = asRecord(previous) ?? {}
  const next: Record<string, unknown> = { ...(incoming as Record<string, unknown>) }

  if (!hasOwn(next, 'locations') && hasOwn(prev, 'locations')) {
    next.locations = prev.locations
  }

  if (Array.isArray(next.scenes) && Array.isArray(prev.scenes)) {
    next.scenes = next.scenes.map((scene, index) => {
      if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return scene
      const row: Record<string, unknown> = { ...(scene as Record<string, unknown>) }
      const old = prev.scenes && Array.isArray(prev.scenes) ? asRecord(prev.scenes[index]) : null
      if (!old) return row
      if (str(row.scene) !== str(old.scene)) return row
      if (!hasOwn(row, 'time') && hasOwn(old, 'time')) row.time = old.time
      if (!hasOwn(row, 'location_id') && hasOwn(old, 'location_id')) row.location_id = old.location_id
      return row
    })
  }

  if (next.v === 3 || next.v === '3') next.v = 2
  return next
}

export function mergeCallSheetPeople(
  prevRaw: unknown,
  nextPeople: Record<string, CallSheetPersonCell>
): CallSheetDocument {
  const prev = normalizeCallSheet(prevRaw)
  const people = { ...prev.people }
  for (const [key, patch] of Object.entries(nextPeople)) {
    people[key] = { ...(people[key] ?? {}), ...patch }
  }
  return serializeCallSheet({ ...prev, people })
}

/** Cast list membership. An explicit crew flag wins over leftover cast fields. */
export function personIsCast(cell: CallSheetPersonCell | undefined): boolean {
  if (!cell) return false
  if (cell.kind === 'crew') return false
  if (cell.kind === 'cast') return true
  return Boolean(
    cell.cast_no ||
      cell.character?.trim() ||
      cell.status?.trim() ||
      cell.hmu?.trim() ||
      cell.wardrobe?.trim() ||
      cell.ready?.trim() ||
      cell.remarks?.trim()
  )
}

export function personCallTime(cell: CallSheetPersonCell | undefined, generalCall?: string): string {
  return (cell?.call_time ?? '').trim() || (generalCall ?? '').trim()
}

export function personLocation(
  cell: CallSheetPersonCell | undefined,
  fallbacks: Array<string | null | undefined>
): string {
  const own = (cell?.location ?? '').trim()
  if (own) return own
  for (const f of fallbacks) {
    const t = (f ?? '').trim()
    if (t) return t
  }
  return ''
}

export function formatCallSheetDate(ymd: string, locale = 'en-US'): string {
  const t = ymd.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return ymd
  const d = new Date(`${t}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function callSheetDayLabel(dayNumber: number | null, dayCount: number | null): string | null {
  if (!dayNumber || !dayCount || dayNumber < 1 || dayCount < 1) return null
  return `Day ${dayNumber} of ${dayCount}`
}

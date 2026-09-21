/** Structured call sheet stored in `production_days.call_sheet` JSON. */

export type CallSheetPersonKind = 'cast' | 'crew'

export type CallSheetPersonCell = {
  call_time?: string
  location?: string
  kind?: CallSheetPersonKind
  cast_no?: number
  status?: string
  report?: string
  hmu?: string
  wardrobe?: string
  ready?: string
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

export type CallSheetDepartments = {
  camera: string
  sound: string
  wardrobe: string
}

export type CallSheetContacts = {
  upm: string
  first_ad: string
  second_ad: string
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
}

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
  }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
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
  }
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

export function isCallSheetV2(raw: unknown): boolean {
  const obj = asRecord(raw)
  return Boolean(obj && obj.v === 2 && asRecord(obj.people))
}

export function parseCallSheet(raw: unknown): CallSheetDocument {
  const empty = emptyCallSheet()
  const obj = asRecord(raw)
  if (!obj) return empty
  if (isCallSheetV2(obj)) {
    return {
      v: 2,
      people: parsePeople(obj.people),
      day: parseDay(obj.day),
      places: parsePlaces(obj.places),
      special: str(obj.special).trim(),
      departments: parseDepartments(obj.departments),
      background: parseBackground(obj.background),
      contacts: parseContacts(obj.contacts),
    }
  }
  return { ...empty, people: parsePeople(obj) }
}

export function serializeCallSheet(doc: CallSheetDocument): CallSheetDocument {
  return {
    v: 2,
    people: { ...doc.people },
    day: { ...EMPTY_CALL_SHEET_DAY, ...doc.day },
    places: { ...EMPTY_CALL_SHEET_PLACES, ...doc.places },
    special: (doc.special ?? '').trim(),
    departments: { ...EMPTY_CALL_SHEET_DEPARTMENTS, ...doc.departments },
    background: Array.isArray(doc.background) ? doc.background : [],
    contacts: { ...EMPTY_CALL_SHEET_CONTACTS, ...doc.contacts },
  }
}

export function mergeCallSheetPeople(
  prevRaw: unknown,
  nextPeople: Record<string, CallSheetPersonCell>
): CallSheetDocument {
  const prev = parseCallSheet(prevRaw)
  const people = { ...prev.people }
  for (const [key, patch] of Object.entries(nextPeople)) {
    people[key] = { ...(people[key] ?? {}), ...patch }
  }
  return serializeCallSheet({ ...prev, people })
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

/**
 * Verfügbarkeit pro Kalendertag (ganzer Tag).
 *
 * v2: fehlender Tag = off (Freelancer markiert explizit „available“ / „booked“).
 * v3: defaultDay „available“ — fehlender Tag = available; Freelancer speichert explizit „off“ und „booked“.
 */

export type CellState = 'off' | 'available' | 'booked'

export const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type AvailabilityCalendarPayloadV2 = {
  version: 2
  days: Record<string, CellState>
  notes?: string
}

export type AvailabilityCalendarPayloadV3 = {
  version: 3
  defaultDay: 'available'
  days: Record<string, CellState>
  notes?: string
}

export type AvailabilityCalendarPayload = AvailabilityCalendarPayloadV2 | AvailabilityCalendarPayloadV3

const VALID: CellState[] = ['off', 'available', 'booked']

export function isCell(v: unknown): v is CellState {
  return typeof v === 'string' && (VALID as string[]).includes(v)
}

function mergeDayStates(a: CellState, b: CellState): CellState {
  if (a === 'booked' || b === 'booked') return 'booked'
  if (a === 'available' || b === 'available') return 'available'
  return 'off'
}

/** Lokales Datum → YYYY-MM-DD (kein UTC-Shift). */
export function toISODateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Mo = 0 … So = 6 */
export function mondayBasedColumnIndex(date = new Date()): number {
  const dow = date.getDay()
  return dow === 0 ? 6 : dow - 1
}

/** Legacy: eine Woche (7 Zellen) → konkrete ISO-Tage der Woche, die „heute“ enthält. */
function legacyWeekSlotsToDays(slots: CellState[]): Record<string, CellState> {
  const days: Record<string, CellState> = {}
  const today = new Date()
  const mondayOffset = mondayBasedColumnIndex(today)
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset, 12, 0, 0, 0)
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const st = slots[i] ?? 'off'
    if (st !== 'off') days[toISODateLocal(d)] = st
  }
  return days
}

function parseLegacySlotsArray(o: Record<string, unknown>, notes: string): AvailabilityCalendarPayloadV2 | null {
  const s = o.slots
  if (!Array.isArray(s) || s.length === 0) return null

  const first = s[0]
  if (isCell(first)) {
    const week: CellState[] = ['off', 'off', 'off', 'off', 'off', 'off', 'off']
    for (let c = 0; c < 7; c++) {
      const v = s[c]
      if (isCell(v)) week[c] = v
    }
    return { version: 2, days: legacyWeekSlotsToDays(week), notes }
  }

  if (Array.isArray(first)) {
    const row0 = s[0] as unknown[]
    const row1 = Array.isArray(s[1]) ? (s[1] as unknown[]) : []
    const week: CellState[] = []
    for (let c = 0; c < 7; c++) {
      const v0: CellState = isCell(row0[c]) ? (row0[c] as CellState) : 'off'
      const v1: CellState = isCell(row1[c]) ? (row1[c] as CellState) : 'off'
      week.push(mergeDayStates(v0, v1))
    }
    return { version: 2, days: legacyWeekSlotsToDays(week), notes }
  }

  return null
}

function parseDaysObjectV2(daysRaw: Record<string, unknown>): Record<string, CellState> {
  const days: Record<string, CellState> = {}
  for (const [k, v] of Object.entries(daysRaw)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && isCell(v)) {
      if (v !== 'off') days[k] = v
    }
  }
  return days
}

function parseDaysObjectV3(daysRaw: Record<string, unknown>): Record<string, CellState> {
  const days: Record<string, CellState> = {}
  for (const [k, v] of Object.entries(daysRaw)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && isCell(v)) {
      days[k] = v
    }
  }
  return days
}

export function parseAvailabilityCalendar(raw: unknown): AvailabilityCalendarPayload {
  const notesTrim = (s: string) => (s.trim() ? s.trim() : undefined)

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: 3, defaultDay: 'available', days: {}, notes: undefined }
  }

  const o = raw as Record<string, unknown>
  let notes = ''
  if (typeof o.notes === 'string') notes = o.notes

  const version = Number(o.version)
  const daysRaw = o.days

  if (!daysRaw || typeof daysRaw !== 'object' || Array.isArray(daysRaw)) {
    const legacy = parseLegacySlotsArray(o, notes)
    if (legacy) {
      return { ...legacy, notes: notesTrim(notes) }
    }
    if (version === 2) {
      return { version: 2, days: {}, notes: notesTrim(notes) }
    }
    if (version === 3 && o.defaultDay === 'available') {
      return { version: 3, defaultDay: 'available', days: {}, notes: notesTrim(notes) }
    }
    // e.g. `{}` or legacy JSON without version → classic „all off“
    return { version: 2, days: {}, notes: notesTrim(notes) }
  }

  if (version === 3 && o.defaultDay === 'available') {
    return {
      version: 3,
      defaultDay: 'available',
      days: parseDaysObjectV3(daysRaw as Record<string, unknown>),
      notes: notesTrim(notes),
    }
  }

  const days = parseDaysObjectV2(daysRaw as Record<string, unknown>)
  return { version: 2, days, notes: notesTrim(notes) }
}

export function nextCellState(s: CellState): CellState {
  if (s === 'off') return 'available'
  if (s === 'available') return 'booked'
  return 'off'
}

export type CalendarDefaultMode = 'off' | 'available'

/**
 * Speichern: `defaultMode` bestimmt v2 vs v3.
 * v3 speichert nur Abweichungen von „available“ (also „off“ und „booked“).
 */
export function toJsonPayload(
  days: Record<string, CellState>,
  notes: string,
  defaultMode: CalendarDefaultMode = 'off'
): AvailabilityCalendarPayload {
  const n = notes.trim() || undefined
  if (defaultMode === 'off') {
    const trimmed: Record<string, CellState> = {}
    for (const [k, v] of Object.entries(days)) {
      if (v !== 'off') trimmed[k] = v
    }
    return { version: 2, days: trimmed, notes: n }
  }
  const trimmed: Record<string, CellState> = {}
  for (const [k, v] of Object.entries(days)) {
    if (v !== 'available') trimmed[k] = v
  }
  return { version: 3, defaultDay: 'available', days: trimmed, notes: n }
}

/** Effektiver Zustand aus gespeichertem Payload (v2/v3). */
export function effectiveCellState(cal: AvailabilityCalendarPayload, iso: string): CellState {
  if (cal.version === 3) {
    const v = cal.days[iso]
    return v !== undefined ? v : 'available'
  }
  const v = cal.days[iso]
  return v !== undefined ? v : 'off'
}

/** Anzeige inkl. optionaler Job-/Buchungs-Tage (überschreibt mit „booked“). */
export function displayCellState(
  cal: AvailabilityCalendarPayload,
  iso: string,
  opts?: { jobBookedIso?: ReadonlySet<string> }
): CellState {
  if (opts?.jobBookedIso?.has(iso)) return 'booked'
  return effectiveCellState(cal, iso)
}

/** Editor: sparse `days` + Default-Modus → effektiver Zellzustand. */
export function effectiveDayStateMap(
  days: Record<string, CellState>,
  iso: string,
  defaultMode: CalendarDefaultMode
): CellState {
  if (Object.prototype.hasOwnProperty.call(days, iso)) {
    return days[iso]!
  }
  return defaultMode === 'available' ? 'available' : 'off'
}

/**
 * @deprecated Nutze `effectiveCellState` / `effectiveDayStateMap`.
 * Nur noch für Kompatibilität: reines days-Objekt, fehlend = off.
 */
export function getDayState(days: Record<string, CellState>, iso: string): CellState {
  return days[iso] ?? 'off'
}

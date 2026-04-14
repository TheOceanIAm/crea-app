/**
 * Verfügbarkeit pro Kalendertag (ganzer Tag).
 * Speicherung: `days["YYYY-MM-DD"]` = off | available | booked (fehlender Tag = off).
 */

export type CellState = 'off' | 'available' | 'booked'

export const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type AvailabilityCalendarPayload = {
  version: 2
  days: Record<string, CellState>
  notes?: string
}

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

function parseLegacySlotsArray(o: Record<string, unknown>, notes: string): AvailabilityCalendarPayload | null {
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

export function parseAvailabilityCalendar(raw: unknown): AvailabilityCalendarPayload {
  const empty: AvailabilityCalendarPayload = { version: 2, days: {}, notes: undefined }
  let notes = ''

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return empty
  }

  const o = raw as Record<string, unknown>
  if (typeof o.notes === 'string') notes = o.notes

  const daysRaw = o.days
  if (daysRaw && typeof daysRaw === 'object' && !Array.isArray(daysRaw)) {
    const days: Record<string, CellState> = {}
    for (const [k, v] of Object.entries(daysRaw as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && isCell(v)) {
        if (v !== 'off') days[k] = v
      }
    }
    return { version: 2, days, notes: notes.trim() || undefined }
  }

  const legacy = parseLegacySlotsArray(o, notes)
  if (legacy) {
    return { ...legacy, notes: notes.trim() || undefined }
  }

  return { version: 2, days: {}, notes: notes.trim() || undefined }
}

export function nextCellState(s: CellState): CellState {
  if (s === 'off') return 'available'
  if (s === 'available') return 'booked'
  return 'off'
}

/** Nur Einträge ≠ off speichern. */
export function toJsonPayload(days: Record<string, CellState>, notes: string): AvailabilityCalendarPayload {
  const trimmed: Record<string, CellState> = {}
  for (const [k, v] of Object.entries(days)) {
    if (v !== 'off') trimmed[k] = v
  }
  return {
    version: 2,
    days: trimmed,
    notes: notes.trim() || undefined,
  }
}

export function getDayState(days: Record<string, CellState>, iso: string): CellState {
  return days[iso] ?? 'off'
}

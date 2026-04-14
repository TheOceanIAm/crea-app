import { toISODateLocal } from '@/lib/availabilityCalendar'

/** monthIndex 0–11; Rückgabe: Leerfelder vor Tag 1 (Mo–So = 0–6), Anzahl Tage */
export function getMonthMeta(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1, 12, 0, 0, 0)
  const jsDow = first.getDay() // 0 So … 6 Sa
  const mondayStartPad = (jsDow + 6) % 7
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  return { mondayStartPad, daysInMonth, year, monthIndex }
}

export function monthStart(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex, 1, 12, 0, 0, 0)
}

export function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1, 12, 0, 0, 0)
}

export function formatMonthTitle(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function dateFromDayInMonth(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 12, 0, 0, 0)
}

export function isoForDayInMonth(year: number, monthIndex: number, day: number): string {
  return toISODateLocal(dateFromDayInMonth(year, monthIndex, day))
}

/** 7er-Zeilen: `null` = leeres Rasterfeld, sonst ISO-Datum. */
export function buildMonthSlotMatrix(year: number, monthIndex: number): (string | null)[][] {
  const meta = getMonthMeta(year, monthIndex)
  const flat: (string | null)[] = []
  for (let i = 0; i < meta.mondayStartPad; i++) flat.push(null)
  for (let d = 1; d <= meta.daysInMonth; d++) {
    flat.push(isoForDayInMonth(year, monthIndex, d))
  }
  while (flat.length % 7 !== 0) flat.push(null)
  const rows: (string | null)[][] = []
  for (let r = 0; r < flat.length / 7; r++) {
    rows.push(flat.slice(r * 7, r * 7 + 7))
  }
  return rows
}

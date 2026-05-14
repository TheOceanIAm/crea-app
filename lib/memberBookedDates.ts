/** Helpers for project_members.booked_dates + legacy scheduling range (mirror crea-services/lib/member-booked-dates.ts). */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type BookedDateEntry = { date: string; units: number }

function clampDayUnits(u: number): number {
  if (!Number.isFinite(u) || u <= 0) return 0
  return Math.min(u, 1)
}

/**
 * Parse `booked_dates` JSON array: legacy string entries (full day) or `{ date: YYYY-MM-DD, units?: number }`.
 * Duplicate dates merge with summed units, capped at 1 per calendar day.
 */
export function parseBookedDateEntries(raw: unknown): BookedDateEntry[] {
  if (!Array.isArray(raw)) return []
  const byDate = new Map<string, number>()
  for (const x of raw) {
    if (typeof x === 'string') {
      const d = x.trim().slice(0, 10)
      if (!ISO_DATE.test(d)) continue
      byDate.set(d, (byDate.get(d) ?? 0) + 1)
      continue
    }
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const o = x as Record<string, unknown>
      const d = typeof o.date === 'string' ? o.date.trim().slice(0, 10) : ''
      if (!ISO_DATE.test(d)) continue
      let u = typeof o.units === 'number' ? o.units : 1
      if (typeof o.units === 'string') u = parseFloat(o.units)
      if (!Number.isFinite(u)) u = 1
      byDate.set(d, (byDate.get(d) ?? 0) + clampDayUnits(u))
    }
  }
  const out: BookedDateEntry[] = []
  for (const [date, sum] of byDate) {
    const units = Math.min(sum, 1)
    if (units > 0) out.push({ date, units })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Compact JSON for DB: full days as strings, fractional as objects. */
export function serializeBookedDateEntries(entries: readonly BookedDateEntry[]): (string | { date: string; units: number })[] {
  const sorted = [...entries]
    .filter((e) => ISO_DATE.test(e.date) && e.units > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((e) => {
    const u = Math.min(Math.round(e.units * 1000) / 1000, 1)
    if (u >= 1) return e.date
    return { date: e.date, units: u }
  })
}

export function calendarDatesFromSlots(entries: readonly BookedDateEntry[]): string[] {
  return [...new Set(entries.map((e) => e.date))].filter((d) => ISO_DATE.test(d)).sort()
}

export function totalBookedDayUnits(entries: readonly BookedDateEntry[]): number {
  return Math.round(entries.reduce((s, e) => s + e.units, 0) * 100) / 100
}

/** Cycle: off → full day → half day → off (per calendar cell). */
export function cycleBookedDaySlot(entries: readonly BookedDateEntry[], iso: string): BookedDateEntry[] {
  const d = iso.trim().slice(0, 10)
  if (!ISO_DATE.test(d)) return [...entries]
  const cur = entries.find((e) => e.date === d)?.units ?? 0
  const rest = entries.filter((e) => e.date !== d)
  if (cur === 0) return [...rest, { date: d, units: 1 }].sort((a, b) => a.date.localeCompare(b.date))
  if (cur >= 1) return [...rest, { date: d, units: 0.5 }].sort((a, b) => a.date.localeCompare(b.date))
  return rest
}

export function clampBookedEntriesToWindow(
  entries: readonly BookedDateEntry[],
  winStart: string | null,
  winEnd: string | null,
): BookedDateEntry[] {
  const dates = calendarDatesFromSlots([...entries])
  const allowed = new Set(clampDatesToWindow(dates, winStart, winEnd))
  return entries.filter((e) => allowed.has(e.date))
}

/** Unique calendar dates from JSON (strings or objects); ignores fractional units. */
export function normalizeIsoDateKeys(raw: unknown): string[] {
  return calendarDatesFromSlots(parseBookedDateEntries(raw))
}

export function expandInclusiveRange(startYmd: string, endYmd: string): string[] {
  const a = startYmd.trim().slice(0, 10)
  const b = endYmd.trim().slice(0, 10)
  if (!ISO_DATE.test(a) || !ISO_DATE.test(b) || b < a) return []
  const keys: string[] = []
  const cur = new Date(`${a}T12:00:00`)
  const end = new Date(`${b}T12:00:00`)
  while (cur <= end) {
    const y = cur.getFullYear()
    const mo = cur.getMonth()
    const d = cur.getDate()
    keys.push(`${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    cur.setDate(cur.getDate() + 1)
  }
  return keys
}

export function memberBookedSlotsFromRow(row: {
  booked_dates?: unknown
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
}): BookedDateEntry[] {
  const fromJson = parseBookedDateEntries(row.booked_dates)
  if (fromJson.length > 0) return fromJson
  const s =
    typeof row.scheduling_start_date === 'string' ? row.scheduling_start_date.slice(0, 10) : ''
  const e =
    typeof row.scheduling_end_date === 'string' ? row.scheduling_end_date.slice(0, 10) : ''
  return expandInclusiveRange(s, e).map((date) => ({ date, units: 1 }))
}

/** Sorted unique calendar dates with any booking (for legacy UI / ranges). */
export function memberBookedDatesFromRow(row: {
  booked_dates?: unknown
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
}): string[] {
  return calendarDatesFromSlots(memberBookedSlotsFromRow(row))
}

export function clampDatesToWindow(
  dates: string[],
  winStart: string | null,
  winEnd: string | null,
): string[] {
  const ws = winStart?.trim().slice(0, 10) ?? ''
  const we = winEnd?.trim().slice(0, 10) ?? ''
  if (!ISO_DATE.test(ws) || !ISO_DATE.test(we) || we < ws) {
    return [...dates].sort()
  }
  return dates.filter((d) => ISO_DATE.test(d) && d >= ws && d <= we).sort()
}

export function formatBookedDaysSummary(dates: string[], locale = 'en-GB'): string | null {
  const sorted = [...new Set(dates)].filter((d) => ISO_DATE.test(d)).sort()
  if (sorted.length === 0) return null

  const groups: { start: string; end: string }[] = []
  for (const d of sorted) {
    const last = groups[groups.length - 1]
    if (!last) {
      groups.push({ start: d, end: d })
      continue
    }
    const prevEnd = new Date(`${last.end}T12:00:00`)
    const nextDay = new Date(prevEnd)
    nextDay.setDate(nextDay.getDate() + 1)
    const cur = new Date(`${d}T12:00:00`)
    if (cur.getTime() === nextDay.getTime()) last.end = d
    else groups.push({ start: d, end: d })
  }

  const fmt = (ymd: string) =>
    new Date(`${ymd}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  const parts = groups.map((g) =>
    g.start === g.end ? fmt(g.start) : `${fmt(g.start)}–${fmt(g.end)}`,
  )
  const dayWord = sorted.length === 1 ? 'day' : 'days'
  return `${sorted.length} booked ${dayWord}: ${parts.join(', ')}`
}

/** Summary including fractional crew-day totals (e.g. half-days). */
export function formatBookedSlotsSummary(entries: readonly BookedDateEntry[], locale = 'en-GB'): string | null {
  const slots = [...entries].filter((e) => ISO_DATE.test(e.date) && e.units > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (slots.length === 0) return null
  const totalUnits = totalBookedDayUnits(slots)
  const unitHead =
    totalUnits === 1 ? '1 crew day' : `${totalUnits % 1 === 0 ? totalUnits : totalUnits.toFixed(1)} crew days`
  const uniqueDates = calendarDatesFromSlots(slots)
  const tail = formatBookedDaysSummary(uniqueDates, locale)
  if (!tail) return unitHead
  const condensed = tail.replace(/^\d+ booked days?: /i, '')
  return `${unitHead}: ${condensed}`
}

export function syncSchedulingRangeFromDates(sortedDates: string[]): {
  start: string | null
  end: string | null
} {
  if (sortedDates.length === 0) return { start: null, end: null }
  return { start: sortedDates[0]!, end: sortedDates[sortedDates.length - 1]! }
}

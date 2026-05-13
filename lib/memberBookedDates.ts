/** Helpers for project_members.booked_dates + legacy scheduling range (mirror crea-services/lib/member-booked-dates.ts). */

export function normalizeIsoDateKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    const s = typeof x === 'string' ? x.trim().slice(0, 10) : ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.push(s)
  }
  return [...new Set(out)].sort()
}

export function expandInclusiveRange(startYmd: string, endYmd: string): string[] {
  const a = startYmd.trim().slice(0, 10)
  const b = endYmd.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b < a) return []
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

export function memberBookedDatesFromRow(row: {
  booked_dates?: unknown
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
}): string[] {
  const fromJson = normalizeIsoDateKeys(row.booked_dates)
  if (fromJson.length > 0) return fromJson
  const s =
    typeof row.scheduling_start_date === 'string' ? row.scheduling_start_date.slice(0, 10) : ''
  const e =
    typeof row.scheduling_end_date === 'string' ? row.scheduling_end_date.slice(0, 10) : ''
  return expandInclusiveRange(s, e)
}

export function clampDatesToWindow(
  dates: string[],
  winStart: string | null,
  winEnd: string | null,
): string[] {
  const ws = winStart?.trim().slice(0, 10) ?? ''
  const we = winEnd?.trim().slice(0, 10) ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ws) || !/^\d{4}-\d{2}-\d{2}$/.test(we) || we < ws) {
    return [...dates].sort()
  }
  return dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= ws && d <= we).sort()
}

export function formatBookedDaysSummary(dates: string[], locale = 'en-GB'): string | null {
  const sorted = [...new Set(dates)]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
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

export function syncSchedulingRangeFromDates(sortedDates: string[]): {
  start: string | null
  end: string | null
} {
  if (sortedDates.length === 0) return { start: null, end: null }
  return { start: sortedDates[0]!, end: sortedDates[sortedDates.length - 1]! }
}

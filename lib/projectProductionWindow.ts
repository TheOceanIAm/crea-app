/** Inclusive calendar days from YYYY-MM-DD to YYYY-MM-DD (local calendar; DST-safe). */
export function inclusiveProductionDays(startYmd: string, endYmd: string): number {
  const a = startYmd.trim().slice(0, 10)
  const b = endYmd.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0
  const da = new Date(`${a}T12:00:00`)
  const db = new Date(`${b}T12:00:00`)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0
  const [from, to] = da <= db ? [da, db] : [db, da]
  let n = 0
  const cur = new Date(from)
  while (cur <= to) {
    n += 1
    cur.setDate(cur.getDate() + 1)
  }
  return n
}

export function parseLocalYmd(s: string): Date | null {
  const t = s.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const [y, mo, d] = t.split('-').map(Number)
  return new Date(y, mo - 1, d)
}

/** Every calendar day in the production window (inclusive), as YYYY-MM-DD. */
export function listProductionWindowYmd(
  startYmd: string | null | undefined,
  endYmd: string | null | undefined
): string[] {
  const a = typeof startYmd === 'string' ? startYmd.trim().slice(0, 10) : ''
  const b = typeof endYmd === 'string' ? endYmd.trim().slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return []
  const da = new Date(`${a}T12:00:00`)
  const db = new Date(`${b}T12:00:00`)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return []
  const [from, to] = da <= db ? [da, db] : [db, da]
  const out: string[] = []
  const cur = new Date(from)
  while (cur <= to) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${d}`)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function formatShootDayOptionLabel(ymd: string, locale = 'en-GB'): string {
  const d = parseLocalYmd(ymd)
  if (!d) return ymd
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Human-readable summary when both dates set; short hints when partial or invalid.
 */
export function formatProductionWindowSummary(
  startYmd: string | null | undefined,
  endYmd: string | null | undefined,
  locale = 'en-GB'
): string | null {
  const a = typeof startYmd === 'string' && startYmd.trim() ? startYmd.trim().slice(0, 10) : ''
  const b = typeof endYmd === 'string' && endYmd.trim() ? endYmd.trim().slice(0, 10) : ''
  if (!a && !b) return null
  if (!a || !b) return 'Set both dates to lock the production window.'
  const da = parseLocalYmd(a)
  const db = parseLocalYmd(b)
  if (!da || !db) return null
  if (db < da) return 'End must be on or after start.'
  const days = inclusiveProductionDays(a, b)
  const fmt = (d: Date) =>
    d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${fmt(da)} → ${fmt(db)} · ${days} production ${days === 1 ? 'day' : 'days'}`
}

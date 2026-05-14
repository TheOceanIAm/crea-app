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

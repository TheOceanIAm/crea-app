/** Inclusive calendar days from YYYY-MM-DD to YYYY-MM-DD (local date arithmetic). */
export function inclusiveProductionDays(startYmd: string, endYmd: string): number {
  const a = parseLocalYmd(startYmd)
  const b = parseLocalYmd(endYmd)
  if (!a || !b || b < a) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
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

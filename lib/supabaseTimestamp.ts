/**
 * Parse timestamps from Supabase / PostgREST.
 *
 * Postgres `timestamptz` is stored in UTC; JSON often arrives as ISO **without** `Z` or offset.
 * ECMAScript parses timezone-less ISO datetimes as **local** wall time, which shifts the instant
 * by the user's UTC offset (~1–2h in EU) and breaks “time ago” and sorting.
 *
 * If there is no explicit zone suffix, we treat the value as **UTC** (append `Z`).
 */
export function parseSupabaseTimestamp(raw: string | null | undefined): Date {
  if (raw == null || typeof raw !== 'string') return new Date(NaN)
  let s = raw.trim()
  if (!s) return new Date(NaN)

  if (/[zZ]$/.test(s)) return new Date(s)

  if (/[+-]\d{2}(:\d{2})?(:\d{2})?$/.test(s)) return new Date(s)

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const norm = s.includes('T') ? s : s.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    return new Date(`${norm}Z`)
  }

  return new Date(s)
}

export function supabaseTimestampMs(raw: string | null | undefined): number {
  const ms = parseSupabaseTimestamp(raw).getTime()
  return Number.isFinite(ms) ? ms : 0
}

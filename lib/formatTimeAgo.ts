import { parseSupabaseTimestamp, supabaseTimestampMs } from '@/lib/supabaseTimestamp'

/**
 * Compact relative time for feeds (Alerts, etc.).
 * Pass `nowMs` from a ticking clock so labels stay live while the screen is open.
 */
export function formatTimeAgo(dateStr: string, nowMs: number = Date.now()): string {
  const then = supabaseTimestampMs(dateStr)
  if (!then) return 'now'
  const diff = nowMs - then
  if (diff < 0) return 'now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return parseSupabaseTimestamp(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

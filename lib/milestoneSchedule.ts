/** Format milestone scheduled_at for display (device locale). */
export function formatMilestoneSchedule(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isoFromDateAndTime(date: Date, time: Date): string {
  const merged = new Date(date)
  merged.setHours(time.getHours(), time.getMinutes(), 0, 0)
  return merged.toISOString()
}

export function splitIsoToDateAndTime(iso: string | null | undefined): { date: Date; time: Date } | null {
  if (!iso?.trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = new Date(d)
  time.setFullYear(1970, 0, 1)
  return { date: d, time }
}

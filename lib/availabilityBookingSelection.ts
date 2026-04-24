import { displayCellState, type AvailabilityCalendarPayload } from '@/lib/availabilityCalendar'

export function isIsoBookable(
  cal: AvailabilityCalendarPayload,
  iso: string,
  jobBookedIso?: ReadonlySet<string>
): boolean {
  return displayCellState(cal, iso, jobBookedIso ? { jobBookedIso } : undefined) === 'available'
}

/** Sort YYYY-MM-DD ascending. */
export function sortIsoDates(isos: Iterable<string>): string[] {
  return Array.from(new Set(isos)).sort()
}

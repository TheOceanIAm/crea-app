/** `projects.location` stores the job's `location_type` (remote / on_site / hybrid). */

export type WorkLocationKind = 'remote' | 'on_site' | 'hybrid' | 'unknown'

export function parseWorkLocation(raw: string | null | undefined): WorkLocationKind {
  const s = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  if (s === 'remote') return 'remote'
  if (s === 'on_site' || s === 'onsite') return 'on_site'
  if (s === 'hybrid') return 'hybrid'
  return 'unknown'
}

export function workLocationTitle(kind: WorkLocationKind): string {
  if (kind === 'remote') return 'Remote'
  if (kind === 'on_site') return 'On-site'
  if (kind === 'hybrid') return 'Hybrid'
  return 'Not set'
}

export function isOnLocationWork(kind: WorkLocationKind): boolean {
  return kind === 'on_site' || kind === 'hybrid'
}

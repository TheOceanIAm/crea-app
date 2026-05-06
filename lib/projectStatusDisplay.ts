/** Normalized project workspace status for UI (pills, labels). */

export type ProjectStatusVariant =
  | 'recruiting'
  | 'active'
  | 'in_progress'
  | 'completed'
  | 'other'

export function projectStatusVariant(status: string | null | undefined): ProjectStatusVariant {
  const s = (status ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
  if (s === 'recruiting') return 'recruiting'
  if (s === 'active') return 'active'
  if (s === 'in_progress') return 'in_progress'
  if (s === 'completed' || s === 'complete' || s === 'done') return 'completed'
  return 'other'
}

/** Title-style label for any stored status string. */
export function projectStatusDisplayLabel(status: string | null | undefined): string {
  const v = projectStatusVariant(status)
  if (v === 'recruiting') return 'Recruiting'
  if (v === 'active') return 'Active'
  if (v === 'in_progress') return 'In Progress'
  if (v === 'completed') return 'Completed'
  const raw = (status ?? '').trim()
  if (!raw) return '—'
  return raw
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export const PROJECT_STATUS_PILL: Record<
  ProjectStatusVariant,
  { backgroundColor: string; color: string; borderColor: string }
> = {
  recruiting: {
    backgroundColor: 'rgba(255, 220, 0, 0.18)',
    color: '#FFDC00',
    borderColor: 'rgba(255, 220, 0, 0.38)',
  },
  active: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    color: '#4ade80',
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  in_progress: {
    backgroundColor: 'rgba(255, 220, 0, 0.22)',
    color: '#FFDC00',
    borderColor: 'rgba(255, 220, 0, 0.4)',
  },
  completed: {
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
    color: '#93c5fd',
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  other: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: 'rgba(255, 255, 255, 0.72)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
}

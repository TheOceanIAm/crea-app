import type { FreelancerPublicProfilePayload } from '@/lib/freelancerPublicProfileTypes'
import { parsePortfolioProjects } from '@/lib/profileSettingsExtras'

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

function coerceArrayUnknown(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const p = safeJsonParse(raw)
    if (Array.isArray(p)) return p
  }
  return raw
}

/** Postgres text[] can appear as "{tag1,tag2}" over the wire in edge cases. */
function parsePostgresTextArrayLiteral(s: string): string[] | null {
  const t = s.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  const inner = t.slice(1, -1).trim()
  if (inner === '') return []
  const parts = inner.split(',')
  return parts
    .map((p) => p.replace(/^"(.*)"$/, '$1').trim())
    .filter((x) => x.length > 0)
}

function coerceStringArray(raw: unknown): string[] {
  if (raw == null) return []
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return []
    const parsed = safeJsonParse(t)
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter((s) => s.length > 0)
    }
    const pgArr = parsePostgresTextArrayLiteral(t)
    if (pgArr) return pgArr
    return t
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  /** Some JSON drivers decode Postgres text[] as { "0": "a", "1": "b" } */
  if (typeof raw === 'object' && !Array.isArray(raw) && raw !== null) {
    const vals = Object.values(raw as Record<string, unknown>).filter(
      (v) => v != null && (typeof v === 'string' || typeof v === 'number')
    )
    if (vals.length > 0) {
      return vals.map((x) => String(x).trim()).filter((s) => s.length > 0)
    }
  }
  const v = coerceArrayUnknown(raw)
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter((s) => s.length > 0)
}

/**
 * Supabase `profile_share_public` returns JSON; some columns may arrive as stringified JSON.
 * Also tolerates camelCase duplicates if ever present.
 */
export function normalizePublicProfileRpc(raw: FreelancerPublicProfilePayload): FreelancerPublicProfilePayload {
  const o = raw as Record<string, unknown>

  const portfolioRaw =
    o.portfolio_projects ??
    o.portfolioProjects ??
    o.portfolio_items ??
    o.portfolioItems ??
    o.videos ??
    (Array.isArray(o.work) ? o.work : undefined)
  const portfolio_projects = parsePortfolioProjects(portfolioRaw)

  const skills = coerceStringArray(o.skills)
  const equipment = coerceStringArray(o.equipment)

  let availability_calendar = o.availability_calendar ?? o.availabilityCalendar
  if (typeof availability_calendar === 'string') {
    const p = safeJsonParse(availability_calendar)
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      availability_calendar = p as FreelancerPublicProfilePayload['availability_calendar']
    }
  }

  return {
    ...raw,
    portfolio_projects,
    skills,
    equipment,
    availability_calendar: availability_calendar as FreelancerPublicProfilePayload['availability_calendar'],
  }
}

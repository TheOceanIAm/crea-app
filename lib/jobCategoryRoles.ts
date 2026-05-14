/** Multi-role job postings store `jobs.category` as comma-separated labels (e.g. "Direction, DoP"). */

export function parseJobCategoryRoles(raw: string | null | undefined): string[] {
  const s = String(raw ?? '').trim()
  if (!s) return []
  return [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))]
}

export function formatJobCategoryRoles(roles: readonly string[]): string {
  return [...new Set(roles.map((r) => String(r).trim()).filter(Boolean))].join(', ')
}

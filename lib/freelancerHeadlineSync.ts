/** Account-type words — not a professional job title (avoid showing twice with "Freelancer" pill). */
const GENERIC_PROFESSIONAL_LABELS = new Set(['freelancer', 'company', 'ceo', 'creative'])

export function isGenericProfessionalLabel(value: string | null | undefined): boolean {
  return GENERIC_PROFESSIONAL_LABELS.has(String(value ?? '').trim().toLowerCase())
}

/**
 * Single headline for app + web: `profiles.headline` and `freelancer_profiles.job_title` must match.
 * When they diverge, prefer the specific title over generic labels like "Freelancer" / "Creative".
 */
export function resolveCanonicalFreelancerHeadline(
  profilesHeadline: string | null | undefined,
  jobTitle: string | null | undefined
): string {
  const h = String(profilesHeadline ?? '').trim()
  const j = String(jobTitle ?? '').trim()
  if (!h && !j) return ''
  if (h && j && h.toLowerCase() === j.toLowerCase()) return h
  if (h && isGenericProfessionalLabel(h) && j && !isGenericProfessionalLabel(j)) return j
  if (j && isGenericProfessionalLabel(j) && h && !isGenericProfessionalLabel(h)) return h
  return j || h
}

/** Subtitle under name on dashboards / public profile (never the hard-coded "Creative"). */
export function professionalRoleSubtitle(
  headlineOrJobTitle: string | null | undefined,
  skills: readonly string[],
  accountKind: 'freelancer' | 'company' = 'freelancer'
): string {
  const title = String(headlineOrJobTitle ?? '').trim()
  if (title && !isGenericProfessionalLabel(title)) return title
  const fromSkills = skills
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ')
  if (fromSkills) return fromSkills
  return accountKind === 'company' ? 'Company' : 'Freelancer'
}

export function alignHeadlineFieldsOnRow(row: Record<string, unknown>): void {
  const canonical = resolveCanonicalFreelancerHeadline(
    typeof row.headline === 'string' ? row.headline : null,
    typeof row.job_title === 'string' ? row.job_title : null
  )
  if (!canonical) return
  row.headline = canonical
  row.job_title = canonical
}

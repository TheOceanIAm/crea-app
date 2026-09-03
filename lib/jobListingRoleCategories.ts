/**
 * Individual disciplines for job listings — same labels as crea-services
 * `lib/job-listing-role-categories.ts` / PostJobModal.
 * Stored on `jobs.category` as comma-separated values via `formatJobCategoryRoles`.
 */
export const JOB_LISTING_ROLE_CATEGORIES = [
  'Motion Design',
  'Direction',
  'DoP',
  'Videography',
  'Photography',
  'Editing',
  'Sound Design',
  'Art Direction',
  'Production',
  'Gaffer',
  'Grip',
  'Stylist',
  'Make-Up Artist',
  'Graphic Design',
  'Illustration',
  'Copywriting',
  'Social Media',
  'Animation',
  'Color Grading',
  'Web Design',
  'Web Development',
] as const

export type JobListingRoleCategory = (typeof JOB_LISTING_ROLE_CATEGORIES)[number]

/** Shown first on mobile post-job — labels match `JOB_LISTING_ROLE_CATEGORIES`. */
export const FEATURED_JOB_LISTING_ROLES: readonly JobListingRoleCategory[] = [
  'Direction',
  'Videography',
  'Photography',
  'Web Design',
  'Web Development',
]

export function filterJobListingRoleCategories(
  query: string,
  choices: readonly string[] = JOB_LISTING_ROLE_CATEGORIES
): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...choices]
  return choices.filter((c) => c.toLowerCase().includes(q))
}

/**
 * Customer job rows the freelancer may still see on Projects (not Finance invoicing).
 * Keep rows the client marked complete so files and the workspace stay reachable under Completed.
 * Hide only listings the company closed or cancelled without completing the project.
 */
export function freelancerCustomerJobVisibleToFreelancer(
  job:
    | {
        status?: string | null
        project_status?: string | null
        is_solo_workspace?: boolean | null
        company_id?: string
      }
    | null
    | undefined,
  viewerUserId: string
): boolean {
  if (!job) return false
  const isOwnSolo = Boolean(job.is_solo_workspace) && job.company_id === viewerUserId
  if (isOwnSolo) return true
  if (String(job.project_status ?? '').trim().toLowerCase() === 'completed') return true
  return String(job.status ?? '').toLowerCase() !== 'closed'
}

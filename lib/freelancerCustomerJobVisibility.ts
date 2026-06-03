/** Customer job rows the freelancer may still see on Projects / Dashboard (not Finance invoicing). */
export function freelancerCustomerJobVisibleToFreelancer(
  job:
    | {
        status?: string | null
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
  return String(job.status ?? '').toLowerCase() !== 'closed'
}

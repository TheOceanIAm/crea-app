import { supabase } from '@/lib/supabase'
import { parseBookingDeepLinkTargetIds } from '@/lib/parseCreaDeepLinkHref'

const BOOKING_UUID =
  /(?:project|jobs)[/]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function extractIdsFromOpenDeepLink(raw: string): { jobId?: string; projectId?: string } {
  const parsed = parseBookingDeepLinkTargetIds(raw)
  if (parsed.jobId || parsed.projectId) return parsed
  const m = raw.match(BOOKING_UUID)
  if (!m?.[1]) return {}
  if (/project/i.test(m[0])) return { projectId: m[1] }
  return { jobId: m[1] }
}

export async function resolveBookingJobIdByTitle(opts: {
  projectTitle: string
  companyUserId: string
}): Promise<string | null> {
  const want = normalizeTitle(opts.projectTitle)
  const companyId = opts.companyUserId.trim()
  if (!want || !companyId) return null

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(120)

  const rows = jobs ?? []
  const exact = rows.find((j) => normalizeTitle(String(j.title ?? '')) === want)
  if (exact?.id) return String(exact.id)

  const contains = rows.find((j) => {
    const t = normalizeTitle(String(j.title ?? ''))
    return t.includes(want) || want.includes(t)
  })
  return contains?.id ? String(contains.id) : null
}

export async function resolveBookingWorkspaceJobId(opts: {
  openDeepLink: string
  projectTitle: string
  userId: string
  bookingSenderId: string
  mine: boolean
}): Promise<string | null> {
  const fromLink = extractIdsFromOpenDeepLink(opts.openDeepLink)
  if (fromLink.jobId) return fromLink.jobId
  if (fromLink.projectId) return fromLink.projectId

  const companyId = opts.mine ? opts.userId : opts.bookingSenderId
  return resolveBookingJobIdByTitle({
    projectTitle: opts.projectTitle,
    companyUserId: companyId,
  })
}

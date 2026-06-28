import { getCache, setCache } from '@/lib/appCache'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { supabase } from '@/lib/supabase'
import { supabaseTimestampMs } from '@/lib/supabaseTimestamp'
import {
  canFreelancerCreatePrivateProjects,
  type FreelancerPlan,
} from '@/lib/freelancerPlan'

export type PinboardPostRow = {
  id: string
  body: string
  created_at: string
  job_id: string | null
  project_id: string | null
  author_id: string
  jobs: { id: string; title: string; company_id: string; is_solo_workspace?: boolean | null } | null
  projects: { id: string; title: string; company_id: string; freelancer_id: string | null } | null
}

export type PinboardPost = {
  id: string
  body: string
  created_at: string
  job_id: string | null
  project_id: string | null
  job_title: string | null
  job_company_id: string | null
  job_is_solo_workspace: boolean
  project_title: string | null
  project_company_id: string | null
  author_id: string
  author_name: string
  author_avatar_url: string | null
}

export type PinboardAttachOption = {
  key: string
  id: string
  title: string
  kind: 'job' | 'project'
}

export const PINBOARD_NO_ATTACH = ''

/** Product copy + validation — job/project-linked updates only (not open social posts). */
export const PINBOARD_UPDATES_COPY = {
  sectionSubtitle:
    'Share a listing or crew search with a link to a job or workspace project.',
  composerPlaceholder: 'Share a listing or crew search…',
  composerModalTitle: 'Post an update',
  messagePlaceholder:
    'e.g. Looking for a DP for this shoot — see the linked listing for dates and budget.',
  attachLabel: 'Link to job or project (required)',
  attachSelectPlaceholder: 'Choose a listing or project…',
  attachRequiredError: 'Link a job listing or workspace project.',
  bodyRequiredError: 'Add a short note for your update.',
  emptyFeed:
    'No updates yet. Share a listing or crew search and link it to a job or project.',
  noLinkOptionsTitle: 'Create something to link first',
  noLinkOptionsBody:
    'Post a job listing or create a workspace project, then share it here.',
  createListingLabel: 'Post a job listing',
  createProjectLabel: 'New workspace project',
  starterBlocked:
    'Sharing updates requires Pro, or a company account.',
  recentLabel: 'Recent updates',
  postButton: 'Post update',
  legacyUnlinked: 'Legacy update (no link)',
  linkKindJob: 'Job listing',
  linkKindProject: 'Workspace project',
} as const

export function formatPinboardAttachOptionLabel(
  kind: 'job' | 'project',
  title: string
): string {
  const prefix =
    kind === 'job' ? PINBOARD_UPDATES_COPY.linkKindJob : PINBOARD_UPDATES_COPY.linkKindProject
  return `${prefix}: ${title}`
}

export function validatePinboardUpdateInput(opts: {
  body: string
  jobId: string | null
  projectId: string | null
}): { ok: true } | { ok: false; error: string } {
  const trimmed = opts.body.trim()
  if (!opts.jobId && !opts.projectId) {
    return { ok: false, error: PINBOARD_UPDATES_COPY.attachRequiredError }
  }
  if (opts.jobId && opts.projectId) {
    return { ok: false, error: 'Link either a job or a project, not both.' }
  }
  if (trimmed.length < 1) {
    return { ok: false, error: PINBOARD_UPDATES_COPY.bodyRequiredError }
  }
  return { ok: true }
}

export function canComposePinboardUpdates(opts: {
  role: string | null | undefined
  freelancerPlan: string
}): boolean {
  if (opts.role === 'company' || opts.role === 'ceo') return true
  if (opts.role === 'freelancer') {
    return canFreelancerCreatePrivateProjects(opts.freelancerPlan as FreelancerPlan)
  }
  return false
}

export function parsePinboardAttachKey(
  key: string
): { kind: 'job' | 'project'; id: string } | null {
  if (!key || key === PINBOARD_NO_ATTACH) return null
  const [kind, id] = key.split(':')
  if ((kind === 'job' || kind === 'project') && id) return { kind, id }
  return null
}

export type PinboardFeedCache = {
  posts: PinboardPost[]
}

export function pinboardCacheKey(userId: string) {
  return `pinboard:${userId}`
}

const DISK_PINBOARD_TTL_MS = 24 * 60 * 60 * 1000

function pinboardFeedDiskKey(userId: string) {
  return `crea:pinboard_feed:${userId}`
}

export async function hydratePinboardFeedFromDisk(userId: string): Promise<PinboardPost[] | null> {
  const hit = await readPersistedCache<PinboardFeedCache>(pinboardFeedDiskKey(userId))
  if (!hit) return null
  setCache(pinboardCacheKey(userId), hit, 25_000)
  return hit.posts
}

export async function persistPinboardFeedToDisk(userId: string, posts: PinboardPost[]): Promise<void> {
  await writePersistedCache(pinboardFeedDiskKey(userId), { posts }, DISK_PINBOARD_TTL_MS)
}

export function readCachedPinboardFeed(userId: string): PinboardPost[] | null {
  const hit = getCache<PinboardFeedCache>(pinboardCacheKey(userId))
  return hit?.posts ?? null
}

export function formatPinboardTimeAgo(dateStr: string): string {
  const then = supabaseTimestampMs(dateStr)
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const PINBOARD_PAGE_SIZE = 25

export async function loadPinboardFeedPage(opts?: {
  limit?: number
  beforeCreatedAt?: string
}): Promise<{ posts: PinboardPost[]; error: string | null }> {
  const limit = opts?.limit ?? PINBOARD_PAGE_SIZE
  let q = supabase
    .from('job_pinboard_posts')
    .select(
      `
      id,
      body,
      created_at,
      job_id,
      project_id,
      author_id,
      jobs ( id, title, company_id, is_solo_workspace ),
      projects ( id, title, company_id, freelancer_id )
    `
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (opts?.beforeCreatedAt) {
    q = q.lt('created_at', opts.beforeCreatedAt)
  }

  const { data, error } = await q
  if (error) return { posts: [], error: error.message }

  const rows = (data ?? []) as unknown as PinboardPostRow[]
  const authorIds = [...new Set(rows.map((r) => r.author_id))]
  const authorMap: Record<string, { name: string | null; avatar_url: string | null }> = {}

  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, avatar_url')
      .in('id', authorIds)
    for (const p of profiles ?? []) {
      authorMap[String(p.id)] = {
        name: (p.name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null,
      }
    }
  }

  const posts: PinboardPost[] = rows.map((r) => {
    const au = authorMap[r.author_id]
    return {
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      job_id: r.job_id,
      project_id: r.project_id,
      job_title: r.jobs?.title ?? null,
      job_company_id: r.jobs?.company_id ?? null,
      job_is_solo_workspace: Boolean(r.jobs?.is_solo_workspace),
      project_title: r.projects?.title ?? null,
      project_company_id: r.projects?.company_id ?? null,
      author_id: r.author_id,
      author_name: au?.name?.trim() || 'Member',
      author_avatar_url: au?.avatar_url ?? null,
    }
  })

  return { posts, error: null }
}

/** Jobs + native projects the user can link to a feed post (company + Pro/Workspace freelancer). */
export async function loadPinboardAttachOptions(ownerId: string): Promise<PinboardAttachOption[]> {
  const [{ data: jobs, error: jobsErr }, { data: projects, error: projectsErr }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, title')
      .eq('company_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('projects')
      .select('id, title, job_id')
      .or(`company_id.eq.${ownerId},freelancer_id.eq.${ownerId}`)
      .is('job_id', null)
      .order('updated_at', { ascending: false })
      .limit(100),
  ])

  if (jobsErr && projectsErr) return []

  const options: PinboardAttachOption[] = []
  const seen = new Set<string>()

  for (const j of jobs ?? []) {
    const id = String(j.id)
    const title = String(j.title ?? '').trim() || 'Untitled project'
    const key = `job:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ key, id, title, kind: 'job' })
  }

  for (const p of projects ?? []) {
    const id = String(p.id)
    const title = String(p.title ?? '').trim() || 'Untitled project'
    const key = `project:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ key, id, title, kind: 'project' })
  }

  return options
}

/** @deprecated Use loadPinboardAttachOptions */
export async function loadCompanyJobsForPinboard(
  companyId: string
): Promise<{ id: string; title: string }[]> {
  const opts = await loadPinboardAttachOptions(companyId)
  return opts.map((o) => ({ id: o.id, title: o.title }))
}

export async function createPinboardPost(opts: {
  userId: string
  body: string
  jobId: string | null
  projectId: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const validation = validatePinboardUpdateInput({
    body: opts.body,
    jobId: opts.jobId,
    projectId: opts.projectId,
  })
  if (!validation.ok) return validation
  const trimmed = opts.body.trim()
  const { error } = await supabase.from('job_pinboard_posts').insert({
    author_id: opts.userId,
    body: trimmed,
    job_id: opts.jobId,
    project_id: opts.projectId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deletePinboardPost(postId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('job_pinboard_posts').delete().eq('id', postId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export function pinboardPostLinkLabel(post: PinboardPost): string | null {
  if (post.project_id && post.project_title) return post.project_title
  if (post.job_id && post.job_title) return post.job_title
  return null
}

export function pinboardPostHasLink(post: PinboardPost): boolean {
  return Boolean(
    (post.project_id && post.project_title) || (post.job_id && post.job_title)
  )
}

export function pinboardPostLinkKindLabel(post: PinboardPost): string | null {
  if (post.project_id && post.project_title) return PINBOARD_UPDATES_COPY.linkKindProject
  if (post.job_id && post.job_title) return PINBOARD_UPDATES_COPY.linkKindJob
  if (post.project_id || post.job_id) return PINBOARD_UPDATES_COPY.legacyUnlinked
  return null
}

export function canModeratePinboardPost(
  post: PinboardPost,
  userId: string | null
): boolean {
  if (!userId) return false
  if (post.author_id === userId) return true
  if (post.job_id && post.job_company_id === userId) return true
  if (post.project_id && post.project_company_id === userId) return true
  return false
}

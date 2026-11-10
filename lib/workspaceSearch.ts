import type { SupabaseClient } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'

/** Keep in sync with crea-services/lib/workspace-search.ts */

export type WorkspaceSearchKind = 'person' | 'file' | 'milestone' | 'info' | 'message'

export type WorkspaceSearchTab = 'crew' | 'files' | 'milestones' | 'overview' | 'messages'

export type WorkspaceSearchHit = {
  kind: WorkspaceSearchKind
  id: string
  title: string
  snippet: string
  tab: WorkspaceSearchTab
  meta: string | null
}

const PER_KIND = 6
const MESSAGE_LIMIT = 12

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/[%_]/g, '').replace(/\s+/g, ' ')
}

export function snippetAround(
  text: string,
  needle: string,
  radius = 72
): { snippet: string; page: number | null } {
  const clean = text.replace(/\u0000/g, '')
  const hay = clean.toLowerCase()
  const n = needle.trim().toLowerCase()
  const at = n ? hay.indexOf(n) : -1
  const index = at >= 0 ? at : 0
  const page = clean.includes('\f') ? clean.slice(0, index).split('\f').length : null
  const endNeedle = at >= 0 ? index + n.length : index
  const start = Math.max(0, index - radius)
  const end = Math.min(clean.length, endNeedle + radius)
  let slice = clean
    .slice(start, end)
    .replace(/[\f\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!slice) return { snippet: '', page }
  if (start > 0) slice = `…${slice}`
  if (end < clean.length) slice = `${slice}…`
  return { snippet: slice, page }
}

function includes(value: string | null | undefined, needle: string): boolean {
  return Boolean(value && value.toLowerCase().includes(needle.toLowerCase()))
}

function briefText(outputs: unknown): string {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return ''
  return Object.values(outputs as Record<string, unknown>)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
}

function profileName(profiles: unknown): string {
  if (!profiles) return ''
  const row = Array.isArray(profiles) ? profiles[0] : profiles
  if (!row || typeof row !== 'object') return ''
  const name = (row as { name?: string | null }).name
  return typeof name === 'string' ? name.trim() : ''
}

type Loose = Record<string, unknown>

function str(row: Loose, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

export async function searchWorkspace(input: {
  projectId: string | null
  jobId: string | null
  query: string
  includeMessages?: boolean
}): Promise<WorkspaceSearchHit[]> {
  return searchWorkspaceWith(supabase, input)
}

export async function searchWorkspaceWith(
  client: SupabaseClient,
  input: {
    projectId: string | null
    jobId: string | null
    query: string
    includeMessages?: boolean
  }
): Promise<WorkspaceSearchHit[]> {
  const needle = normalizeSearchQuery(input.query)
  if (needle.length < 2) return []
  const like = `%${needle}%`
  const projectId = input.projectId?.trim() || null
  const jobId = input.jobId?.trim() || null

  const [
    projectRes,
    jobRes,
    membersRes,
    manualRes,
    soloCrewRes,
    milestonesRes,
    legacyMilestonesRes,
    filesByNameRes,
    filesByTextRes,
    projectMessagesRes,
    jobMessagesRes,
  ] = await Promise.all([
    projectId
      ? client
          .from('projects')
          .select('id, title, location, brief_ai_context, brief_ai_outputs')
          .eq('id', projectId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    jobId
      ? client
          .from('jobs')
          .select(
            'id, title, description, location, category, solo_workspace_client_label, company_id, is_solo_workspace'
          )
          .eq('id', jobId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    projectId
      ? client
          .from('project_members')
          .select('id, profile_id, member_role, works_as, contact_label, contact_email, profiles(name)')
          .eq('project_id', projectId)
          .limit(80)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    projectId
      ? client
          .from('project_manual_crew')
          .select('id, name, member_role, email, phone')
          .eq('project_id', projectId)
          .limit(80)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    jobId
      ? client
          .from('job_workspace_crew_entries')
          .select('id, name, role, email, phone, notes')
          .eq('job_id', jobId)
          .limit(80)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    jobId
      ? client.from('milestones').select('id, title, description').eq('job_id', jobId).limit(200)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    projectId
      ? client.from('project_milestones').select('id, title').eq('project_id', projectId).limit(200)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    jobId
      ? client
          .from('job_attachments')
          .select('id, file_name, created_at')
          .eq('job_id', jobId)
          .ilike('file_name', like)
          .order('created_at', { ascending: false })
          .limit(PER_KIND)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    jobId
      ? client
          .from('job_attachments')
          .select('id, file_name, extracted_text, created_at')
          .eq('job_id', jobId)
          .ilike('extracted_text', like)
          .order('created_at', { ascending: false })
          .limit(PER_KIND)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    projectId && input.includeMessages !== false
      ? client
          .from('project_messages')
          .select('id, sender_id, body, created_at')
          .eq('project_id', projectId)
          .ilike('body', like)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_LIMIT)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    jobId && input.includeMessages !== false
      ? client
          .from('job_messages')
          .select('id, sender_id, content, created_at')
          .eq('job_id', jobId)
          .ilike('content', like)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_LIMIT)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])

  const hits: WorkspaceSearchHit[] = []
  const project = (projectRes.data ?? null) as Loose | null
  const job = (jobRes.data ?? null) as Loose | null
  const hideMessages = Boolean(job?.is_solo_workspace) || input.includeMessages === false

  let companyName = ''
  const companyId = str(job ?? {}, 'company_id')
  if (companyId) {
    const { data: company } = await client
      .from('company_profiles')
      .select('company_name')
      .eq('id', companyId)
      .maybeSingle()
    companyName = str((company ?? {}) as Loose, 'company_name')
  }

  const pushInfo = (id: string, title: string, text: string) => {
    if (!includes(text, needle) || hits.filter((hit) => hit.kind === 'info').length >= PER_KIND) return
    hits.push({
      kind: 'info',
      id,
      title,
      snippet: snippetAround(text, needle).snippet || text.slice(0, 140),
      tab: 'overview',
      meta: null,
    })
  }

  if (project) {
    pushInfo(`project-title-${str(project, 'id')}`, 'Project', str(project, 'title'))
    pushInfo(`project-location-${str(project, 'id')}`, 'Location', str(project, 'location'))
    pushInfo(`project-brief-${str(project, 'id')}`, 'Brief', str(project, 'brief_ai_context'))
    pushInfo(`project-brief-out-${str(project, 'id')}`, 'Brief', briefText(project.brief_ai_outputs))
  }
  if (job) {
    pushInfo(`job-title-${str(job, 'id')}`, 'Project', str(job, 'title'))
    pushInfo(`job-client-${str(job, 'id')}`, 'Client', str(job, 'solo_workspace_client_label') || companyName)
    pushInfo(`job-location-${str(job, 'id')}`, 'Location', str(job, 'location'))
    pushInfo(`job-category-${str(job, 'id')}`, 'Category', str(job, 'category'))
    pushInfo(`job-description-${str(job, 'id')}`, 'Description', str(job, 'description'))
  }

  const people: WorkspaceSearchHit[] = []
  for (const row of (membersRes.data ?? []) as Loose[]) {
    const name = profileName(row.profiles)
    const role = str(row, 'works_as') || str(row, 'contact_label') || str(row, 'member_role')
    const email = str(row, 'contact_email')
    const blob = [name, role, email].filter(Boolean).join(' ')
    if (!includes(blob, needle)) continue
    people.push({
      kind: 'person',
      id: str(row, 'id') || str(row, 'profile_id'),
      title: name || email || 'Crew',
      snippet: [role, email].filter(Boolean).join(' · ') || 'Crew',
      tab: 'crew',
      meta: 'Crew',
    })
  }
  for (const row of (manualRes.data ?? []) as Loose[]) {
    const blob = [str(row, 'name'), str(row, 'member_role'), str(row, 'email'), str(row, 'phone')].join(' ')
    if (!includes(blob, needle)) continue
    people.push({
      kind: 'person',
      id: str(row, 'id'),
      title: str(row, 'name') || 'Crew',
      snippet: [str(row, 'member_role'), str(row, 'email'), str(row, 'phone')].filter(Boolean).join(' · '),
      tab: 'crew',
      meta: 'Crew',
    })
  }
  for (const row of (soloCrewRes.data ?? []) as Loose[]) {
    const blob = [str(row, 'name'), str(row, 'role'), str(row, 'email'), str(row, 'phone'), str(row, 'notes')].join(' ')
    if (!includes(blob, needle)) continue
    people.push({
      kind: 'person',
      id: str(row, 'id'),
      title: str(row, 'name') || 'Crew',
      snippet: [str(row, 'role'), str(row, 'email'), str(row, 'notes')].filter(Boolean).join(' · '),
      tab: 'crew',
      meta: 'Crew',
    })
  }
  hits.push(...people.slice(0, PER_KIND))

  const milestones: WorkspaceSearchHit[] = []
  for (const row of (milestonesRes.data ?? []) as Loose[]) {
    const title = str(row, 'title')
    const description = str(row, 'description')
    if (!includes(`${title} ${description}`, needle)) continue
    milestones.push({
      kind: 'milestone',
      id: str(row, 'id'),
      title: title || 'Milestone',
      snippet: includes(description, needle) ? snippetAround(description, needle).snippet : title,
      tab: 'milestones',
      meta: 'Milestone',
    })
  }
  if (milestones.length === 0) {
    for (const row of (legacyMilestonesRes.data ?? []) as Loose[]) {
      const title = str(row, 'title')
      if (!includes(title, needle)) continue
      milestones.push({
        kind: 'milestone',
        id: str(row, 'id'),
        title: title || 'Milestone',
        snippet: title,
        tab: 'milestones',
        meta: 'Milestone',
      })
    }
  }
  hits.push(...milestones.slice(0, PER_KIND))

  const files = new Map<string, WorkspaceSearchHit>()
  for (const row of (filesByNameRes.data ?? []) as Loose[]) {
    const id = str(row, 'id')
    const name = str(row, 'file_name') || 'File'
    files.set(id, {
      kind: 'file',
      id,
      title: name,
      snippet: 'File name',
      tab: 'files',
      meta: 'File',
    })
  }
  const textMissing =
    filesByTextRes.error &&
    /extracted_text|column/i.test(`${filesByTextRes.error.message} ${filesByTextRes.error.code ?? ''}`)
  if (!textMissing) {
    for (const row of (filesByTextRes.data ?? []) as Loose[]) {
      const id = str(row, 'id')
      const name = str(row, 'file_name') || 'File'
      const extracted = snippetAround(str(row, 'extracted_text'), needle)
      const page = extracted.page ? `Page ${extracted.page}` : 'In document'
      files.set(id, {
        kind: 'file',
        id,
        title: name,
        snippet: extracted.snippet || name,
        tab: 'files',
        meta: page,
      })
    }
  }
  hits.push(...[...files.values()].slice(0, PER_KIND))

  if (!hideMessages) {
    type Msg = { id: string; senderId: string; body: string; createdAt: string }
    const raw: Msg[] = [
      ...((projectMessagesRes.data ?? []) as Loose[]).map((row) => ({
        id: str(row, 'id'),
        senderId: str(row, 'sender_id'),
        body: str(row, 'body'),
        createdAt: str(row, 'created_at'),
      })),
      ...((jobMessagesRes.data ?? []) as Loose[]).map((row) => ({
        id: str(row, 'id'),
        senderId: str(row, 'sender_id'),
        body: str(row, 'content'),
        createdAt: str(row, 'created_at'),
      })),
    ]
    const kept: Msg[] = []
    for (const row of raw) {
      const t = Date.parse(row.createdAt)
      const dup = kept.find((existing) => {
        if (existing.senderId !== row.senderId) return false
        if (existing.body.trim() !== row.body.trim()) return false
        const other = Date.parse(existing.createdAt)
        if (!Number.isFinite(t) || !Number.isFinite(other)) return false
        return Math.abs(t - other) <= 30_000
      })
      if (!dup) kept.push(row)
    }
    kept.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const senderIds = [...new Set(kept.map((row) => row.senderId).filter(Boolean))]
    const names = new Map<string, string>()
    if (senderIds.length) {
      const { data: profiles } = await client.from('profiles').select('id, name').in('id', senderIds)
      for (const profile of (profiles ?? []) as Loose[]) {
        names.set(str(profile, 'id'), str(profile, 'name'))
      }
    }
    for (const row of kept.slice(0, PER_KIND)) {
      const when = formatSearchWhen(row.createdAt)
      hits.push({
        kind: 'message',
        id: row.id,
        title: names.get(row.senderId) || 'Message',
        snippet: snippetAround(row.body, needle).snippet || row.body.slice(0, 140),
        tab: 'messages',
        meta: when || 'Message',
      })
    }
  }

  const seen = new Set<string>()
  return hits.filter((hit) => {
    const key =
      hit.kind === 'info'
        ? `${hit.kind}|${hit.title}|${hit.snippet}`
        : `${hit.kind}|${hit.id}|${hit.title}|${hit.snippet}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatSearchWhen(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const WORKSPACE_SEARCH_GROUPS: { kind: WorkspaceSearchKind; label: string }[] = [
  { kind: 'person', label: 'People' },
  { kind: 'file', label: 'Files' },
  { kind: 'milestone', label: 'Milestones' },
  { kind: 'info', label: 'Project' },
  { kind: 'message', label: 'Messages' },
]

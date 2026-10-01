import type { SupabaseClient } from '@supabase/supabase-js'
/** Keep in sync with crea-services/lib/workspace-message-mentions.ts */

export const MAX_WORKSPACE_MENTIONS = 20
export type MentionDraft = { profileId: string; label: string }
export type TaggablePerson = {
  profileId: string
  name: string
  label: string
  role: string | null
  avatarUrl: string | null
}
const MESSAGE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function cleanMentionName(name: string): string {
  return name.replace(/[@\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function disambiguateMentionLabels<
  T extends { profileId: string; name: string; role?: string | null },
>(people: T[]): (T & { label: string })[] {
  const cleaned = people
    .map((person) => ({ ...person, name: cleanMentionName(person.name) }))
    .filter((person) => person.profileId.trim() && person.name)
  const counts = new Map<string, number>()
  for (const person of cleaned) {
    counts.set(person.name, (counts.get(person.name) ?? 0) + 1)
  }
  const used = new Map<string, number>()
  return cleaned.map((person) => {
    const role = person.role?.trim()
    let label = (counts.get(person.name) ?? 0) > 1 && role ? `${person.name} (${role})` : person.name
    const seen = (used.get(label) ?? 0) + 1
    used.set(label, seen)
    if (seen > 1) label = `${label} ${seen}`
    return { ...person, label }
  })
}

function mentionToken(label: string): string {
  return `@${cleanMentionName(label)}`
}

function tokenAt(body: string, token: string): boolean {
  if (!token || token === '@') return false
  let from = 0
  while (from < body.length) {
    const index = body.indexOf(token, from)
    if (index < 0) return false
    const beforeOk = index === 0 || /\s/.test(body[index - 1] ?? '')
    const after = index + token.length
    const afterOk = after >= body.length || /[\s.,!?;:]/.test(body[after] ?? '')
    if (beforeOk && afterOk) return true
    from = index + 1
  }
  return false
}

/** Drop tags whose @label is no longer in the text. */
export function mentionsStillInBody(body: string, drafts: MentionDraft[]): MentionDraft[] {
  const kept: MentionDraft[] = []
  const seen = new Set<string>()
  for (const draft of drafts) {
    const profileId = draft.profileId.trim()
    const label = cleanMentionName(draft.label)
    if (!profileId || !label || seen.has(profileId)) continue
    if (!tokenAt(body, mentionToken(label))) continue
    seen.add(profileId)
    kept.push({ profileId, label })
    if (kept.length >= MAX_WORKSPACE_MENTIONS) break
  }
  return kept
}

/** Active @query at the caret. Closes once the query contains whitespace. */
export function activeMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  const upto = text.slice(0, safeCursor)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(upto[at - 1] ?? '')) return null
  const query = upto.slice(at + 1)
  if (/[\s\n]/.test(query)) return null
  return { start: at, query }
}

export function insertMentionToken(
  text: string,
  cursor: number,
  label: string,
): { text: string; cursor: number } {
  const token = `${mentionToken(label)} `
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  const active = activeMentionQuery(text, safeCursor)
  if (active) {
    const next = text.slice(0, active.start) + token + text.slice(safeCursor)
    return { text: next, cursor: active.start + token.length }
  }
  const prefix = text.length > 0 && !/\s$/.test(text) ? `${text} ` : text
  const next = prefix + token
  return { text: next, cursor: next.length }
}

export type MentionTextPart = { text: string; mention: boolean }
export function splitBodyByMentions(body: string, labels: string[]): MentionTextPart[] {
  const unique = [...new Set(labels.map((label) => cleanMentionName(label)).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  if (!unique.length || !body) return [{ text: body, mention: false }]
  const spans: { start: number; end: number }[] = []
  for (const label of unique) {
    const token = mentionToken(label)
    let from = 0
    while (from < body.length) {
      const index = body.indexOf(token, from)
      if (index < 0) break
      const beforeOk = index === 0 || /\s/.test(body[index - 1] ?? '')
      const after = index + token.length
      const afterOk = after >= body.length || /[\s.,!?;:]/.test(body[after] ?? '')
      const overlaps = spans.some((span) => index < span.end && after > span.start)
      if (beforeOk && afterOk && !overlaps) spans.push({ start: index, end: after })
      from = index + token.length
    }
  }
  spans.sort((a, b) => a.start - b.start)
  const parts: MentionTextPart[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) parts.push({ text: body.slice(cursor, span.start), mention: false })
    parts.push({ text: body.slice(span.start, span.end), mention: true })
    cursor = span.end
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), mention: false })
  return parts.length ? parts : [{ text: body, mention: false }]
}

export type MentionIndexEntry = { profileIds: string[]; labels: string[] }
export async function loadWorkspaceMentionIndex(
  supabase: SupabaseClient,
  opts: { projectMessageIds: string[]; jobMessageIds: string[] },
): Promise<Map<string, MentionIndexEntry>> {
  const index = new Map<string, MentionIndexEntry>()
  const add = (messageId: string | null | undefined, profileId: string | null | undefined, label: string | null | undefined) => {
    const id = String(messageId ?? '').trim()
    const profile = String(profileId ?? '').trim()
    const name = cleanMentionName(String(label ?? ''))
    if (!id || !profile || !name) return
    const current = index.get(id) ?? { profileIds: [], labels: [] }
    if (!current.profileIds.includes(profile)) current.profileIds.push(profile)
    if (!current.labels.includes(name)) current.labels.push(name)
    index.set(id, current)
  }
  const projectIds = opts.projectMessageIds.filter((id) => MESSAGE_UUID.test(id))
  const jobIds = opts.jobMessageIds.filter((id) => MESSAGE_UUID.test(id))
  const [projectRes, jobRes] = await Promise.all([
    projectIds.length
      ? supabase
          .from('workspace_message_mentions')
          .select('project_message_id, profile_id, label')
          .in('project_message_id', projectIds)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? supabase
          .from('workspace_message_mentions')
          .select('job_message_id, profile_id, label')
          .in('job_message_id', jobIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (projectRes.error) console.warn('[workspace-mentions]', projectRes.error.message)
  if (jobRes.error) console.warn('[workspace-mentions]', jobRes.error.message)
  for (const row of projectRes.data ?? []) {
    const record = row as { project_message_id?: string | null; profile_id?: string | null; label?: string | null }
    add(record.project_message_id, record.profile_id, record.label)
  }
  for (const row of jobRes.data ?? []) {
    const record = row as { job_message_id?: string | null; profile_id?: string | null; label?: string | null }
    add(record.job_message_id, record.profile_id, record.label)
  }
  return index
}

export async function insertWorkspaceMessageMentions(
  supabase: SupabaseClient,
  opts: {
    projectMessageId?: string | null
    jobMessageId?: string | null
    mentions: MentionDraft[]
  },
): Promise<{ error: string | null }> {
  const drafts = opts.mentions
    .map((mention) => ({ profileId: mention.profileId.trim(), label: cleanMentionName(mention.label) }))
    .filter((mention) => mention.profileId && mention.label)
    .slice(0, MAX_WORKSPACE_MENTIONS)
  const rows: {
    project_message_id: string | null
    job_message_id: string | null
    profile_id: string
    label: string
  }[] = []
  const seen = new Set<string>()
  for (const mention of drafts) {
    if (seen.has(mention.profileId)) continue
    seen.add(mention.profileId)
    if (opts.projectMessageId) {
      rows.push({
        project_message_id: opts.projectMessageId,
        job_message_id: null,
        profile_id: mention.profileId,
        label: mention.label,
      })
    }
    if (opts.jobMessageId) {
      rows.push({
        project_message_id: null,
        job_message_id: opts.jobMessageId,
        profile_id: mention.profileId,
        label: mention.label,
      })
    }
  }
  if (!rows.length) return { error: null }
  const { error } = await supabase.from('workspace_message_mentions').insert(rows)
  return { error: error?.message ?? null }
}

export async function fetchMentionLabelsForMessage(
  supabase: SupabaseClient,
  messageId: string,
): Promise<string[]> {
  if (!MESSAGE_UUID.test(messageId)) return []
  const { data, error } = await supabase
    .from('workspace_message_mentions')
    .select('label')
    .or(`project_message_id.eq.${messageId},job_message_id.eq.${messageId}`)
  if (error || !data) return []
  return [...new Set(data.map((row) => cleanMentionName(String((row as { label?: string }).label ?? ''))).filter(Boolean))]
}

export async function mentionedProjectMessageIdSet(
  supabase: SupabaseClient,
  userId: string,
  projectMessageIds: string[],
): Promise<Set<string>> {
  const ids = projectMessageIds.filter((id) => MESSAGE_UUID.test(id))
  if (!userId || !ids.length) return new Set()
  const { data, error } = await supabase
    .from('workspace_message_mentions')
    .select('project_message_id')
    .in('project_message_id', ids)
    .eq('profile_id', userId)
  if (error || !data) return new Set()
  return new Set(
    data
      .map((row) => String((row as { project_message_id?: string | null }).project_message_id ?? ''))
      .filter(Boolean),
  )
}

type MemberProfile = { name?: string | null; avatar_url?: string | null } | { name?: string | null; avatar_url?: string | null }[] | null
function firstProfile(value: MemberProfile): { name?: string | null; avatar_url?: string | null } | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** People with workspace access who can be @mentioned. Excludes the viewer. */
export async function fetchTaggableWorkspacePeople(
  supabase: SupabaseClient,
  opts: { projectId: string; viewerId: string },
): Promise<TaggablePerson[]> {
  const { data: proj } = await supabase
    .from('projects')
    .select('company_id, freelancer_id, job_id')
    .eq('id', opts.projectId)
    .maybeSingle()
  const jobId = proj?.job_id ? String(proj.job_id) : null
  const [membersRes, appsRes] = await Promise.all([
    supabase
      .from('project_members')
      .select('profile_id, member_role, profiles(name, avatar_url)')
      .eq('project_id', opts.projectId),
    jobId
      ? supabase
          .from('job_applications')
          .select('freelancer_id, applied_role, profiles(name, avatar_url)')
          .eq('job_id', jobId)
          .eq('status', 'accepted')
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ])
  const byId = new Map<string, { profileId: string; name: string; role: string | null; avatarUrl: string | null }>()
  const add = (
    profileId: string | null | undefined,
    name: string | null | undefined,
    role: string | null,
    avatarUrl: string | null,
  ) => {
    const id = String(profileId ?? '').trim()
    if (!id || id === opts.viewerId || byId.has(id)) return
    const cleaned = cleanMentionName(String(name ?? ''))
    if (!cleaned) return
    byId.set(id, { profileId: id, name: cleaned, role, avatarUrl })
  }
  for (const row of membersRes.data ?? []) {
    const record = row as {
      profile_id?: string
      member_role?: string | null
      profiles?: MemberProfile
    }
    const profile = firstProfile(record.profiles ?? null)
    const roleName = String(record.member_role ?? '').toLowerCase() === 'company' ? 'Company' : record.member_role ?? null
    add(record.profile_id, profile?.name, roleName, profile?.avatar_url ?? null)
  }

  for (const row of (appsRes.data ?? []) as Array<{
    freelancer_id?: string
    applied_role?: string | null
    profiles?: MemberProfile
  }>) {
    const profile = firstProfile(row.profiles ?? null)
    add(row.freelancer_id, profile?.name, row.applied_role ?? null, profile?.avatar_url ?? null)
  }

  const extraIds = [proj?.company_id, proj?.freelancer_id]
    .map((id) => (id ? String(id) : ''))
    .filter((id) => id && id !== opts.viewerId && !byId.has(id))
  if (extraIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, name, avatar_url').in('id', extraIds)
    for (const profile of profiles ?? []) {
      const id = String((profile as { id: string }).id)
      const role = id === String(proj?.company_id ?? '') ? 'Company' : null
      add(id, (profile as { name?: string | null }).name, role, (profile as { avatar_url?: string | null }).avatar_url ?? null)
    }
  }

  return disambiguateMentionLabels([...byId.values()])
}

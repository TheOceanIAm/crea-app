import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationRow } from '@/lib/notificationsFeed'

/** @see crea-services/lib/workspace-activity-alert-rows.ts — keep in sync */

function storageFileDisplayName(raw: string): string {
  const base = raw.replace(/^\d+_/, '').trim()
  return base || raw
}

export async function loadWorkspaceFileAlertRows(params: {
  supabase: SupabaseClient
  userId: string
  projectIds: string[]
  projectTitle: Map<string, string>
  projectJobId: Map<string, string>
  accessibleJobIds: string[]
  sevenDaysAgoIso: string
}): Promise<NotificationRow[]> {
  const { supabase, userId, projectIds, projectTitle, projectJobId, accessibleJobIds, sevenDaysAgoIso } =
    params
  const rows: NotificationRow[] = []

  if (accessibleJobIds.length > 0) {
    const { data: attachments, error } = await supabase
      .from('job_attachments')
      .select('id, job_id, file_name, uploaded_by, created_at')
      .in('job_id', accessibleJobIds)
      .neq('uploaded_by', userId)
      .gte('created_at', sevenDaysAgoIso)
      .order('created_at', { ascending: false })
      .limit(60)

    if (!error) {
      for (const a of attachments ?? []) {
        const jid = String(a.job_id)
        const pid =
          [...projectJobId.entries()].find(([, jobId]) => jobId === jid)?.[0] ?? jid
        const name = String(a.file_name || 'File').trim() || 'File'
        rows.push({
          id: `file-job-${a.id}`,
          kind: 'project_update',
          projectId: pid,
          jobId: jid,
          title: projectTitle.get(pid) ?? 'Project',
          body: `File uploaded: ${name}`,
          at: String(a.created_at),
        })
      }
    }
  }

  const cappedProjectIds = projectIds.slice(0, 40)
  await Promise.all(
    cappedProjectIds.map(async (pid) => {
      const { data, error } = await supabase.storage.from('project-files').list(pid, {
        limit: 12,
        sortBy: { column: 'created_at', order: 'desc' },
      })
      if (error || !data?.length) return

      for (const f of data) {
        const created = typeof f.created_at === 'string' ? f.created_at : ''
        if (!created || new Date(created).toISOString() < sevenDaysAgoIso) continue
        const name = String(f.name ?? '').trim()
        if (!name || name === '.emptyFolderPlaceholder') continue
        rows.push({
          id: `file-storage-${pid}-${name}-${created}`,
          kind: 'project_update',
          projectId: pid,
          jobId: projectJobId.get(pid),
          title: projectTitle.get(pid) ?? 'Project',
          body: `File uploaded: ${storageFileDisplayName(name)}`,
          at: created,
        })
      }
    })
  )

  return rows
}

export async function loadWorkspaceReviewLinkAlertRows(params: {
  supabase: SupabaseClient
  userId: string
  projectIds: string[]
  projectTitle: Map<string, string>
  projectJobId: Map<string, string>
  jobIdToProjectId: Map<string, string>
  accessibleJobIds: string[]
  sevenDaysAgoIso: string
}): Promise<NotificationRow[]> {
  const {
    supabase,
    userId,
    projectIds,
    projectTitle,
    projectJobId,
    jobIdToProjectId,
    accessibleJobIds,
    sevenDaysAgoIso,
  } = params
  const rows: NotificationRow[] = []

  if (projectIds.length > 0) {
    const selectCols =
      'id, title, frame_io_url_updated_at, frame_io_url_updated_by, picdrop_url_updated_at, picdrop_url_updated_by'

    const [{ data: frameProjects, error: frameErr }, { data: picProjects, error: picErr }] =
      await Promise.all([
        supabase
          .from('projects')
          .select(selectCols)
          .in('id', projectIds)
          .gte('frame_io_url_updated_at', sevenDaysAgoIso)
          .limit(80),
        supabase
          .from('projects')
          .select(selectCols)
          .in('id', projectIds)
          .gte('picdrop_url_updated_at', sevenDaysAgoIso)
          .limit(80),
      ])

    if (!frameErr) {
      for (const p of frameProjects ?? []) {
        const pid = String(p.id)
        const frameAt = p.frame_io_url_updated_at ? String(p.frame_io_url_updated_at) : ''
        const frameBy = p.frame_io_url_updated_by ? String(p.frame_io_url_updated_by) : ''
        if (frameAt && frameBy !== userId) {
          rows.push({
            id: `review-frame-project-${pid}-${frameAt}`,
            kind: 'project_update',
            projectId: pid,
            jobId: projectJobId.get(pid),
            title: projectTitle.get(pid) ?? String(p.title || 'Project'),
            body: 'Frame.io link updated.',
            at: frameAt,
          })
        }
      }
    }
    if (!picErr) {
      for (const p of picProjects ?? []) {
        const pid = String(p.id)
        const picAt = p.picdrop_url_updated_at ? String(p.picdrop_url_updated_at) : ''
        const picBy = p.picdrop_url_updated_by ? String(p.picdrop_url_updated_by) : ''
        if (picAt && picBy !== userId) {
          rows.push({
            id: `review-picdrop-project-${pid}-${picAt}`,
            kind: 'project_update',
            projectId: pid,
            jobId: projectJobId.get(pid),
            title: projectTitle.get(pid) ?? String(p.title || 'Project'),
            body: 'PicDrop link updated.',
            at: picAt,
          })
        }
      }
    }
  }

  if (accessibleJobIds.length > 0) {
    const selectCols =
      'id, title, frameio_url_updated_at, frameio_url_updated_by, picdrop_url_updated_at, picdrop_url_updated_by'

    const [{ data: frameJobs, error: frameJobErr }, { data: picJobs, error: picJobErr }] =
      await Promise.all([
        supabase
          .from('jobs')
          .select(selectCols)
          .in('id', accessibleJobIds)
          .gte('frameio_url_updated_at', sevenDaysAgoIso)
          .limit(80),
        supabase
          .from('jobs')
          .select(selectCols)
          .in('id', accessibleJobIds)
          .gte('picdrop_url_updated_at', sevenDaysAgoIso)
          .limit(80),
      ])

    if (!frameJobErr) {
      for (const j of frameJobs ?? []) {
        const jid = String(j.id)
        const pid = jobIdToProjectId.get(jid) ?? jid
        const frameAt = j.frameio_url_updated_at ? String(j.frameio_url_updated_at) : ''
        const frameBy = j.frameio_url_updated_by ? String(j.frameio_url_updated_by) : ''
        if (frameAt && frameBy !== userId) {
          rows.push({
            id: `review-frame-job-${jid}-${frameAt}`,
            kind: 'project_update',
            projectId: pid,
            jobId: jid,
            title: projectTitle.get(pid) ?? String(j.title || 'Project'),
            body: 'Frame.io link updated.',
            at: frameAt,
          })
        }
      }
    }
    if (!picJobErr) {
      for (const j of picJobs ?? []) {
        const jid = String(j.id)
        const pid = jobIdToProjectId.get(jid) ?? jid
        const picAt = j.picdrop_url_updated_at ? String(j.picdrop_url_updated_at) : ''
        const picBy = j.picdrop_url_updated_by ? String(j.picdrop_url_updated_by) : ''
        if (picAt && picBy !== userId) {
          rows.push({
            id: `review-picdrop-job-${jid}-${picAt}`,
            kind: 'project_update',
            projectId: pid,
            jobId: jid,
            title: projectTitle.get(pid) ?? String(j.title || 'Project'),
            body: 'PicDrop link updated.',
            at: picAt,
          })
        }
      }
    }
  }

  return rows
}

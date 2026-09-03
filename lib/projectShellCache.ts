import { getCache, setCache } from '@/lib/appCache'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { LIST_DISK_TTL_MS, LIST_MEM_TTL_MS } from '@/lib/cachePolicy'
import { CREA_API_WORKSPACE_TIMEOUT_MS, fetchCreaApi } from '@/lib/creaApiFetch'

export type ProjectShellRow = {
  id: string
  job_id: string | null
  company_id: string
  freelancer_id: string
  title: string
  status: string
  budget_amount: number | null
  budget_type: string | null
  budget_currency: string | null
  location: string | null
  milestones_completed: number
  milestones_total: number
  brief_ai_context: string | null
  frame_io_url: string | null
  picdrop_url: string | null
  brief_ai_outputs: Record<string, string> | null
  scheduling_start_date: string | null
  scheduling_end_date: string | null
}

export type ProjectShellCache = {
  project: ProjectShellRow
  overviewSummary: string
  isPrivateWorkspace: boolean
  jobOwnerCompanyId: string | null
}

const MEM_TTL_MS = LIST_MEM_TTL_MS
const DISK_TTL_MS = LIST_DISK_TTL_MS

function memKey(projectId: string): string {
  return `project-shell:${projectId}`
}

function diskKey(projectId: string): string {
  return `crea:project-shell:${projectId}`
}

export function readCachedProjectShell(projectId: string): ProjectShellCache | null {
  return getCache<ProjectShellCache>(memKey(projectId))
}

export function cacheProjectShell(projectId: string, data: ProjectShellCache): void {
  setCache(memKey(projectId), data, MEM_TTL_MS)
}

export async function hydrateProjectShellFromDisk(projectId: string): Promise<ProjectShellCache | null> {
  const hit = await readPersistedCache<ProjectShellCache>(diskKey(projectId))
  if (!hit) return null
  cacheProjectShell(projectId, hit)
  return hit
}

export async function persistProjectShellToDisk(projectId: string, data: ProjectShellCache): Promise<void> {
  await writePersistedCache(diskKey(projectId), data, DISK_TTL_MS)
}

const inflight = new Map<string, Promise<void>>()

/** Prefetch workspace shell on list pressIn. */
export function prefetchProjectShell(projectId: string): void {
  if (!projectId || readCachedProjectShell(projectId) || inflight.has(projectId)) return
  const run = (async () => {
    const disk = await hydrateProjectShellFromDisk(projectId)
    if (disk) return
    const { data: shellJson, error } = await fetchCreaApi<{
      payload?: {
        access?: string
        project?: ProjectShellRow | null
        job?: { description?: string | null; is_solo_workspace?: boolean | null; company_id?: string }
        workspaceSummaryDraft?: string
      }
    }>(`/api/app/job-workspace/${encodeURIComponent(projectId)}`, {
      timeoutMs: CREA_API_WORKSPACE_TIMEOUT_MS,
    })
    const shell = shellJson?.payload
    if (error || shell?.access !== 'allowed' || !shell.project) return
    const p = shell.project
    const data: ProjectShellCache = {
      project: p,
      overviewSummary:
        (shell.workspaceSummaryDraft || '').trim() ||
        (typeof shell.job?.description === 'string' ? shell.job.description.trim() : '') ||
        (p.brief_ai_context ?? '').trim(),
      isPrivateWorkspace: Boolean(shell.job?.is_solo_workspace),
      jobOwnerCompanyId:
        typeof shell.job?.company_id === 'string' ? shell.job.company_id : p.company_id,
    }
    cacheProjectShell(projectId, data)
    void persistProjectShellToDisk(projectId, data)
  })().finally(() => {
    inflight.delete(projectId)
  })
  inflight.set(projectId, run)
}

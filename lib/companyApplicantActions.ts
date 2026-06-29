import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { supabase } from '@/lib/supabase'

/**
 * Accept / decline a freelancer's job application from the app.
 *
 * Accepting is a plain `job_applications` status update — the DB trigger
 * `trg_job_applications_accepted_sync_project_crew` then promotes the freelancer
 * to the project (lead or crew) and grants workspace access. We only add a
 * best-effort capacity precheck (mirrors the web manage-job flow) and an optional
 * `works_as` label sync. No extra backend changes are required.
 */

const CAPACITY_TIMEOUT_MS = 8_000

function webBases(): string[] {
  const base = getCreaWebBaseUrl()
  if (!base) return []
  const candidates = [base]
  if (base === 'https://www.creaservices.de') candidates.push('https://creaservices.de')
  if (base === 'https://creaservices.de') candidates.push('https://www.creaservices.de')
  return candidates
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

type CapacityResult = {
  blocked: boolean
  message?: string
}

/**
 * Best-effort capacity / beta check via the web API. If the API is unreachable we
 * do NOT block (the DB beta trigger still enforces the hard rule on update); if it
 * answers and reports a limit, we surface it.
 */
async function checkFreelancerCapacity(freelancerId: string): Promise<CapacityResult> {
  const bases = webBases()
  const headers = await authHeaders()
  if (!bases.length || !headers) return { blocked: false }

  for (const base of bases) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CAPACITY_TIMEOUT_MS)
    try {
      const res = await fetch(`${base}/api/freelancer/active-accepted-jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ freelancerId }),
        signal: controller.signal,
      })
      const j = (await res.json().catch(() => ({}))) as {
        atCapacity?: boolean
        maxSlots?: number | null
        newJobWorkBlocked?: boolean
        error?: string
      }
      if (!res.ok) {
        // Server reachable but errored — fall through to next base, else allow.
        continue
      }
      if (j.newJobWorkBlocked) {
        return {
          blocked: true,
          message: 'This freelancer cannot take on new job work right now (trial ended).',
        }
      }
      if (j.atCapacity) {
        return {
          blocked: true,
          message: `This freelancer has reached their plan limit for active bookings${
            j.maxSlots != null ? ` (${j.maxSlots})` : ''
          }.`,
        }
      }
      return { blocked: false }
    } catch {
      // Network/timeout — try next base, else allow (don't false-block the company).
      continue
    } finally {
      clearTimeout(timer)
    }
  }
  return { blocked: false }
}

export async function acceptCompanyJobApplication(opts: {
  applicationId: string
  freelancerId: string
}): Promise<{ ok: boolean; error?: string }> {
  const cap = await checkFreelancerCapacity(opts.freelancerId)
  if (cap.blocked) return { ok: false, error: cap.message ?? 'Could not accept this application.' }

  const { data: appRow } = await supabase
    .from('job_applications')
    .select('job_id, freelancer_id, applied_role')
    .eq('id', opts.applicationId)
    .maybeSingle()

  const { error } = await supabase
    .from('job_applications')
    .update({ status: 'accepted' })
    .eq('id', opts.applicationId)

  if (error) {
    const msg = error.message?.toLowerCase() ?? ''
    if (msg.includes('beta_trial_ended')) {
      return { ok: false, error: 'This freelancer cannot take on new job work right now (trial ended).' }
    }
    return { ok: false, error: error.message }
  }

  // Sync the applied role label onto the (trigger-created) project member, best-effort.
  const roleLabel = (appRow?.applied_role && String(appRow.applied_role).trim()) || ''
  if (roleLabel && appRow?.job_id) {
    try {
      const { data: proj } = await supabase
        .from('projects')
        .select('id')
        .eq('job_id', appRow.job_id)
        .maybeSingle()
      const projectId = proj?.id ?? appRow.job_id
      const { data: pm } = await supabase
        .from('project_members')
        .select('id, works_as')
        .eq('project_id', projectId)
        .eq('profile_id', appRow.freelancer_id)
        .maybeSingle()
      if (pm?.id) {
        if (!(pm.works_as && String(pm.works_as).trim())) {
          await supabase.from('project_members').update({ works_as: roleLabel }).eq('id', pm.id)
        }
      }
    } catch {
      // non-fatal
    }
  }

  return { ok: true }
}

export async function declineCompanyJobApplication(
  applicationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('job_applications')
    .update({ status: 'declined' })
    .eq('id', applicationId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

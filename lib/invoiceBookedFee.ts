import type { SupabaseClient } from '@supabase/supabase-js'
import {
  formatBookedSlotsSummary,
  memberBookedSlotsFromRow,
  totalBookedDayUnits,
} from '@/lib/memberBookedDates'
import { crewCostForBookedUnits } from '@/lib/projectInternalBudget'

export type InvoiceBookedFee = {
  netFee: number
  dayUnits: number
  dayRate: number
  halfDayRate: number | null
  roleLabel: string | null
  scheduleSummary: string | null
  hint: string
}

function parseRate(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.replace(',', '.'))
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function formatEur(n: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Booked fee for the freelancer on a job (day/half-day × booked_dates). */
export async function loadInvoiceBookedFeeForJob(
  supabase: SupabaseClient,
  opts: { jobId: string; freelancerId: string }
): Promise<InvoiceBookedFee | null> {
  const jobId = opts.jobId.trim()
  const freelancerId = opts.freelancerId.trim()
  if (!jobId || !freelancerId) return null

  const [memberRes, profileRes, appRes] = await Promise.all([
    supabase
      .from('project_members')
      .select(
        'works_as, member_role, booked_dates, scheduling_start_date, scheduling_end_date, projects!inner(job_id)'
      )
      .eq('profile_id', freelancerId)
      .eq('projects.job_id', jobId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('day_rate_amount, half_day_rate_amount')
      .eq('id', freelancerId)
      .maybeSingle(),
    supabase
      .from('job_applications')
      .select('applied_role')
      .eq('job_id', jobId)
      .eq('freelancer_id', freelancerId)
      .eq('status', 'accepted')
      .limit(1)
      .maybeSingle(),
  ])

  let member = memberRes.data as Record<string, unknown> | null

  if (!member) {
    const { data: leadProj } = await supabase
      .from('projects')
      .select('id')
      .eq('job_id', jobId)
      .eq('freelancer_id', freelancerId)
      .limit(1)
      .maybeSingle()
    if (leadProj?.id) {
      const { data: leadMember } = await supabase
        .from('project_members')
        .select('works_as, member_role, booked_dates, scheduling_start_date, scheduling_end_date')
        .eq('project_id', leadProj.id)
        .eq('profile_id', freelancerId)
        .limit(1)
        .maybeSingle()
      member = (leadMember as Record<string, unknown> | null) ?? null
    }
  }

  if (!member) return null

  const slots = memberBookedSlotsFromRow(member)
  const dayUnits = totalBookedDayUnits(slots)
  const dayRate = parseRate((profileRes.data as { day_rate_amount?: unknown } | null)?.day_rate_amount)
  const halfDayRate = parseRate(
    (profileRes.data as { half_day_rate_amount?: unknown } | null)?.half_day_rate_amount
  )

  if (!dayRate || dayUnits <= 0) return null

  let netFee = 0
  for (const { units } of slots) {
    netFee += crewCostForBookedUnits(units, dayRate, halfDayRate)
  }
  netFee = Math.round(netFee * 100) / 100
  if (netFee <= 0) return null

  const worksAs =
    typeof member.works_as === 'string' && member.works_as.trim() ? member.works_as.trim() : ''
  const appliedRole =
    typeof (appRes.data as { applied_role?: string | null } | null)?.applied_role === 'string'
      ? String((appRes.data as { applied_role: string }).applied_role).trim()
      : ''
  const roleLabel = worksAs || appliedRole || null
  const scheduleSummary = formatBookedSlotsSummary(slots)
  const unitsLabel =
    dayUnits === 1 ? '1 day' : `${dayUnits % 1 === 0 ? dayUnits : dayUnits.toFixed(1)} days`
  const ratePart =
    halfDayRate != null && slots.some((s) => Math.abs(s.units - 0.5) < 1e-9)
      ? `${formatEur(dayRate)}/day (half days at ${formatEur(halfDayRate)})`
      : `${formatEur(dayRate)}/day`
  const hint = `From your booking: ${unitsLabel} × ${ratePart} = ${formatEur(netFee)}. You can change the amount if you agreed something else.`

  return {
    netFee,
    dayUnits,
    dayRate,
    halfDayRate,
    roleLabel,
    scheduleSummary,
    hint,
  }
}

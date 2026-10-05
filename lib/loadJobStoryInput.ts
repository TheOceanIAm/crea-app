import { supabase } from '@/lib/supabase'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'
import type { JobStoryShareInput } from '@/components/JobStoryExporter'

/** Listing fields for the story graphic. Private workspaces are skipped. */
export async function loadJobStoryInput(jobId: string): Promise<JobStoryShareInput | null> {
  const id = jobId.trim()
  if (!id) return null

  const { data: row, error } = await supabase
    .from('jobs')
    .select(
      'id, title, description, location, location_type, budget_type, budget_amount, budget_currency, company_id, is_solo_workspace'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !row || row.is_solo_workspace) return null

  const companyId = String(row.company_id || '').trim()
  let company = 'Company'
  let companyLogoUrl: string | null = null
  if (companyId) {
    const [{ data: profile }, { data: companyProfile }] = await Promise.all([
      supabase.from('profiles').select('name, avatar_url').eq('id', companyId).maybeSingle(),
      supabase.from('company_profiles').select('company_name, logo_url').eq('id', companyId).maybeSingle(),
    ])
    company = (companyProfile?.company_name || profile?.name || 'Company').trim() || 'Company'
    companyLogoUrl = (companyProfile?.logo_url || profile?.avatar_url || '').trim() || null
  }

  return {
    jobId: String(row.id),
    jobTitle: String(row.title || 'Job'),
    company,
    companyLogoUrl,
    budget: formatBudgetDisplay({
      budget_type: String(row.budget_type || 'negotiable'),
      budget_amount: row.budget_amount,
      budget_currency: row.budget_currency,
    }),
    location: String(row.location || '').trim() || String(row.location_type || '').trim() || '—',
    description: String(row.description || '').trim() || '—',
  }
}

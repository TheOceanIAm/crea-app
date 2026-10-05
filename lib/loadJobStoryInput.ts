import { supabase } from '@/lib/supabase'
import { fetchCreaApi } from '@/lib/creaApiFetch'
import { formatBudgetDisplay } from '@/lib/budgetFormatting'
import type { JobStoryShareInput } from '@/components/JobStoryExporter'

const postingLogos = new Map<string, string>()

function usableLogo(url: string | null | undefined): string | null {
  const value = url?.trim() ?? ''
  if (!/^https?:\/\//i.test(value)) return null
  if (/ui-avatars\.com|google\.com\/s2\/favicons/i.test(value)) return null
  return value
}

/** Logo shown on the jobs list, reused if the detail query has not finished. */
export function rememberJobPostingLogo(jobId: string, url: string | null | undefined) {
  const logo = usableLogo(url)
  if (logo) postingLogos.set(jobId, logo)
}

/**
 * Logo stored on the web job posting.
 * The web API reads `company_profiles.logo_url` for that job; the list/detail URL is the fallback.
 */
export async function storyLogoUrl(jobId: string, fallback?: string | null): Promise<string | null> {
  const id = jobId.trim()
  const local = usableLogo(fallback) || (id ? postingLogos.get(id) ?? null : null)
  if (local || !id) return local
  const { data } = await fetchCreaApi<{ logoUrl?: string | null }>(
    `/api/company-logo?jobId=${encodeURIComponent(id)}`,
    { timeoutMs: 12000 }
  )
  return usableLogo(data?.logoUrl)
}

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
    companyLogoUrl = usableLogo(companyProfile?.logo_url) || usableLogo(profile?.avatar_url)
  }
  companyLogoUrl = await storyLogoUrl(String(row.id), companyLogoUrl)

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

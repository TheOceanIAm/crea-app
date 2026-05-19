import { loadPortfolioProjectsForSettings, syncFreelancerPortfolioProjectsTable } from '@/lib/freelancerPortfolioTable'
import { mergeFreelancerPublicProfile } from '@/lib/mergeFreelancerPublicProfile'
import { resolveCanonicalFreelancerHeadline } from '@/lib/freelancerHeadlineSync'
import { postSyncFreelancerProfileToWeb } from '@/lib/syncFreelancerProfileApi'
import { supabase } from '@/lib/supabase'

const PROFILES_MIRROR_SELECT =
  'headline, bio, location, skills, equipment, day_rate_amount, half_day_rate_amount, open_to_remote, open_to_travel, portfolio_website, portfolio_instagram, portfolio_linkedin, portfolio_vimeo, portfolio_behance'

const FP_MIRROR_SELECT =
  'job_title, bio, location, skills, essentials, day_rate, half_day_rate, open_to_remote, open_to_travel, website, instagram, linkedin, vimeo, behance'

/** Upsert fields the web app reads from `freelancer_profiles` (settings + public profile merge). */
export async function upsertFreelancerProfilesRow(
  userId: string,
  fields: Record<string, unknown>
): Promise<{ error: string | null }> {
  const uid = userId.trim()
  if (!uid) return { error: 'Missing user id' }

  const { error } = await supabase.from('freelancer_profiles').upsert(
    { id: uid, ...fields },
    { onConflict: 'id' }
  )
  return { error: error?.message ?? null }
}

/**
 * Push `profiles` data into `freelancer_profiles` so the web app shows the same public profile as the app.
 * Safe to call after load (backfill) and on save.
 */
export async function mirrorProfilesToFreelancerProfiles(
  userId: string
): Promise<{ error: string | null; portfolioSynced?: number }> {
  const uid = userId.trim()
  if (!uid) return { error: 'Missing user id' }

  const api = await postSyncFreelancerProfileToWeb()
  if (api.ok) {
    return { error: null, portfolioSynced: api.portfolioSynced }
  }

  if (__DEV__ && api.error && api.error !== 'missing_web_url') {
    console.warn('[mirrorProfilesToFreelancerProfiles] API sync failed, using client fallback:', api.error)
  }

  const portfolio = await loadPortfolioProjectsForSettings(uid)
  const port = await syncFreelancerPortfolioProjectsTable(uid, portfolio)
  if (port.error) return { error: port.error }

  const [{ data: p }, { data: fp }] = await Promise.all([
    supabase.from('profiles').select(PROFILES_MIRROR_SELECT).eq('id', uid).maybeSingle(),
    supabase.from('freelancer_profiles').select(FP_MIRROR_SELECT).eq('id', uid).maybeSingle(),
  ])

  const merged = mergeFreelancerPublicProfile(
    (p as Record<string, unknown> | null) ?? null,
    (fp as Record<string, unknown> | null) ?? null
  )

  const headline = resolveCanonicalFreelancerHeadline(
    typeof p?.headline === 'string' ? p.headline : null,
    merged.job_title
  )

  const profilePatch: Record<string, unknown> = {
    headline: headline || null,
    bio: merged.bio,
    location: merged.location,
    skills: merged.skills,
    equipment: merged.essentials,
    open_to_remote: merged.open_to_remote,
    open_to_travel: merged.open_to_travel,
    portfolio_website: merged.website,
    portfolio_instagram: merged.instagram,
    portfolio_linkedin: merged.linkedin,
    portfolio_vimeo: merged.vimeo,
    portfolio_behance: merged.behance,
  }
  if (merged.day_rate != null) profilePatch.day_rate_amount = merged.day_rate

  const { error: profileErr } = await supabase.from('profiles').update(profilePatch).eq('id', uid)
  if (profileErr) return { error: profileErr.message }

  return upsertFreelancerProfilesRow(uid, {
    job_title: headline || null,
    bio: merged.bio,
    location: merged.location,
    skills: merged.skills,
    essentials: merged.essentials,
    day_rate: merged.day_rate,
    open_to_remote: merged.open_to_remote,
    open_to_travel: merged.open_to_travel,
    website: merged.website,
    instagram: merged.instagram,
    linkedin: merged.linkedin,
    vimeo: merged.vimeo,
    behance: merged.behance,
  })
}

export async function syncFreelancerCoreProfileToWeb(
  userId: string,
  fields: {
    headline?: string | null
    bio?: string | null
    location?: string | null
    skills?: string[]
    equipment?: string[]
    open_to_remote?: boolean
    open_to_travel?: boolean
  }
): Promise<{ error: string | null }> {
  const uid = userId.trim()
  if (!uid) return { error: 'Missing user id' }

  const profilePatch: Record<string, unknown> = {}
  const fpPatch: Record<string, unknown> = {}

  if (fields.headline !== undefined) {
    const v = fields.headline?.trim() || null
    profilePatch.headline = v
    fpPatch.job_title = v
  }
  if (fields.bio !== undefined) {
    const v = fields.bio?.trim() || null
    profilePatch.bio = v
    fpPatch.bio = v
  }
  if (fields.location !== undefined) {
    const v = fields.location?.trim() || null
    profilePatch.location = v
    fpPatch.location = v
  }
  if (fields.skills !== undefined) {
    profilePatch.skills = fields.skills
    fpPatch.skills = fields.skills
  }
  if (fields.equipment !== undefined) {
    profilePatch.equipment = fields.equipment
    fpPatch.essentials = fields.equipment
  }
  if (fields.open_to_remote !== undefined) {
    profilePatch.open_to_remote = fields.open_to_remote
    fpPatch.open_to_remote = fields.open_to_remote
  }
  if (fields.open_to_travel !== undefined) {
    profilePatch.open_to_travel = fields.open_to_travel
    fpPatch.open_to_travel = fields.open_to_travel
  }

  if (Object.keys(profilePatch).length > 0) {
    const { error } = await supabase.from('profiles').update(profilePatch).eq('id', uid)
    if (error) return { error: error.message }
  }

  if (Object.keys(fpPatch).length > 0) {
    return upsertFreelancerProfilesRow(uid, fpPatch)
  }

  return { error: null }
}

export async function syncFreelancerSocialLinksToWeb(
  userId: string,
  links: {
    website?: string | null
    instagram?: string | null
    linkedin?: string | null
    vimeo?: string | null
    behance?: string | null
  }
): Promise<{ error: string | null }> {
  return upsertFreelancerProfilesRow(userId, {
    website: links.website?.trim() || null,
    instagram: links.instagram?.trim() || null,
    linkedin: links.linkedin?.trim() || null,
    vimeo: links.vimeo?.trim() || null,
    behance: links.behance?.trim() || null,
  })
}

export async function syncFreelancerInvoiceFieldsToWeb(
  userId: string,
  fields: {
    bank_account_holder?: string | null
    bank_iban?: string | null
    bank_bic?: string | null
    paypal_email?: string | null
    invoice_address?: string | null
    tax_number?: string | null
    vat_registered?: boolean
  }
): Promise<{ error: string | null }> {
  return upsertFreelancerProfilesRow(userId, {
    bank_account_holder: fields.bank_account_holder?.trim() || null,
    bank_iban: fields.bank_iban?.trim() || null,
    bank_bic: fields.bank_bic?.trim() || null,
    paypal_email: fields.paypal_email?.trim() || null,
    invoice_address: fields.invoice_address?.trim() || null,
    steuer_id: fields.tax_number?.trim() || null,
    vat_registered: Boolean(fields.vat_registered),
  })
}

/** Payload from `profile_share_public` RPC — freelancer public profile. */
export type FreelancerPublicProfilePayload = {
  id: string
  name: string | null
  role: string | null
  headline: string | null
  location: string | null
  bio: string | null
  avatar_url: string | null
  skills: unknown
  equipment: unknown
  portfolio_website: string | null
  portfolio_instagram: string | null
  portfolio_linkedin: string | null
  portfolio_vimeo: string | null
  portfolio_behance: string | null
  portfolio_projects: unknown
  public_profile_widgets?: unknown
  day_rate_amount?: number | null
  half_day_rate_amount?: number | null
  rates_currency?: string | null
  availability_calendar?: unknown
  /** ISO dates (YYYY-MM-DD) blocked by active/in_progress projects with scheduling range. */
  calendar_busy_dates?: string[] | unknown
  availability_status?: string | null
  availability_details?: string | null
  open_to_remote?: boolean | null
  open_to_travel?: boolean | null
  years_experience?: number | null
  plan_tier?: string | null
  subscription_tier?: string | null
  workspace_projects_count?: number | null
  portfolio_items_count?: number | null
}

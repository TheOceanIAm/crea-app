-- Standalone: redefine profile_share_public (keep in sync with public_share_rpcs.sql).
-- Run after extend_profile_public_features.sql if columns open_to_remote etc. exist.

create or replace function public.profile_share_public(profile_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(t) from (
    select
      p.id,
      p.name,
      p.role,
      p.headline,
      p.location,
      p.bio,
      p.avatar_url,
      p.skills,
      p.equipment,
      p.portfolio_website,
      p.portfolio_instagram,
      p.portfolio_linkedin,
      p.portfolio_vimeo,
      p.portfolio_behance,
      p.portfolio_projects,
      p.public_profile_widgets,
      p.day_rate_amount,
      p.half_day_rate_amount,
      p.rates_currency,
      p.availability_calendar,
      p.availability_status,
      p.availability_details,
      coalesce(p.open_to_remote, false) as open_to_remote,
      coalesce(p.open_to_travel, false) as open_to_travel,
      p.years_experience,
      p.public_rating,
      (select count(*)::int from public.projects j where j.freelancer_id = p.id) as workspace_projects_count,
      coalesce(jsonb_array_length(coalesce(p.portfolio_projects, '[]'::jsonb)), 0) as portfolio_items_count
    from public.profiles p
    where p.id = profile_id
    limit 1
  ) t;
$$;

revoke all on function public.profile_share_public(uuid) from public;
grant execute on function public.profile_share_public(uuid) to anon, authenticated;

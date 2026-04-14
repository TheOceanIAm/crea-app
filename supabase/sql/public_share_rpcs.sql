-- Public share landing pages (web): safe read-only payloads for anon key.
-- Run in Supabase SQL Editor after crea_app_features.sql / profile migrations.
-- CEO public widgets: run extend_profile_public_widgets.sql before this if `public_profile_widgets` is missing.
-- App routes: /jobs/:id and /profile/:userId (Expo web or static export).

create or replace function public.job_share_public(job_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(t) from (
    select
      jo.id,
      jo.title,
      jo.category,
      jo.budget_type,
      jo.budget_amount,
      jo.location_type,
      jo.description,
      jo.status,
      jo.company_id,
      cp.name as company_name,
      cp.avatar_url as company_avatar_url
    from public.jobs jo
    left join public.profiles cp on cp.id = jo.company_id
    where jo.id = job_id
      and jo.status = 'active'
    limit 1
  ) t;
$$;

revoke all on function public.job_share_public(uuid) from public;
grant execute on function public.job_share_public(uuid) to anon, authenticated;

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
      p.availability_details
    from public.profiles p
    where p.id = profile_id
    limit 1
  ) t;
$$;

revoke all on function public.profile_share_public(uuid) from public;
grant execute on function public.profile_share_public(uuid) to anon, authenticated;

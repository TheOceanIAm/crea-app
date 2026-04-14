-- Adds day rates + availability to public profile payload (same data the web profile can show).
-- Run in Supabase SQL Editor after public_share_rpcs.sql and rate/availability migrations.

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

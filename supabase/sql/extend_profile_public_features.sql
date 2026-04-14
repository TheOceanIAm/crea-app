-- Public freelancer profile extras (web parity): travel/remote flags, stats, portfolio image URLs in JSON.
-- Run before public_share_rpcs.sql (or re-run profile_share_public from public_share_rpcs.sql after this).

alter table public.profiles add column if not exists open_to_remote boolean not null default false;
alter table public.profiles add column if not exists open_to_travel boolean not null default false;
alter table public.profiles add column if not exists years_experience numeric;
alter table public.profiles add column if not exists public_rating numeric;

comment on column public.profiles.open_to_remote is 'Public profile: open to remote work';
comment on column public.profiles.open_to_travel is 'Public profile: open to travel';
comment on column public.profiles.years_experience is 'Optional years of experience for public profile stats';
comment on column public.profiles.public_rating is 'Optional display rating (e.g. 0–5) for public profile';

comment on column public.profiles.portfolio_projects is
  'Array of { title, client, link, role?, image_url? }. image_url optional thumbnail for app/web.';

-- Supabase SQL Editor: run once (extends profile/settings columns like in the app).
-- Prerequisite: table public.profiles exists.

alter table public.profiles add column if not exists headline text;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists skills text[] default '{}';
alter table public.profiles add column if not exists equipment text[] default '{}';
alter table public.profiles add column if not exists avatar_url text;

comment on column public.profiles.headline is 'Job title / role shown under the name';
comment on column public.profiles.location is 'e.g. Berlin, Germany';
comment on column public.profiles.bio is 'Short public profile description';
comment on column public.profiles.skills is 'Skill tags for matching & profile';
comment on column public.profiles.equipment is 'Gear, licenses, certificates';
comment on column public.profiles.avatar_url is 'Public URL for profile photo';

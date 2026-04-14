-- Post-signup onboarding flag for the mobile app.
-- Run once in Supabase → SQL Editor.

alter table public.profiles
  add column if not exists onboarding_completed boolean;

-- Existing users: treat as already onboarded
update public.profiles
set onboarding_completed = true
where onboarding_completed is null;

alter table public.profiles
  alter column onboarding_completed set default false;

alter table public.profiles
  alter column onboarding_completed set not null;

comment on column public.profiles.onboarding_completed is
  'false until the user finishes in-app onboarding (role + display name). Existing rows backfilled to true.';

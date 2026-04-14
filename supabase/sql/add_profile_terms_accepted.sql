-- When the user accepted Terms & Privacy (set from app onboarding).
-- Run once in Supabase → SQL Editor.

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz;

comment on column public.profiles.terms_accepted_at is
  'ISO timestamp when the user accepted Terms & Privacy in the app (onboarding).';

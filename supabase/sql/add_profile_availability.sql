-- Supabase → SQL Editor → einmal ausführen.
-- Behebt u.a. "column ... does not exist" und legt das Kalender-Feld an.

alter table public.profiles
  add column if not exists availability_status text;

alter table public.profiles
  add column if not exists availability_details text;

alter table public.profiles
  add column if not exists availability_calendar jsonb;

comment on column public.profiles.availability_status is 'Optional / Legacy';
comment on column public.profiles.availability_details is 'Optional / Legacy';
comment on column public.profiles.availability_calendar is 'Freelancer: JSON { version:2, days: {"YYYY-MM-DD": off|available|booked}, notes? }';

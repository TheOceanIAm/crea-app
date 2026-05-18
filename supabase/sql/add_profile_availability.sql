-- Supabase → SQL Editor → run once.
-- Fixes missing-column errors and adds the calendar field.

alter table public.profiles
  add column if not exists availability_status text;

alter table public.profiles
  add column if not exists availability_details text;

alter table public.profiles
  add column if not exists availability_calendar jsonb;

comment on column public.profiles.availability_status is 'Optional / Legacy';
comment on column public.profiles.availability_details is 'Optional / Legacy';
comment on column public.profiles.availability_calendar is 'Freelancer: JSON v2 (default off) or v3 { version:3, defaultDay:available, days } with explicit off|booked; notes optional';

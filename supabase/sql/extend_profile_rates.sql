-- Adds rate columns used by Profile → Rates in the app.
-- Run in Supabase SQL Editor after extend_profile_identity.sql and extend_profile_settings_pages.sql.

alter table public.profiles add column if not exists day_rate_amount numeric;
alter table public.profiles add column if not exists half_day_rate_amount numeric;
alter table public.profiles add column if not exists rates_currency text default 'EUR';
alter table public.profiles add column if not exists rates_notes text;

comment on column public.profiles.day_rate_amount is 'Default day rate (numeric, same currency as rates_currency)';
comment on column public.profiles.half_day_rate_amount is 'Optional half-day rate';
comment on column public.profiles.rates_currency is 'ISO currency for rates';
comment on column public.profiles.rates_notes is 'Packages, buyouts, travel, etc.';

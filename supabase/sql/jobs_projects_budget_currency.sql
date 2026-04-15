-- Optional ISO 4217 currency for job/project budgets (default EUR).
-- Run in Supabase SQL Editor.

alter table public.jobs add column if not exists budget_currency text default 'EUR';
alter table public.projects add column if not exists budget_currency text default 'EUR';

comment on column public.jobs.budget_currency is 'ISO 4217 code for budget_amount (e.g. EUR, USD).';
comment on column public.projects.budget_currency is 'ISO 4217 code for budget_amount; copied from job when workspace is created.';

-- Annual budget fields used by Invoice budget overview.
alter table public.profiles add column if not exists annual_budget_amount numeric;
alter table public.profiles add column if not exists annual_budget_currency text default 'EUR';
alter table public.profiles add column if not exists annual_budget_year integer;

comment on column public.profiles.annual_budget_amount is 'Optional yearly budget amount set in profile settings.';
comment on column public.profiles.annual_budget_currency is 'ISO 4217 currency code for annual_budget_amount.';
comment on column public.profiles.annual_budget_year is 'Calendar year that annual budget applies to.';

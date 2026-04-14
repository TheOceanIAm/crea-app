-- Optional: timestamps on invoices for CEO "this month" paid revenue.
-- Run if public.invoices has no created_at yet.

alter table public.invoices add column if not exists created_at timestamptz default now();
alter table public.invoices add column if not exists updated_at timestamptz default now();

comment on column public.invoices.created_at is 'Set automatically; used for period revenue in ceo_revenue_snapshot.';

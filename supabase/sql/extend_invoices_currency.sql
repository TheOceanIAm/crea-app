-- Optional: ISO currency on invoices (CEO revenue + detail screens use it when present).
alter table public.invoices add column if not exists currency text default 'EUR';

comment on column public.invoices.currency is 'ISO 4217 code; CEO RPCs default to EUR if column is missing.';

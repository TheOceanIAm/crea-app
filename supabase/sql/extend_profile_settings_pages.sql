-- Ergänzt Portfolio, Rechnung/Bank, Benachrichtigungen (JSON), Abo-Kennzeichnung.
-- Nach extend_profile_identity.sql ausführen.

-- Portfolio & Links
alter table public.profiles add column if not exists portfolio_website text;
alter table public.profiles add column if not exists portfolio_instagram text;
alter table public.profiles add column if not exists portfolio_linkedin text;
alter table public.profiles add column if not exists portfolio_vimeo text;
alter table public.profiles add column if not exists portfolio_behance text;
alter table public.profiles add column if not exists portfolio_projects jsonb default '[]'::jsonb;

-- Rechnung / Bank (PDF-Vorlagen)
alter table public.profiles add column if not exists bank_account_holder text;
alter table public.profiles add column if not exists bank_iban text;
alter table public.profiles add column if not exists bank_bic text;
alter table public.profiles add column if not exists paypal_email text;
alter table public.profiles add column if not exists invoice_address text;
alter table public.profiles add column if not exists tax_number text;
alter table public.profiles add column if not exists vat_registered boolean default false;

-- E-Mail-Benachrichtigungen & Digest (App liest/schreibt JSON)
alter table public.profiles add column if not exists notification_settings jsonb default '{}'::jsonb;

-- Anzeige aktueller Plan (Stripe-Anbindung später)
alter table public.profiles add column if not exists subscription_tier text default 'starter';

comment on column public.profiles.portfolio_projects is 'Array {title, client, link}';
comment on column public.profiles.notification_settings is '{ emailJobMatch, emailMessage, emailInvoicePaid, digest: none|daily|weekly }';

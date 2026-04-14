-- Subscription revenue for CEO dashboard (Stripe / manual bookkeeping).
-- Run in Supabase SQL Editor after profiles exist. CEOs read via ceo_subscription_revenue_snapshot.

create table if not exists public.subscription_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  booked_at timestamptz not null default now(),
  audience text not null check (audience in ('freelancer', 'company')),
  tier text not null default 'starter',
  amount_gross numeric(14, 2) not null check (amount_gross >= 0),
  amount_net numeric(14, 2) not null check (amount_net >= 0 and amount_net <= amount_gross),
  currency text not null default 'EUR',
  profile_id uuid references public.profiles (id) on delete set null,
  external_ref text,
  note text,
  source text not null default 'manual'
);

create index if not exists subscription_revenue_booked_at_idx on public.subscription_revenue_entries (booked_at desc);
create index if not exists subscription_revenue_audience_tier_idx on public.subscription_revenue_entries (audience, tier);

alter table public.subscription_revenue_entries enable row level security;

-- Intentionally no SELECT/INSERT policies for authenticated users: use service role or SQL for writes;
-- CEOs aggregate via security definer RPC ceo_subscription_revenue_snapshot (in ceo_admin_rpcs.sql).

comment on table public.subscription_revenue_entries is 'Recorded subscription income; gross vs net (VAT = gross - net). audience + tier match profiles.role and profiles.subscription_tier.';

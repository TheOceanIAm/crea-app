-- Pro/Premium freelancers: save Talent pool profiles as favorites (filter in app).
-- Run in Supabase SQL Editor as postgres.

create table if not exists public.talent_pool_favorites (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  favorite_profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, favorite_profile_id),
  constraint talent_pool_favorites_no_self check (owner_id <> favorite_profile_id)
);

create index if not exists talent_pool_favorites_owner_idx on public.talent_pool_favorites (owner_id);

alter table public.talent_pool_favorites enable row level security;

drop policy if exists "talent_pool_favorites_select_own" on public.talent_pool_favorites;
create policy "talent_pool_favorites_select_own"
  on public.talent_pool_favorites
  for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "talent_pool_favorites_insert_own" on public.talent_pool_favorites;
create policy "talent_pool_favorites_insert_own"
  on public.talent_pool_favorites
  for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "talent_pool_favorites_delete_own" on public.talent_pool_favorites;
create policy "talent_pool_favorites_delete_own"
  on public.talent_pool_favorites
  for delete
  to authenticated
  using (owner_id = auth.uid());

comment on table public.talent_pool_favorites is 'Talent pool stars for Pro/Premium freelancers; one row per owner+favorite profile.';

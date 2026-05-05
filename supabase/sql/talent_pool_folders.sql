-- Talent Pool folders (cross-device sync for app favorites folders).
-- Run in Supabase SQL Editor as postgres.

create table if not exists public.talent_pool_folders (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  id text not null,
  name text not null check (char_length(trim(name)) > 0 and char_length(name) <= 80),
  position integer not null default 0,
  profile_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists talent_pool_folders_owner_position_idx
  on public.talent_pool_folders (owner_id, position);

alter table public.talent_pool_folders enable row level security;

drop policy if exists "talent_pool_folders_select_own" on public.talent_pool_folders;
create policy "talent_pool_folders_select_own"
  on public.talent_pool_folders
  for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "talent_pool_folders_insert_own" on public.talent_pool_folders;
create policy "talent_pool_folders_insert_own"
  on public.talent_pool_folders
  for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "talent_pool_folders_update_own" on public.talent_pool_folders;
create policy "talent_pool_folders_update_own"
  on public.talent_pool_folders
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "talent_pool_folders_delete_own" on public.talent_pool_folders;
create policy "talent_pool_folders_delete_own"
  on public.talent_pool_folders
  for delete
  to authenticated
  using (owner_id = auth.uid());

comment on table public.talent_pool_folders is
  'Talent pool folder definitions for app users (owner-scoped), synced across devices.';

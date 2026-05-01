-- Per-user archive state for direct conversations.
-- Safe to re-run.

create table if not exists public.conversation_archives (
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id text not null,
  archived boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists conversation_archives_user_idx on public.conversation_archives (user_id, archived);
create index if not exists conversation_archives_conversation_idx on public.conversation_archives (conversation_id);

alter table public.conversation_archives enable row level security;

drop policy if exists "conversation_archives_select_own" on public.conversation_archives;
create policy "conversation_archives_select_own" on public.conversation_archives
  for select using (auth.uid() = user_id);

drop policy if exists "conversation_archives_insert_own" on public.conversation_archives;
create policy "conversation_archives_insert_own" on public.conversation_archives
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id::text = conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  );

drop policy if exists "conversation_archives_update_own" on public.conversation_archives;
create policy "conversation_archives_update_own" on public.conversation_archives
  for update using (auth.uid() = user_id);

drop policy if exists "conversation_archives_delete_own" on public.conversation_archives;
create policy "conversation_archives_delete_own" on public.conversation_archives
  for delete using (auth.uid() = user_id);

create or replace function public.conversation_archives_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_conversation_archives_set_updated_at on public.conversation_archives;
create trigger trg_conversation_archives_set_updated_at
  before update on public.conversation_archives
  for each row
  execute function public.conversation_archives_set_updated_at();


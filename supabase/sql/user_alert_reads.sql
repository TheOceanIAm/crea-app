-- Per-user read state for in-app alert rows (not DMs; those use messages.read).

create table if not exists public.user_alert_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  alert_key text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, alert_key)
);

create index if not exists user_alert_reads_user_idx on public.user_alert_reads (user_id, read_at desc);

alter table public.user_alert_reads enable row level security;

drop policy if exists "user_alert_reads_select_own" on public.user_alert_reads;
create policy "user_alert_reads_select_own" on public.user_alert_reads
  for select using (auth.uid() = user_id);

drop policy if exists "user_alert_reads_insert_own" on public.user_alert_reads;
create policy "user_alert_reads_insert_own" on public.user_alert_reads
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_alert_reads_update_own" on public.user_alert_reads;
create policy "user_alert_reads_update_own" on public.user_alert_reads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.user_alert_reads is 'Maps user to alert_key (feed row id) when marked read in Alerts tab.';

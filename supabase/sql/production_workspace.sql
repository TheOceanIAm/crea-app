-- Production workspace: milestone types (visibility), shot list, production days (call sheet + wrap).
-- Run after project_workspace_native.sql (requires public.user_in_project).

alter table public.project_milestones
  add column if not exists milestone_type text;

comment on column public.project_milestones.milestone_type is
  'Optional. Values shoot_day or production_day unlock the Production tab when project status is in_progress.';

-- Shot list (shoot_date scopes "today" progress; required for daily shot counts)
create table if not exists public.production_shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  shoot_date date not null,
  scene_nr text not null default '',
  description text not null default '',
  lens text not null default '',
  location text not null default '',
  framing text not null default '',
  audio_notes text not null default '',
  brief_ai_synced boolean not null default false,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_shots_status_chk check (status in ('open', 'rolling', 'done', 'pick'))
);

create index if not exists production_shots_project_date_idx on public.production_shots (project_id, shoot_date);

alter table public.production_shots enable row level security;

drop policy if exists "production_shots_select" on public.production_shots;
create policy "production_shots_select" on public.production_shots
  for select using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shots_insert" on public.production_shots;
create policy "production_shots_insert" on public.production_shots
  for insert with check (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shots_update" on public.production_shots;
create policy "production_shots_update" on public.production_shots
  for update using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shots_delete" on public.production_shots;
create policy "production_shots_delete" on public.production_shots
  for delete using (public.user_in_project(project_id, auth.uid()));

-- One row per calendar day: notes, wrap, per-crew call overrides (JSON: profile_id -> { call_time, location })
create table if not exists public.production_days (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  wrap_time text,
  notes text,
  call_sheet jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, date)
);

create index if not exists production_days_project_id_idx on public.production_days (project_id);

alter table public.production_days enable row level security;

drop policy if exists "production_days_select" on public.production_days;
create policy "production_days_select" on public.production_days
  for select using (public.user_in_project(project_id, auth.uid()));

-- Company owner (projects.company_id) creates shoot days; all members may update rows (notes, call sheet).
drop policy if exists "production_days_insert" on public.production_days;
create policy "production_days_insert" on public.production_days
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.company_id = auth.uid()
    )
  );

drop policy if exists "production_days_update" on public.production_days;
create policy "production_days_update" on public.production_days
  for update using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_days_delete" on public.production_days;
create policy "production_days_delete" on public.production_days
  for delete using (public.user_in_project(project_id, auth.uid()));

create or replace function public.production_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_production_shots_updated on public.production_shots;
create trigger trg_production_shots_updated
  before update on public.production_shots
  for each row execute function public.production_set_updated_at();

drop trigger if exists trg_production_days_updated on public.production_days;
create trigger trg_production_days_updated
  before update on public.production_days
  for each row execute function public.production_set_updated_at();

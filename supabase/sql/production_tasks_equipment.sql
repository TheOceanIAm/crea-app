-- Manual production tasks + equipment lists (replaces Brief AI generated tasks/gear).
-- RLS: any project member can read/write (same as production_shots).

create table if not exists public.production_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default '',
  notes text not null default '',
  done boolean not null default false,
  assignee_name text not null default '',
  assignee_profile_id uuid references public.profiles (id) on delete set null,
  assignee_manual_crew_id uuid references public.project_manual_crew (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists production_tasks_project_pos_idx
  on public.production_tasks (project_id, position, created_at);

alter table public.production_tasks enable row level security;

drop policy if exists "production_tasks_select" on public.production_tasks;
create policy "production_tasks_select" on public.production_tasks
  for select using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_tasks_insert" on public.production_tasks;
create policy "production_tasks_insert" on public.production_tasks
  for insert with check (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_tasks_update" on public.production_tasks;
create policy "production_tasks_update" on public.production_tasks
  for update using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_tasks_delete" on public.production_tasks;
create policy "production_tasks_delete" on public.production_tasks
  for delete using (public.user_in_project(project_id, auth.uid()));

create table if not exists public.production_equipment (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null default '',
  qty text not null default '',
  notes text not null default '',
  unit_price numeric,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists production_equipment_project_pos_idx
  on public.production_equipment (project_id, position, created_at);

alter table public.production_equipment enable row level security;

drop policy if exists "production_equipment_select" on public.production_equipment;
create policy "production_equipment_select" on public.production_equipment
  for select using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_equipment_insert" on public.production_equipment;
create policy "production_equipment_insert" on public.production_equipment
  for insert with check (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_equipment_update" on public.production_equipment;
create policy "production_equipment_update" on public.production_equipment
  for update using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_equipment_delete" on public.production_equipment;
create policy "production_equipment_delete" on public.production_equipment
  for delete using (public.user_in_project(project_id, auth.uid()));

drop trigger if exists trg_production_tasks_updated on public.production_tasks;
create trigger trg_production_tasks_updated
  before update on public.production_tasks
  for each row execute function public.production_set_updated_at();

drop trigger if exists trg_production_equipment_updated on public.production_equipment;
create trigger trg_production_equipment_updated
  before update on public.production_equipment
  for each row execute function public.production_set_updated_at();

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    begin
      alter publication supabase_realtime add table public.production_tasks;
    exception
      when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.production_equipment;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

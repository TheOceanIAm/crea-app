-- Workspace-only manual crew entries (no existing CREA account required).
-- Run after project_workspace_native.sql (requires public.user_in_project).

create table if not exists public.project_manual_crew (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  member_role text not null default 'crew',
  email text,
  phone text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_manual_crew_project_idx on public.project_manual_crew (project_id, created_at);

alter table public.project_manual_crew enable row level security;

drop policy if exists "project_manual_crew_select" on public.project_manual_crew;
create policy "project_manual_crew_select" on public.project_manual_crew
  for select using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "project_manual_crew_insert" on public.project_manual_crew;
create policy "project_manual_crew_insert" on public.project_manual_crew
  for insert with check (public.user_in_project(project_id, auth.uid()) and created_by = auth.uid());

drop policy if exists "project_manual_crew_update" on public.project_manual_crew;
create policy "project_manual_crew_update" on public.project_manual_crew
  for update using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "project_manual_crew_delete" on public.project_manual_crew;
create policy "project_manual_crew_delete" on public.project_manual_crew
  for delete using (public.user_in_project(project_id, auth.uid()));

create or replace function public.project_manual_crew_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_project_manual_crew_updated on public.project_manual_crew;
create trigger trg_project_manual_crew_updated
before update on public.project_manual_crew
for each row execute function public.project_manual_crew_set_updated_at();


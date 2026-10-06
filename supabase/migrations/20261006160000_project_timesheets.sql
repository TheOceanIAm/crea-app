-- Optional crew hours per project day. Company accounts read every row.
-- A freelancer reads and writes only their own row. Budget math stays client-side.

create table if not exists public.project_timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  work_date date not null,
  hours numeric(4,2) not null check (hours > 0 and hours <= 24),
  profile_id uuid references public.profiles (id) on delete cascade,
  manual_crew_id uuid references public.project_manual_crew (id) on delete cascade,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint project_timesheet_one_subject check (
    (profile_id is not null and manual_crew_id is null)
    or (profile_id is null and manual_crew_id is not null)
  )
);

create unique index if not exists project_timesheet_profile_day
  on public.project_timesheet_entries (project_id, profile_id, work_date)
  where profile_id is not null;

create unique index if not exists project_timesheet_manual_day
  on public.project_timesheet_entries (project_id, manual_crew_id, work_date)
  where manual_crew_id is not null;

create index if not exists project_timesheet_project_idx
  on public.project_timesheet_entries (project_id, work_date);

comment on table public.project_timesheet_entries is
  'Optional hours worked on a project day. Company sees all rows; a freelancer sees only their own.';

create or replace function public.crea_timesheet_company_can_manage(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    left join public.jobs j on j.id = coalesce(p.job_id, p.id)
    where p.id = p_project_id
      and (
        public.auth_user_can_access_company(p.company_id)
        or public.auth_user_can_access_company(j.company_id)
      )
  );
$$;

revoke all on function public.crea_timesheet_company_can_manage(uuid) from public;
grant execute on function public.crea_timesheet_company_can_manage(uuid) to authenticated;

alter table public.project_timesheet_entries enable row level security;

drop policy if exists "project_timesheet_select" on public.project_timesheet_entries;
create policy "project_timesheet_select"
  on public.project_timesheet_entries
  for select to authenticated
  using (
    public.crea_timesheet_company_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and public.user_in_project(project_id, auth.uid())
    )
  );

drop policy if exists "project_timesheet_insert" on public.project_timesheet_entries;
create policy "project_timesheet_insert"
  on public.project_timesheet_entries
  for insert to authenticated
  with check (
    public.crea_timesheet_company_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and manual_crew_id is null
      and public.user_in_project(project_id, auth.uid())
    )
  );

drop policy if exists "project_timesheet_update" on public.project_timesheet_entries;
create policy "project_timesheet_update"
  on public.project_timesheet_entries
  for update to authenticated
  using (
    public.crea_timesheet_company_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and public.user_in_project(project_id, auth.uid())
    )
  )
  with check (
    public.crea_timesheet_company_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and manual_crew_id is null
      and public.user_in_project(project_id, auth.uid())
    )
  );

drop policy if exists "project_timesheet_delete" on public.project_timesheet_entries;
create policy "project_timesheet_delete"
  on public.project_timesheet_entries
  for delete to authenticated
  using (
    public.crea_timesheet_company_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and public.user_in_project(project_id, auth.uid())
    )
  );

grant select, insert, update, delete on public.project_timesheet_entries to authenticated;

notify pgrst, 'reload schema';

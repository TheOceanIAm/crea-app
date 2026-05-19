-- CEO may open and edit any project workspace (RLS) for QA / support.
-- Run after: ceo_admin_rpcs.sql (_ceo_is_caller), project_workspace_native.sql (user_in_project, projects policies).
-- For Production tab SQL (production_days), run production_workspace.sql once before this file.

-- ---------------------------------------------------------------------------
-- user_in_project: treat authenticated CEO like a member for any project
-- ---------------------------------------------------------------------------
create or replace function public.user_in_project(p_project_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (public._ceo_is_caller() and p_user = auth.uid())
    or exists (
      select 1 from public.project_members m
      where m.project_id = p_project_id and m.profile_id = p_user
    )
    or exists (
      select 1 from public.projects p
      where p.id = p_project_id
        and (p.company_id = p_user or p.freelancer_id = p_user)
    )
    or exists (
      select 1
      from public.projects p
      inner join public.jobs j on j.id = coalesce(p.job_id, p.id)
      where p.id = p_project_id
        and j.company_id = p_user
    )
    or exists (
      select 1
      from public.projects p
      inner join public.job_applications ja on ja.job_id = coalesce(p.job_id, p.id)
      where p.id = p_project_id
        and ja.freelancer_id = p_user
        and ja.status = 'accepted'
    );
$$;

grant execute on function public.user_in_project(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- projects: CEO can update rows (e.g. schedule fields) without being company/freelancer
-- ---------------------------------------------------------------------------
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update using (
    public._ceo_is_caller()
    or auth.uid() = company_id
    or auth.uid() = freelancer_id
  )
  with check (
    public._ceo_is_caller()
    or auth.uid() = company_id
    or auth.uid() = freelancer_id
  );

-- ---------------------------------------------------------------------------
-- production_days: CEO can create a day for call-sheet QA (requires production_workspace.sql)
-- ---------------------------------------------------------------------------
drop policy if exists "production_days_insert" on public.production_days;
create policy "production_days_insert" on public.production_days
  for insert with check (
    public._ceo_is_caller()
    or exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.company_id = auth.uid()
    )
  );

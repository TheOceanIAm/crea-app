-- Keep in sync with crea-services/supabase/migrations/20260907180000_milestones_company_team_edit.sql
-- Company-account team (owner + every active company_members row) can manage
-- workspace milestones. Freelancers keep read access only.

create or replace function public.crea_rls_job_company_team_can_manage_milestones(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and public.auth_user_can_access_company(j.company_id)
  );
$$;

comment on function public.crea_rls_job_company_team_can_manage_milestones(uuid) is
  'True if the current user is the job company owner or an active company_members seat on that company.';

revoke all on function public.crea_rls_job_company_team_can_manage_milestones(uuid) from public;
grant execute on function public.crea_rls_job_company_team_can_manage_milestones(uuid) to authenticated;

create or replace function public.crea_current_user_workspace_job_access(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.crea_rls_job_company_is_owner(p_job_id)
    or public.crea_rls_job_company_team_can_manage_milestones(p_job_id)
    or public.crea_current_user_accepted_on_job(p_job_id)
    or exists (
      select 1
      from public.projects p
      where p.job_id = p_job_id
        and (p.freelancer_id = auth.uid() or p.company_id = auth.uid())
    )
    or exists (
      select 1
      from public.projects p
      inner join public.project_members pm on pm.project_id = p.id
      where p.job_id = p_job_id
        and pm.profile_id = auth.uid()
    );
$$;

drop policy if exists "milestones_insert_company" on public.milestones;
create policy "milestones_insert_company"
  on public.milestones for insert to authenticated
  with check (public.crea_rls_job_company_team_can_manage_milestones(job_id));

drop policy if exists "milestones_update_workspace" on public.milestones;
drop policy if exists "milestones_update_company_team" on public.milestones;
create policy "milestones_update_company_team"
  on public.milestones for update to authenticated
  using (public.crea_rls_job_company_team_can_manage_milestones(job_id))
  with check (public.crea_rls_job_company_team_can_manage_milestones(job_id));

drop policy if exists "milestones_delete_company" on public.milestones;
create policy "milestones_delete_company"
  on public.milestones for delete to authenticated
  using (public.crea_rls_job_company_team_can_manage_milestones(job_id));

notify pgrst, 'reload schema';

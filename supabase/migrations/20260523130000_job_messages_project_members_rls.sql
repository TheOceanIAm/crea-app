-- Crew on project_members (and project lead) can read/write job_messages for linked jobs.
create or replace function public.crea_current_user_workspace_job_access(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.crea_rls_job_company_is_owner(p_job_id)
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

grant execute on function public.crea_current_user_workspace_job_access(uuid) to authenticated;

drop policy if exists "job_messages_select_workspace" on public.job_messages;
create policy "job_messages_select_workspace"
  on public.job_messages for select to authenticated
  using (public.crea_current_user_workspace_job_access(job_id));

drop policy if exists "job_messages_insert_workspace" on public.job_messages;
create policy "job_messages_insert_workspace"
  on public.job_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.crea_current_user_workspace_job_access(job_id)
  );

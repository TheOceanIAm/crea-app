-- Freelancer private workspaces: allow hard-delete on jobs + remove mirrored projects row.

do $d$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'jobs' and policyname = 'jobs_delete_solo_workspace_owner'
  ) then
    create policy "jobs_delete_solo_workspace_owner" on public.jobs
      for delete to authenticated
      using (company_id = (select auth.uid()) and coalesce(is_solo_workspace, false) = true);
  end if;
end
$d$;

comment on policy "jobs_delete_solo_workspace_owner" on public.jobs is
  'Owner may delete own is_solo_workspace project rows (app UI: My Projects / workspace).';

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete to authenticated
  using (auth.uid() = company_id or auth.uid() = freelancer_id);

comment on policy "projects_delete" on public.projects is
  'Lead/company owner or assigned freelancer may delete their project row (private workspace cleanup).';

create or replace function public.trg_jobs_delete_solo_workspace_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.is_solo_workspace, false) then
    delete from public.projects
    where id = old.id or job_id = old.id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_jobs_delete_solo_workspace_project on public.jobs;
create trigger trg_jobs_delete_solo_workspace_project
  after delete on public.jobs
  for each row
  execute function public.trg_jobs_delete_solo_workspace_project();

comment on function public.trg_jobs_delete_solo_workspace_project() is
  'When a solo workspace job is deleted, remove the mirrored public.projects row (native app list).';

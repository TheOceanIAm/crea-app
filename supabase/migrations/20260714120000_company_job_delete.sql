-- Keep in sync with crea-services/supabase/migrations/20260714120000_company_job_delete.sql
-- Company marketplace jobs: allow hard-delete (owner or company writer) + remove mirrored projects row.
-- Solo/private workspaces keep their own delete path (jobs_delete_solo_workspace_owner).

-- ---------------------------------------------------------------------------
-- RLS: owner (or company team admin/manager) may delete own non-solo jobs
-- ---------------------------------------------------------------------------
drop policy if exists "jobs_delete_company_listing" on public.jobs;
create policy "jobs_delete_company_listing" on public.jobs
  for delete to authenticated
  using (
    coalesce(is_solo_workspace, false) = false
    and (
      company_id = (select auth.uid())
      or public.auth_user_can_write_company(company_id)
    )
  );

comment on policy "jobs_delete_company_listing" on public.jobs is
  'Company owner or team admin/manager may hard-delete own marketplace (non-solo) job listings.';

-- ---------------------------------------------------------------------------
-- Generalize the delete trigger: remove the mirrored public.projects row for ANY job delete
-- (solo + marketplace). projects mirrors jobs 1:1 (projects.id == jobs.id).
-- ---------------------------------------------------------------------------
create or replace function public.trg_jobs_delete_solo_workspace_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.projects
  where id = old.id or job_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_jobs_delete_solo_workspace_project on public.jobs;
create trigger trg_jobs_delete_solo_workspace_project
  after delete on public.jobs
  for each row
  execute function public.trg_jobs_delete_solo_workspace_project();

comment on function public.trg_jobs_delete_solo_workspace_project() is
  'When a job is deleted (solo or marketplace), remove the mirrored public.projects row (native app list).';

-- ---------------------------------------------------------------------------
-- Reliable delete for marketplace listings (mirrors close_company_job_listing).
-- Bypasses flaky client-side RLS deletes; child rows cascade via FKs.
-- ---------------------------------------------------------------------------
create or replace function public.delete_company_job_listing(p_job_id uuid)
returns table (
  id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs%ROWTYPE;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into j
  from public.jobs
  where jobs.id = p_job_id
  for update;

  if not found then
    raise exception 'job not found';
  end if;

  if coalesce(j.is_solo_workspace, false) then
    raise exception 'use workspace delete for solo projects';
  end if;

  if j.company_id is distinct from auth.uid()
     and not public.auth_user_can_write_company(j.company_id) then
    raise exception 'forbidden';
  end if;

  delete from public.jobs
  where jobs.id = p_job_id;

  return query select p_job_id as id;
end;
$$;

revoke all on function public.delete_company_job_listing(uuid) from public;
grant execute on function public.delete_company_job_listing(uuid) to authenticated;

comment on function public.delete_company_job_listing(uuid) is
  'Company hard-deletes a marketplace job listing (jobs row + cascaded child rows + mirrored project).';

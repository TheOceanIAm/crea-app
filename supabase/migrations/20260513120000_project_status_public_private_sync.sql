-- Private / solo workspace: projects.status ↔ jobs.project_status (app native row stays aligned).
-- Public marketplace jobs: phase lives on jobs.project_status (company-only on web); mirror into projects
-- when present so the app shows the same state. Projects→jobs sync only for solo — freelancers cannot
-- push phase onto public jobs via the projects row.

-- ---------------------------------------------------------------------------
-- 1) projects → jobs: only solo/private workspace (same poster owns job + projects row)
-- ---------------------------------------------------------------------------
create or replace function public.trg_projects_status_sync_job_project_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.job_id is null then
    return new;
  end if;
  if old.status is not distinct from new.status then
    return new;
  end if;

  update public.jobs j
  set project_status = new.status::text
  where j.id = new.job_id
    and coalesce(j.is_solo_workspace, false) = true
    and coalesce(j.project_status, '') is distinct from coalesce(new.status::text, '');

  return new;
end;
$$;

comment on function public.trg_projects_status_sync_job_project_status() is
  'Solo/private workspace only: projects.status → jobs.project_status. Public job phase is edited on jobs (company).';

-- ---------------------------------------------------------------------------
-- 2) jobs → projects: public / non-solo jobs — mirror company edits from web into projects row
--    (solo jobs already handled by trg_jobs_sync_solo_workspace_project)
-- ---------------------------------------------------------------------------
create or replace function public.trg_jobs_mirror_project_status_to_projects_non_solo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ps text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if coalesce(new.is_solo_workspace, false) then
    return new;
  end if;
  if old.project_status is not distinct from new.project_status then
    return new;
  end if;

  ps := coalesce(nullif(trim(new.project_status::text), ''), 'active');

  update public.projects p
  set
    status = ps,
    updated_at = now()
  where (p.job_id = new.id or p.id = new.id)
    and p.status is distinct from ps;

  return new;
end;
$$;

drop trigger if exists trg_jobs_mirror_project_status_non_solo on public.jobs;
create trigger trg_jobs_mirror_project_status_non_solo
  after update of project_status on public.jobs
  for each row
  execute function public.trg_jobs_mirror_project_status_to_projects_non_solo();

comment on function public.trg_jobs_mirror_project_status_to_projects_non_solo() is
  'Non–solo jobs: copy jobs.project_status into projects.status when a native projects row exists (web ↔ app display).';

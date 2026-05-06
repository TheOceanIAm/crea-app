-- Web stores workspace phase in jobs.project_status (recruiting | active | completed).
-- Native app reads public.projects.status — keep them aligned for solo/workspace jobs.

-- ---------------------------------------------------------------------------
-- Jobs → projects: mirror project_status into projects.status
-- ---------------------------------------------------------------------------
create or replace function public.trg_jobs_sync_solo_workspace_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ps text;
begin
  ps := coalesce(nullif(trim(new.project_status::text), ''), 'active');

  if tg_op = 'INSERT' then
    if coalesce(new.is_solo_workspace, false) then
      insert into public.projects (
        id,
        job_id,
        company_id,
        freelancer_id,
        title,
        status,
        budget_type,
        budget_amount,
        budget_currency,
        location
      )
      values (
        new.id,
        new.id,
        new.company_id,
        new.company_id,
        coalesce(nullif(trim(new.title), ''), 'Untitled project'),
        ps,
        new.budget_type,
        new.budget_amount,
        coalesce(nullif(trim(new.budget_currency), ''), 'EUR'),
        new.location
      )
      on conflict (id) do nothing;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(new.is_solo_workspace, false)
       and not coalesce(old.is_solo_workspace, false) then
      insert into public.projects (
        id,
        job_id,
        company_id,
        freelancer_id,
        title,
        status,
        budget_type,
        budget_amount,
        budget_currency,
        location
      )
      values (
        new.id,
        new.id,
        new.company_id,
        new.company_id,
        coalesce(nullif(trim(new.title), ''), 'Untitled project'),
        ps,
        new.budget_type,
        new.budget_amount,
        coalesce(nullif(trim(new.budget_currency), ''), 'EUR'),
        new.location
      )
      on conflict (id) do nothing;
    elsif coalesce(new.is_solo_workspace, false) then
      update public.projects p
      set
        title = coalesce(nullif(trim(new.title), ''), 'Untitled project'),
        location = new.location,
        budget_type = new.budget_type,
        budget_amount = new.budget_amount,
        budget_currency = coalesce(nullif(trim(new.budget_currency), ''), 'EUR'),
        status = ps,
        updated_at = now()
      where id = new.id or job_id = new.id;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_jobs_sync_solo_workspace_project on public.jobs;
create trigger trg_jobs_sync_solo_workspace_project
  after insert or update of is_solo_workspace, title, location, budget_type, budget_amount, budget_currency, project_status on public.jobs
  for each row
  execute function public.trg_jobs_sync_solo_workspace_project();

comment on function public.trg_jobs_sync_solo_workspace_project() is
  'Keeps public.projects in sync with solo workspace jobs (budget, title, location, project_status → status).';

-- ---------------------------------------------------------------------------
-- Projects → jobs: owner edits from native app update projects.status
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
    and coalesce(j.project_status, '') is distinct from coalesce(new.status::text, '');

  return new;
end;
$$;

drop trigger if exists trg_projects_status_sync_job on public.projects;
create trigger trg_projects_status_sync_job
  after update of status on public.projects
  for each row
  execute function public.trg_projects_status_sync_job_project_status();

comment on function public.trg_projects_status_sync_job_project_status() is
  'When projects.status changes and job_id is set, mirror into jobs.project_status (web workspace status).';

-- ---------------------------------------------------------------------------
-- ensure RPC: copy project_status into projects.status
-- ---------------------------------------------------------------------------
create or replace function public.ensure_solo_workspace_project_for_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs%ROWTYPE;
  ps text;
begin
  if auth.uid() is null then
    return null;
  end if;

  select * into j from public.jobs where id = p_job_id;
  if not found then
    return null;
  end if;

  if not coalesce(j.is_solo_workspace, false) or j.company_id is distinct from auth.uid() then
    return null;
  end if;

  ps := coalesce(nullif(trim(j.project_status::text), ''), 'active');

  if exists (select 1 from public.projects p where p.id = p_job_id) then
    update public.projects p
    set
      title = coalesce(nullif(trim(j.title), ''), p.title),
      budget_type = j.budget_type,
      budget_amount = j.budget_amount,
      budget_currency = coalesce(nullif(trim(j.budget_currency), ''), 'EUR'),
      location = coalesce(j.location, p.location),
      status = ps,
      updated_at = now()
    where p.id = p_job_id;
    return p_job_id;
  end if;

  insert into public.projects (
    id,
    job_id,
    company_id,
    freelancer_id,
    title,
    status,
    budget_type,
    budget_amount,
    budget_currency,
    location
  )
  values (
    j.id,
    j.id,
    j.company_id,
    j.company_id,
    coalesce(nullif(trim(j.title), ''), 'Untitled project'),
    ps,
    j.budget_type,
    j.budget_amount,
    coalesce(nullif(trim(j.budget_currency), ''), 'EUR'),
    coalesce(nullif(trim(j.location), ''), 'Remote')
  )
  on conflict (id) do nothing;

  return p_job_id;
end;
$$;

comment on function public.ensure_solo_workspace_project_for_job(uuid) is
  'Creates/updates projects row for caller-owned solo workspace job; mirrors jobs.project_status → projects.status.';

-- ---------------------------------------------------------------------------
-- Backfill: align projects.status from jobs.project_status
-- ---------------------------------------------------------------------------
update public.projects p
set
  status = coalesce(nullif(trim(j.project_status::text), ''), p.status),
  updated_at = now()
from public.jobs j
where j.id = p.job_id
  and coalesce(j.is_solo_workspace, false)
  and coalesce(nullif(trim(j.project_status::text), ''), '') <> ''
  and p.status is distinct from coalesce(nullif(trim(j.project_status::text), ''), p.status);

-- ---------------------------------------------------------------------------
-- Batch RPC: seed status from jobs.project_status when inserting missing rows
-- ---------------------------------------------------------------------------
create or replace function public.sync_solo_workspace_projects_for_owner()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;

  insert into public.projects (
    id,
    job_id,
    company_id,
    freelancer_id,
    title,
    status,
    budget_type,
    budget_amount,
    budget_currency,
    location
  )
  select
    j.id,
    j.id,
    j.company_id,
    j.company_id,
    coalesce(nullif(trim(j.title), ''), 'Untitled project'),
    coalesce(nullif(trim(j.project_status::text), ''), 'active'),
    j.budget_type,
    j.budget_amount,
    coalesce(nullif(trim(j.budget_currency), ''), 'EUR'),
    j.location
  from public.jobs j
  where j.company_id = auth.uid()
    and coalesce(j.is_solo_workspace, false)
    and not exists (
      select 1
      from public.projects p
      where p.id = j.id or p.job_id = j.id
    )
  on conflict (id) do nothing;

  get diagnostics inserted_count = ROW_COUNT;
  return inserted_count;
end;
$$;

comment on function public.sync_solo_workspace_projects_for_owner() is
  'Creates missing public.projects rows for the caller’s solo workspace jobs (budget + project_status).';

revoke all on function public.sync_solo_workspace_projects_for_owner() from public;
grant execute on function public.sync_solo_workspace_projects_for_owner() to authenticated;

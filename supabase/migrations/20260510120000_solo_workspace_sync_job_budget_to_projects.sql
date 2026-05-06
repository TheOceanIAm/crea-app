-- Solo workspace jobs carry budget on `jobs`; `projects` rows must mirror them for the native workspace UI.

alter table public.jobs add column if not exists budget_currency text default 'EUR';
alter table public.projects add column if not exists budget_currency text default 'EUR';

-- ---------------------------------------------------------------------------
-- Trigger: copy budget_amount + budget_currency (and keep title/type/location in sync)
-- ---------------------------------------------------------------------------
create or replace function public.trg_jobs_sync_solo_workspace_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
        'active',
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
        'active',
        new.budget_type,
        new.budget_amount,
        coalesce(nullif(trim(new.budget_currency), ''), 'EUR'),
        new.location
      )
      on conflict (id) do nothing;
    elsif coalesce(new.is_solo_workspace, false) then
      update public.projects
      set
        title = coalesce(nullif(trim(new.title), ''), 'Untitled project'),
        location = new.location,
        budget_type = new.budget_type,
        budget_amount = new.budget_amount,
        budget_currency = coalesce(nullif(trim(new.budget_currency), ''), 'EUR'),
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
  after insert or update of is_solo_workspace, title, location, budget_type, budget_amount, budget_currency on public.jobs
  for each row
  execute function public.trg_jobs_sync_solo_workspace_project();

comment on function public.trg_jobs_sync_solo_workspace_project() is
  'Keeps public.projects in sync with solo workspace jobs (incl. budget) for the native app.';

-- ---------------------------------------------------------------------------
-- RPC: backfill helper — include budget when inserting missing projects
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
    'active',
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
  'Creates missing public.projects rows for the caller’s solo workspace jobs (incl. budget).';

revoke all on function public.sync_solo_workspace_projects_for_owner() from public;
grant execute on function public.sync_solo_workspace_projects_for_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- ensure RPC used by the app when SELECT on jobs is blocked by RLS
-- ---------------------------------------------------------------------------
create or replace function public.ensure_solo_workspace_project_for_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs%ROWTYPE;
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

  if exists (select 1 from public.projects p where p.id = p_job_id) then
    update public.projects p
    set
      title = coalesce(nullif(trim(j.title), ''), p.title),
      budget_type = j.budget_type,
      budget_amount = j.budget_amount,
      budget_currency = coalesce(nullif(trim(j.budget_currency), ''), 'EUR'),
      location = coalesce(j.location, p.location),
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
    coalesce(nullif(trim(coalesce(j.status::text, '')), ''), 'active'),
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
  'Creates projects row for caller-owned solo workspace job; copies budget from jobs.';

revoke all on function public.ensure_solo_workspace_project_for_job(uuid) from public;
grant execute on function public.ensure_solo_workspace_project_for_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: existing projects that were created without budget columns filled
-- ---------------------------------------------------------------------------
update public.projects p
set
  budget_amount = j.budget_amount,
  budget_currency = coalesce(nullif(trim(j.budget_currency), ''), 'EUR'),
  budget_type = j.budget_type,
  title = coalesce(nullif(trim(j.title), ''), p.title),
  location = j.location,
  updated_at = now()
from public.jobs j
where coalesce(j.is_solo_workspace, false)
  and (p.id = j.id or p.job_id = j.id);

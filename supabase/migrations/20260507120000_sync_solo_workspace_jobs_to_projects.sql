-- Private projects on Web are `jobs` rows with is_solo_workspace=true.
-- The native app lists `public.projects`. Keep them in sync: same id as `jobs.id`
-- (matches existing `/api/projects/ensure-for-job` behaviour).

-- ---------------------------------------------------------------------------
-- Trigger: solo workspace job → projects row (SECURITY DEFINER bypasses RLS)
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
        new.location
      )
      on conflict (id) do nothing;
    elsif coalesce(new.is_solo_workspace, false) then
      update public.projects
      set
        title = coalesce(nullif(trim(new.title), ''), 'Untitled project'),
        location = new.location,
        budget_type = new.budget_type,
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
  after insert or update of is_solo_workspace, title, location, budget_type on public.jobs
  for each row
  execute function public.trg_jobs_sync_solo_workspace_project();

comment on function public.trg_jobs_sync_solo_workspace_project() is
  'Keeps public.projects in sync with solo workspace jobs so the native app “Private projects” list matches Web.';

-- ---------------------------------------------------------------------------
-- One-shot RPC: app calls on load to backfill rows created before this migration
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
  'Creates missing public.projects rows for the caller’s solo workspace jobs (web-created private projects).';

revoke all on function public.sync_solo_workspace_projects_for_owner() from public;
grant execute on function public.sync_solo_workspace_projects_for_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill existing solo jobs (best-effort)
-- ---------------------------------------------------------------------------
insert into public.projects (
  id,
  job_id,
  company_id,
  freelancer_id,
  title,
  status,
  budget_type,
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
  j.location
from public.jobs j
where coalesce(j.is_solo_workspace, false)
  and not exists (
    select 1
    from public.projects p
    where p.id = j.id or p.job_id = j.id
  )
on conflict (id) do nothing;

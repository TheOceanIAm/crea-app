-- Marketplace jobs: create native `public.projects` immediately so the company can open the workspace
-- without a manual step. `freelancer_id` stays `company_id` until the first accepted applicant (lead).
-- On application accept, lead `freelancer_id` + `project_members` are synced via trigger.

-- ---------------------------------------------------------------------------
-- Jobs → projects: extend solo sync trigger with marketplace insert/update + keep solo behaviour
-- ---------------------------------------------------------------------------
create or replace function public.trg_jobs_sync_solo_workspace_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ps text;
  loc text;
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
    else
      loc := coalesce(
        nullif(trim(new.location), ''),
        nullif(trim(coalesce(new.location_type::text, '')), ''),
        'Remote'
      );
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
        loc
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
    elsif not coalesce(new.is_solo_workspace, false) then
      loc := coalesce(
        nullif(trim(new.location), ''),
        nullif(trim(coalesce(new.location_type::text, '')), ''),
        null
      );
      update public.projects p
      set
        title = coalesce(nullif(trim(new.title), ''), p.title),
        location = coalesce(loc, p.location),
        budget_type = new.budget_type,
        budget_amount = new.budget_amount,
        budget_currency = coalesce(nullif(trim(new.budget_currency), ''), 'EUR'),
        status = ps,
        updated_at = now()
      where p.job_id = new.id or p.id = new.id;
    end if;
    return new;
  end if;

  return new;
end;
$$;

comment on function public.trg_jobs_sync_solo_workspace_project() is
  'Keeps public.projects in sync with jobs: solo workspace rows + marketplace listings (company placeholder lead until first accept).';

-- ---------------------------------------------------------------------------
-- job_applications → projects lead + project_members when status becomes accepted
-- ---------------------------------------------------------------------------
create or replace function public.trg_job_applications_accepted_sync_project_crew()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j_company uuid;
  j_solo boolean;
  proj_id uuid;
  proj_lead uuid;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if coalesce(new.status, '') <> 'accepted' or coalesce(old.status, '') = 'accepted' then
    return new;
  end if;

  select j.company_id, coalesce(j.is_solo_workspace, false)
    into j_company, j_solo
  from public.jobs j
  where j.id = new.job_id;

  if j_company is null or j_solo then
    return new;
  end if;

  select p.id, p.freelancer_id into proj_id, proj_lead
  from public.projects p
  where p.job_id = new.job_id
  limit 1;

  if proj_id is null then
    return new;
  end if;

  if proj_lead is not distinct from j_company then
    update public.projects
      set freelancer_id = new.freelancer_id,
          updated_at = now()
      where id = proj_id;

    insert into public.project_members (project_id, profile_id, member_role)
    values (proj_id, new.freelancer_id, 'lead')
    on conflict (project_id, profile_id) do update
      set member_role = excluded.member_role;
  else
    insert into public.project_members (project_id, profile_id, member_role)
    values (proj_id, new.freelancer_id, 'crew')
    on conflict (project_id, profile_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_job_applications_accepted_sync_project_crew on public.job_applications;
create trigger trg_job_applications_accepted_sync_project_crew
  after update of status on public.job_applications
  for each row
  execute function public.trg_job_applications_accepted_sync_project_crew();

comment on function public.trg_job_applications_accepted_sync_project_crew() is
  'When an application becomes accepted: set projects lead (first accept) and add project_members for workspace access.';

-- ---------------------------------------------------------------------------
-- Backfill: existing marketplace jobs missing a projects row
-- ---------------------------------------------------------------------------
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
  coalesce(
    nullif(trim(j.location), ''),
    nullif(trim(coalesce(j.location_type::text, '')), ''),
    'Remote'
  )
from public.jobs j
where coalesce(j.is_solo_workspace, false) = false
  and not exists (
    select 1
    from public.projects p
    where p.job_id = j.id or p.id = j.id
  )
on conflict (id) do nothing;

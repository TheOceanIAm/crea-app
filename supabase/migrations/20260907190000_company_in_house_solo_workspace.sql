-- Company in-house (private) workspaces: same jobs.is_solo_workspace path as
-- freelancer private projects. Not a marketplace listing; no public apply.
-- Owner + write seats (admin/manager) may create them under the company account.

create or replace function public.crea_jobs_is_company_account(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.company_profiles cp
    where cp.id = p_company_id
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = p_company_id
      and lower(btrim(coalesce(p.role::text, ''))) = 'company'
  );
$$;

comment on function public.crea_jobs_is_company_account(uuid) is
  'True if this uuid is a company account (company_profiles and/or profiles.role = company).';

revoke all on function public.crea_jobs_is_company_account(uuid) from public;
grant execute on function public.crea_jobs_is_company_account(uuid) to authenticated;

create or replace function public.crea_jobs_insert_solo_workspace_allowed()
returns boolean
language sql
security definer
set search_path = public
set row_security = off
stable
as $$
  select exists (
    select 1
    from public.freelancer_profiles fp
    where fp.id = (select auth.uid())
      and fp.plan_tier = 'pro'
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and lower(btrim(coalesce(p.role::text, ''))) = 'company'
  )
  or exists (
    select 1
    from public.company_members cm
    where cm.profile_id = (select auth.uid())
      and cm.status = 'active'
      and cm.role in ('admin', 'manager')
  );
$$;

comment on function public.crea_jobs_insert_solo_workspace_allowed() is
  'jobs INSERT RLS: Pro freelancer or company owner / write seat may create private is_solo_workspace jobs.';

revoke all on function public.crea_jobs_insert_solo_workspace_allowed() from public;
grant execute on function public.crea_jobs_insert_solo_workspace_allowed() to authenticated;

drop policy if exists "jobs_insert_solo_workspace" on public.jobs;
create policy "jobs_insert_solo_workspace" on public.jobs
  for insert to authenticated
  with check (
    coalesce(is_solo_workspace, false) = true
    and public.crea_jobs_insert_solo_workspace_allowed()
    and (
      (
        (select auth.uid()) = company_id
        and exists (
          select 1
          from public.freelancer_profiles fp
          where fp.id = (select auth.uid())
            and fp.plan_tier = 'pro'
        )
        and not public.crea_jobs_is_company_account(company_id)
      )
      or (
        public.auth_user_can_write_company(company_id)
        and public.crea_jobs_is_company_account(company_id)
      )
    )
  );

-- Marketplace / listing inserts stay on this policy; solo workspaces use the policy above.
drop policy if exists "jobs_insert_company_member" on public.jobs;
create policy "jobs_insert_company_member" on public.jobs
  for insert to authenticated
  with check (
    public.auth_user_can_write_company(company_id)
    and not coalesce(is_solo_workspace, false)
  );

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

  if not coalesce(j.is_solo_workspace, false) then
    return null;
  end if;

  if not public.auth_user_can_write_company(j.company_id) then
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
  'Creates/updates projects row for a solo workspace job the caller can write (owner or company write seat).';

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
  where public.auth_user_can_write_company(j.company_id)
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
  'Creates missing public.projects rows for solo workspace jobs the caller can write.';

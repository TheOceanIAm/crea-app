-- App helper: create public.projects row for a solo workspace job without relying on client SELECT on jobs (RLS-safe).
-- Works when only projects_insert_company migration ran but sync_solo_workspace_jobs trigger/RPC batch is missing.

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

  if exists (select 1 from public.projects p where p.id = p_job_id) then
    return p_job_id;
  end if;

  select * into j from public.jobs where id = p_job_id;
  if not found then
    return null;
  end if;

  if not coalesce(j.is_solo_workspace, false) or j.company_id is distinct from auth.uid() then
    return null;
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
    coalesce(nullif(trim(j.location), ''), 'Remote')
  )
  on conflict (id) do nothing;

  return p_job_id;
end;
$$;

comment on function public.ensure_solo_workspace_project_for_job(uuid) is
  'Mobile/web parity: creates projects row for caller-owned solo workspace job; bypasses jobs SELECT RLS from client.';

revoke all on function public.ensure_solo_workspace_project_for_job(uuid) from public;
grant execute on function public.ensure_solo_workspace_project_for_job(uuid) to authenticated;

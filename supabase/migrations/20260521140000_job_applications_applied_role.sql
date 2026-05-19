-- Role/discipline the freelancer applies for (from jobs.category at post time).

alter table public.job_applications
  add column if not exists applied_role text;

comment on column public.job_applications.applied_role is
  'Discipline the freelancer applied for (one of the roles listed on jobs.category when the job was posted).';

drop function if exists public.freelancer_apply_to_job(uuid);

create or replace function public.freelancer_apply_to_job(
  p_job_id uuid,
  p_applied_role text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  uid uuid := (select auth.uid());
  j_company uuid;
  j_status text;
  new_id uuid;
  role_clean text;
begin
  if uid is null then
    raise exception 'authentication required';
  end if;

  select j.company_id, j.status into j_company, j_status
  from public.jobs j
  where j.id = p_job_id;

  if j_status is null then
    raise exception 'job_not_found';
  end if;

  if j_company = uid then
    raise exception 'cannot_apply_to_own_job';
  end if;

  if j_status <> 'active' then
    raise exception 'job_not_active';
  end if;

  if exists (
    select 1 from public.job_applications ja
    where ja.job_id = p_job_id and ja.freelancer_id = uid
  ) then
    raise exception 'already_applied';
  end if;

  role_clean := nullif(trim(coalesce(p_applied_role, '')), '');

  insert into public.job_applications (job_id, freelancer_id, status, applied_role)
  values (p_job_id, uid, 'pending', role_clean)
  returning id into new_id;

  return new_id;
exception
  when unique_violation then
    raise exception 'already_applied';
end;
$$;

revoke all on function public.freelancer_apply_to_job(uuid, text) from public;
grant execute on function public.freelancer_apply_to_job(uuid, text) to authenticated;
